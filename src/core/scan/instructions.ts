import { dirname, extname, isAbsolute, join, matchesGlob, parse, posix, resolve } from "node:path";
import { Lexer, type Token } from "marked";
import picomatch from "picomatch";
import {
  type AgentsMdMode,
  type ImportRef,
  type Instruction,
  type InstructionKind,
  type Problem,
  type Scope,
  type TextFile,
  type Trust,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isFile,
  isNetworkPath,
  isWithin,
  MAX_TEXT_BYTES,
  pathsField,
  readTextFile,
  resolvedPath,
  walkMarkdown,
} from "./files.ts";
import { parseFrontmatter } from "./data.ts";

const MAX_IMPORT_HOPS = 4;

export const AGENTS_MD_MODES: AgentsMdMode[] = [
  "claude-md-or-agents-md",
  "claude-md-and-agents-md",
  "claude-md",
  "managed-only",
];

/** The CLAUDE.md and AGENTS.md files each folder can hold, in the order Claude Code reads them. */
export const CLAUDE_MD_NAMES = ["CLAUDE.md", ".claude/CLAUDE.md"];
export const AGENTS_MD_NAMES = ["AGENTS.md", ".claude/AGENTS.md"];

/**
 * Whether AGENTS.md loads, given the instruction mode and whether a CLAUDE.md or CLAUDE.local.md
 * is there (docs: memory#choose-which-instruction-files-load).
 */
export function agentsMdLoads(mode: AgentsMdMode, hasClaudeMd: boolean): boolean {
  return mode === "claude-md-and-agents-md" || (mode === "claude-md-or-agents-md" && !hasClaudeMd);
}

/** Whether claudeMdExcludes matches a file by its own path or, for a link, its target's. */
export type ExcludeMatcher = (path: string, realPath?: string) => boolean;

/**
 * claudeMdExcludes globs matched against absolute paths (docs: memory#exclude-specific-claude-md-files)
 * the way Claude Code matches them: with forward slashes, `*` and `**` also matching folders such
 * as .claude, and each glob that starts with / also written from where the folder before its
 * first wildcard really is, so a glob through a link matches the files it leads to (observed in
 * v2.1.296). Claude Code does not do that for a glob that starts with a drive letter, so on
 * Windows a glob through a link matches only paths written through the link. An invalid glob
 * matches nothing.
 */
export async function excludeMatcher(excludes: string[]): Promise<ExcludeMatcher> {
  const globs = excludes.map((glob) => glob.replaceAll("\\", "/")).filter(Boolean);
  for (const glob of [...globs]) {
    if (!glob.startsWith("/")) continue;
    const wildcard = glob.search(/[*?{[]/);
    const parent = posix.dirname(wildcard === -1 ? glob : glob.slice(0, wildcard));
    if (isNetworkPath(parent)) continue;
    const real = (await resolvedPath(parent)).replaceAll("\\", "/");
    if (real !== parent && !isNetworkPath(real)) globs.push(real + glob.slice(parent.length));
  }
  const matchers = globs.flatMap((glob) => {
    try {
      return [picomatch(glob, { dot: true })];
    } catch {
      return [];
    }
  });
  return (path, realPath) =>
    [path, realPath].some(
      (p) => p !== undefined && matchers.some((matches) => matches(p.replaceAll("\\", "/")))
    );
}

/**
 * Where a rule in `dir` really is when that is outside both the project and `dir`: a link's
 * target, or the file a linked folder leads to. Undefined for a rule that stays inside.
 */
export async function ruleTarget(
  file: TextFile,
  dir: string,
  realCwd: string
): Promise<string | undefined> {
  if (file.realPath) return file.realPath;
  const real = await resolvedPath(file.path);
  return isWithin(realCwd, real) || isWithin(await resolvedPath(dir), real) ? undefined : real;
}

/**
 * Why a project rule linked from outside the project does not load, or null when it does: it waits
 * for your approval of outside imports, and once approved loads only without a paths field
 * (docs: memory#share-rules-across-projects-with-symlinks).
 */
export function linkedRuleBlock(
  target: string | undefined,
  realCwd: string,
  approved: boolean,
  hasPaths: boolean
): "needs-approval" | "has-paths" | null {
  if (target === undefined || isWithin(realCwd, target)) return null;
  if (!approved) return "needs-approval";
  return hasPaths ? "has-paths" : null;
}

/** Directories from the filesystem root down to `cwd`, the order Claude Code concatenates them in. */
export function ancestorsRootFirst(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);
  const { root } = parse(current);
  while (true) {
    dirs.unshift(current);
    if (current === root) break;
    current = dirname(current);
  }
  return dirs;
}

interface ResolveOptions {
  env: ScanEnv;
  cwd: string;
  mode: AgentsMdMode;
  /** Merged `claudeMdExcludes` globs from every settings layer. */
  excludes: string[];
  /** Your answer to Claude Code's dialog about imports from outside the project. */
  externalImports: Trust["externalImports"];
  /** The managed settings' `claudeMd` text, which loads like a managed CLAUDE.md. */
  managedClaudeMd: { path: string; text: string } | null;
  /** The settings file that turns off the built-in plugin that reads AGENTS.md, or null. */
  agentsMdOff: Scope | null;
  /** The roots of a worktree that lies inside its main checkout, such as one in .claude/worktrees. */
  nestedWorktree: NestedWorktree | null;
  /** Receives instruction files and imports that exist but cannot be read. */
  problems: Problem[];
}

export interface NestedWorktree {
  root: string;
  mainRoot: string;
}

/** Shared by every file of one scan. */
interface Ctx {
  /** The start directory after links; "outside the project" is measured from here. */
  realCwd: string;
  env: ScanEnv;
  approved: boolean;
  nestedWorktree: NestedWorktree | null;
  isExcluded: ExcludeMatcher;
  problems: Problem[];
}

/**
 * The instruction files Claude Code reads in `cwd`, in load order, each with whether it loads at
 * session start, when Claude works with matching files, or not at all, and why.
 * Follows code.claude.com/docs/en/memory.
 */
export async function resolveInstructions(options: ResolveOptions): Promise<Instruction[]> {
  const { env, cwd, mode, excludes, externalImports, managedClaudeMd, problems } = options;
  const ctx: Ctx = {
    realCwd: await resolvedPath(resolve(cwd)),
    env,
    approved: externalImports === "approved",
    nestedWorktree: options.nestedWorktree,
    isExcluded: await excludeMatcher(excludes),
    problems,
  };
  const out = await readOwnFiles(ctx, managedClaudeMd);
  const { claudeFiles, agentsFiles } = await readDirectoryFiles(ctx, cwd);
  explainClaudeFiles(claudeFiles, cwd);
  explainAgentsFiles(agentsFiles, claudeFiles, mode, options.agentsMdOff);
  for (const dir of ancestorsRootFirst(cwd))
    out.push(
      ...claudeFiles.filter((f) => f.dir === dir),
      ...agentsFiles.filter((f) => f.dir === dir)
    );
  applyLoadRules(out, ctx, mode, externalImports, managedClaudeMd?.path);
  await skipRepeats(out);
  addChecks(out);
  return out;
}

/** A file that exists but cannot be read is reported, not taken for a missing one. */
function readInstruction(ctx: Ctx, path: string): Promise<TextFile | null> {
  return readTextFile(ctx.env, path, ctx.problems);
}

/** The managed and user files and rules, which come first and do not depend on the folder. */
async function readOwnFiles(
  ctx: Ctx,
  managedClaudeMd: ResolveOptions["managedClaudeMd"]
): Promise<Instruction[]> {
  const { env } = ctx;
  const out: Instruction[] = [];
  const managed = await readInstruction(ctx, join(env.managedDir, "CLAUDE.md"));
  if (managed)
    out.push(
      await instruction(
        managed,
        "claude-md",
        "managed",
        env.managedDir,
        ctx,
        "Organisation policy, always loaded"
      )
    );
  if (managedClaudeMd) {
    const { path, text } = managedClaudeMd;
    const file: TextFile = {
      path,
      mtime: "",
      bytes: Buffer.byteLength(text),
      lines: text.split("\n").length,
      text,
    };
    const entry = await instruction(
      file,
      "claude-md",
      "managed",
      env.managedDir,
      ctx,
      "Organisation policy from the claudeMd key in managed settings"
    );
    entry.imports = [];
    out.push(entry);
  }
  // Like a project's, the managed folder's .claude/rules load next (observed in v2.1.296; the
  // docs do not say). As managed files they cannot be excluded, and managed-only mode keeps them:
  // it drops only user, project and local files (also observed in v2.1.296).
  for (const path of await walkMarkdown(join(env.managedDir, ".claude", "rules"), ctx.problems)) {
    const file = await readInstruction(ctx, path);
    if (file) out.push(await rule(file, "managed", env.managedDir, ctx));
  }

  const user = await readInstruction(ctx, join(env.claudeDir, "CLAUDE.md"));
  if (user)
    out.push(
      await instruction(
        user,
        "claude-md",
        "user",
        env.claudeDir,
        ctx,
        "Your instructions for every project"
      )
    );
  for (const path of await walkMarkdown(join(env.claudeDir, "rules"), ctx.problems)) {
    const file = await readInstruction(ctx, path);
    if (file) out.push(await rule(file, "user", env.claudeDir, ctx));
  }
  return out;
}

/**
 * The project and local files of `cwd` and every folder above it. Per directory, root first:
 * CLAUDE.md, .claude/CLAUDE.md, rules, then CLAUDE.local.md last ("your personal notes are the last
 * thing Claude reads at that level"), then AGENTS.md.
 */
async function readDirectoryFiles(
  ctx: Ctx,
  cwd: string
): Promise<{ claudeFiles: Instruction[]; agentsFiles: Instruction[] }> {
  const claudeFiles: Instruction[] = [];
  const agentsFiles: Instruction[] = [];
  for (const dir of ancestorsRootFirst(cwd)) {
    claudeFiles.push(...(await readClaudeFiles(ctx, dir)));
    for (const name of AGENTS_MD_NAMES) {
      const file = await readInstruction(ctx, join(dir, name));
      if (file) agentsFiles.push(await instruction(file, "agents-md", "project", dir, ctx, ""));
    }
  }
  return { claudeFiles, agentsFiles };
}

/**
 * Whether `dir` is a folder of the main checkout above a worktree nested in it. Claude Code reads
 * no project files there, only CLAUDE.local.md, so the worktree's own copies are not read twice
 * (observed in v2.1.296; docs: memory#how-claude-md-files-load points to worktrees for this).
 */
function inMainCheckout(ctx: Ctx, dir: string): boolean {
  const nested = ctx.nestedWorktree;
  return nested !== null && isWithin(nested.mainRoot, dir) && !isWithin(nested.root, dir);
}

/** One folder's CLAUDE.md files, rules and CLAUDE.local.md, in the order Claude Code reads them. */
async function readClaudeFiles(ctx: Ctx, dir: string): Promise<Instruction[]> {
  const { env } = ctx;
  const out: Instruction[] = [];
  // ~/.claude/CLAUDE.md and ~/.claude/rules are the user files above, not the home's project files.
  const holdsClaudeDir = join(dir, ".claude") === env.claudeDir;
  for (const name of CLAUDE_MD_NAMES) {
    if (holdsClaudeDir && name === ".claude/CLAUDE.md") continue;
    const file = await readInstruction(ctx, join(dir, name));
    if (file) out.push(await instruction(file, "claude-md", "project", dir, ctx, ""));
  }
  if (!holdsClaudeDir && dir !== env.claudeDir)
    for (const path of await walkMarkdown(join(dir, ".claude", "rules"), ctx.problems)) {
      const file = await readInstruction(ctx, path);
      if (file) out.push(await rule(file, "project", dir, ctx));
    }
  if (inMainCheckout(ctx, dir))
    for (const file of out)
      skip(
        file,
        "Skipped: from a worktree inside the main checkout, Claude Code reads only the main checkout's CLAUDE.local.md"
      );
  const local = await readInstruction(ctx, join(dir, "CLAUDE.local.md"));
  if (local) out.push(await instruction(local, "claude-local-md", "local", dir, ctx, ""));
  // Claude Code's walk up stops below the filesystem root (observed in v2.1.296). The files are
  // still listed and still count for AGENTS.md, which its built-in plugin decides apart from this walk.
  if (dir === parse(dir).root)
    for (const file of out)
      skip(file, "Skipped: Claude Code does not read instruction files at the filesystem root");
  return out;
}

/** Why each CLAUDE.md and CLAUDE.local.md loads; rules have their reason already. */
function explainClaudeFiles(claudeFiles: Instruction[], cwd: string): void {
  for (const file of claudeFiles) {
    if (file.kind === "rule" || file.status === "skipped") continue;
    if (file.kind === "claude-local-md") file.reason = "Your private notes for this directory";
    else if (file.dir === resolve(cwd)) file.reason = "Instructions for this directory";
    else file.reason = "Inherited from a parent directory";
  }
}

/** Whether each AGENTS.md loads next to the CLAUDE.md files found, and why. */
function explainAgentsFiles(
  agentsFiles: Instruction[],
  claudeFiles: Instruction[],
  mode: AgentsMdMode,
  pluginOff: Scope | null
): void {
  const hasClaudeMd = claudeFiles.some((f) => f.kind !== "rule");
  const includedElsewhere = new Set(
    claudeFiles.flatMap((f) => [
      f.realPath ?? f.path,
      ...f.imports.filter((i) => !i.skipped).map((i) => i.resolved),
    ])
  );
  for (const file of agentsFiles) {
    if (pluginOff)
      skip(
        file,
        `Skipped: the built-in plugin that reads AGENTS.md is off in ${pluginOff} settings`
      );
    else if (!agentsMdLoads(mode, false)) skip(file, skippedByMode(mode));
    else if (includedElsewhere.has(file.realPath ?? file.path))
      skip(file, "Already included through a CLAUDE.md import or symlink");
    else if (!agentsMdLoads(mode, hasClaudeMd))
      skip(
        file,
        "Ignored: a CLAUDE.md or CLAUDE.local.md exists here or above, so Claude Code reads that instead"
      );
    else if (mode === "claude-md-and-agents-md")
      file.reason = "Loaded alongside CLAUDE.md (instruction mode claude-md-and-agents-md)";
    else file.reason = "Loaded because there is no CLAUDE.md here or above";
  }
}

/**
 * Skips what Claude Code leaves out: any file over 4 MiB, managed ones included (docs:
 * memory#how-auto-memory-works), and of all but managed files, all of them in managed-only mode,
 * ones matched by claudeMdExcludes, and project rules linked from outside the project that do not
 * qualify.
 */
function applyLoadRules(
  out: Instruction[],
  ctx: Ctx,
  mode: AgentsMdMode,
  externalImports: Trust["externalImports"],
  /** The managed claudeMd setting, which is no file and so has no size limit. */
  settingPath: string | undefined
): void {
  const tooLarge = "Skipped: Claude Code does not load an instruction file over 4 MiB";
  const waiting =
    externalImports === "declined"
      ? "You declined imports from outside this project"
      : "Waits for you to approve imports from outside this project";
  for (const file of out) {
    if (file.scope === "managed") {
      if (file.path !== settingPath && file.bytes > MAX_TEXT_BYTES) skip(file, tooLarge);
      continue;
    }
    // Path-scoped rules still load on demand in managed-only mode (docs: memory#choose-which-instruction-files-load).
    if (mode === "managed-only" && file.status === "loaded") skip(file, skippedByMode(mode));
    // Managed files cannot be excluded.
    if (ctx.isExcluded(file.path, file.realPath)) skip(file, "Skipped by claudeMdExcludes");
    if (file.bytes > MAX_TEXT_BYTES) skip(file, tooLarge);
    // A project's links outside it need your approval, like its imports; your own files do not.
    if (file.scope !== "project" && file.scope !== "local") continue;
    if (file.kind !== "rule") continue;
    const block = linkedRuleBlock(
      file.realPath,
      ctx.realCwd,
      ctx.approved,
      file.paths !== undefined
    );
    if (block === "needs-approval") skip(file, `${waiting}; this rule links outside it`);
    else if (block === "has-paths")
      skip(file, "Links outside this project, and such a rule loads only without a paths field");
  }
}

/**
 * A file reached again under another name, such as a .claude/CLAUDE.md that links to CLAUDE.md,
 * loads only the first time, as Claude Code keeps each file it read by its real path (observed
 * in v2.1.296).
 */
async function skipRepeats(out: Instruction[]): Promise<void> {
  const first = new Map<string, string>();
  for (const file of out) {
    if (file.status === "skipped") continue;
    const real = file.realPath ?? (await resolvedPath(file.path));
    const earlier = first.get(real);
    if (earlier) skip(file, `Already loaded as ${earlier}`);
    else first.set(real, file.path);
  }
}

function skippedByMode(mode: AgentsMdMode): string {
  return `Skipped: instruction mode is ${mode}`;
}

function skip(file: Instruction, reason: string) {
  if (file.status === "skipped") return;
  file.status = "skipped";
  file.reason = reason;
}

/** An invalid pattern matches nothing. */
export function safeMatch(path: string, glob: string): boolean {
  try {
    return matchesGlob(path, glob);
  } catch {
    return false;
  }
}

/** Claude Code's docs suggest keeping each CLAUDE.md under this many lines. */
const LONG_FILE_LINES = 200;

function paragraphs(text: string): string[] {
  return parseFrontmatter(text)
    .body.split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter((p) => p.length >= 60);
}

/** Upkeep notes: files longer than the docs recommend, paragraphs repeated across files, missing imports. */
function addChecks(files: Instruction[]) {
  const seen = new Map<string, Instruction>();
  for (const file of files.filter((f) => f.status !== "skipped")) {
    if (file.lines > LONG_FILE_LINES)
      file.checks.push(
        `${file.lines} lines; Claude Code's docs suggest under ${LONG_FILE_LINES} for better adherence`
      );
    const repeated = new Set<string>();
    for (const paragraph of paragraphs(file.text)) {
      const first = seen.get(paragraph);
      if (first && first !== file) repeated.add(first.path);
      else seen.set(paragraph, file);
    }
    for (const path of repeated) file.checks.push(`Repeats a paragraph from ${path}`);
    // `@name` without a slash or dot is as likely a mention as a path, so only path-like ones count.
    for (const ref of file.imports)
      if (!ref.exists && /[./]/.test(ref.raw))
        file.checks.push(`Imports @${ref.raw}, which does not exist`);
  }
}

/** A rule's `paths` globs, or none when it loads every session. */
export function rulePaths(text: string): string[] {
  return pathsField(parseFrontmatter(text).data.paths);
}

async function rule(file: TextFile, scope: Scope, dir: string, ctx: Ctx) {
  const paths = rulePaths(file.text);
  const entry = await instruction(
    file,
    "rule",
    scope,
    dir,
    ctx,
    paths.length > 0
      ? "Loads only when Claude works with matching files"
      : "Rule loaded every session"
  );
  if (paths.length > 0) {
    entry.paths = paths;
    entry.status = "on-match";
  }
  // A rule reached through a linked folder is not a link itself, but its target can be outside.
  const target = await ruleTarget(file, dir, ctx.realCwd);
  if (target) entry.realPath = target;
  return entry;
}

async function instruction(
  file: TextFile,
  kind: InstructionKind,
  scope: Scope,
  dir: string,
  ctx: Ctx,
  reason: string
): Promise<Instruction> {
  // Your own files' imports load without asking; a project's imports outside it wait for approval.
  const own = scope === "managed" || scope === "user";
  const imports = await collectImports(file, ctx, own || ctx.approved, scope !== "managed");
  if (!own && !ctx.approved) for (const ref of imports) if (ref.external) ref.pending = true;
  return { ...file, kind, scope, dir, status: "loaded", reason, imports, checks: [] };
}

/**
 * `@path` imports, depth first up to four hops, each with the file that imports it. An import
 * outside the project is read only when Claude Code would read it: from your own files, or once
 * you approved the project's external imports. Like the files themselves, imports of all but
 * managed files can be excluded.
 */
async function collectImports(
  file: TextFile,
  ctx: Ctx,
  readExternal: boolean,
  excludable: boolean
): Promise<ImportRef[]> {
  const seen = new Set<string>([file.realPath ?? file.path]);
  const out: ImportRef[] = [];
  const visit = async (source: TextFile, via: string, hop: number) => {
    if (hop >= MAX_IMPORT_HOPS) return;
    for (const raw of importPaths(source.text)) {
      const target = expandImport(raw, dirname(source.path), ctx.env.home);
      if (isNetworkPath(target)) continue;
      const real = await resolvedPath(target);
      if (seen.has(real)) continue;
      seen.add(real);
      const { ref, imported } = await readImport(
        ctx,
        { raw, target, real, via },
        readExternal,
        excludable
      );
      out.push(ref);
      if (imported) await visit(imported, real, hop + 1);
    }
  };
  await visit(file, file.path, 0);
  return out;
}

/** One import, and its text when Claude Code would read it. */
async function readImport(
  ctx: Ctx,
  found: { raw: string; target: string; real: string; via: string },
  readExternal: boolean,
  excludable: boolean
): Promise<{ ref: ImportRef; imported: TextFile | null }> {
  const { raw, target, real, via } = found;
  const external = !isWithin(ctx.realCwd, real);
  const skipped = importSkipped(ctx, target, real, excludable);
  const unread = skipped !== undefined || (external && !readExternal);
  const imported = unread ? null : await readTextFile(ctx.env, target, ctx.problems);
  const ref: ImportRef = {
    raw,
    resolved: real,
    via,
    exists: imported !== null || (await isFile(target)),
    external,
  };
  if (skipped) ref.skipped = skipped;
  if (imported && imported.bytes > MAX_TEXT_BYTES) ref.tooLarge = true;
  return { ref, imported };
}

/** Why Claude Code does not load an import it found, or undefined when it does. */
function importSkipped(
  ctx: Ctx,
  target: string,
  real: string,
  excludable: boolean
): ImportRef["skipped"] {
  if (excludable && ctx.isExcluded(target, real)) return "excluded";
  return isTextImport(target) ? undefined : "not-text";
}

function expandImport(raw: string, baseDir: string, home: string): string {
  const unescaped = raw.replaceAll("\\ ", " ");
  if (unescaped.startsWith("~/")) return join(home, unescaped.slice(2));
  return isAbsolute(unescaped) ? unescaped : resolve(baseDir, unescaped);
}

/**
 * The extensions Claude Code reads an import with; it skips any other file, such as an image
 * (observed in v2.1.296). A file without an extension is read.
 */
const TEXT_EXTENSIONS = new Set(
  (
    ".md .txt .text .json .yaml .yml .toml .xml .csv .html .htm .css .scss .sass .less .js .ts " +
    ".tsx .jsx .mjs .cjs .mts .cts .py .pyi .pyw .rb .erb .rake .go .rs .java .kt .kts .scala .c " +
    ".cpp .cc .cxx .h .hpp .hxx .cs .swift .sh .bash .zsh .fish .ps1 .bat .cmd .env .ini .cfg " +
    ".conf .config .properties .sql .graphql .gql .proto .vue .svelte .astro .ejs .hbs .pug .jade " +
    ".php .pl .pm .lua .r .dart .ex .exs .erl .hrl .clj .cljs .cljc .edn .hs .lhs .elm .ml .mli " +
    ".f .f90 .f95 .for .cmake .make .makefile .gradle .sbt .rst .adoc .asciidoc .org .tex .latex " +
    ".lock .log .diff .patch"
  ).split(" ")
);

function isTextImport(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === "" || TEXT_EXTENSIONS.has(extension);
}

/**
 * `@path` references as Claude Code finds them (docs: memory#import-additional-files; the details
 * observed in v2.1.296): in the Markdown text after the frontmatter, never in code blocks, inline
 * code or HTML other than comments, and in an HTML comment block only outside the comments. A
 * `#` and what follows is cut, a backslash keeps a space in the path, and only a path that
 * starts like one counts.
 */
function importPaths(text: string): string[] {
  const body = parseFrontmatter(text).body;
  if (!body.includes("@")) return [];
  const found = new Set<string>();
  const scan = (part: string) => {
    for (const match of part.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
      const path = match[1]?.split("#")[0];
      if (path && looksLikePath(path.replaceAll("\\ ", " "))) found.add(path);
    }
  };
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "code" || token.type === "codespan") continue;
      if (token.type === "html") {
        const raw = token.raw.trimStart();
        if (raw.startsWith("<!--") && raw.includes("-->"))
          scan(token.raw.replace(/<!--[\s\S]*?-->/g, ""));
        continue;
      }
      if (token.type === "text") scan(token.text);
      if ("tokens" in token && token.tokens) walk(token.tokens);
      if ("items" in token && Array.isArray(token.items)) walk(token.items);
    }
  };
  walk(Lexer.lex(body, { gfm: false }));
  return [...found];
}

function looksLikePath(path: string): boolean {
  if (path.startsWith("./") || path.startsWith("~/")) return true;
  if (path.startsWith("/")) return path !== "/";
  return !path.startsWith("@") && !/^[#%^&*()]/.test(path) && /^[a-zA-Z0-9._-]/.test(path);
}
