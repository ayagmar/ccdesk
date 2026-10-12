import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, matchesGlob, parse, resolve } from "node:path";
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
  parseFrontmatter,
  readTextFile,
  resolvedPath,
  toStringList,
  walkMarkdown,
} from "./files.ts";

const MAX_IMPORT_HOPS = 4;

export const AGENTS_MD_MODES: AgentsMdMode[] = [
  "claude-md-or-agents-md",
  "claude-md-and-agents-md",
  "claude-md",
  "managed-only",
];

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
  /** Receives instruction files that exist but cannot be read. */
  problems: Problem[];
}

/** Shared by every file of one scan. */
interface Ctx {
  /** The start directory after links; "outside the project" is measured from here. */
  realCwd: string;
  home: string;
  approved: boolean;
}

/**
 * The instruction files Claude Code reads in `cwd`, in load order, each with whether it loads at
 * session start, when Claude works with matching files, or not at all, and why.
 * Follows code.claude.com/docs/en/memory.
 */
export async function resolveInstructions(options: ResolveOptions): Promise<Instruction[]> {
  const { env, cwd, mode, excludes, externalImports, managedClaudeMd, problems } = options;
  /** A file that exists but cannot be read is reported, not taken for a missing one. */
  const readInstruction = async (path: string) => {
    const file = await readTextFile(path);
    if (file || !(await stat(path).catch(() => null))?.isFile()) return file;
    const denied = await access(path, constants.R_OK).then(
      () => null,
      (error: NodeJS.ErrnoException) => error.code ?? String(error)
    );
    if (denied) problems.push({ path, error: `cannot be read (${denied})` });
    return null;
  };
  const ctx: Ctx = {
    realCwd: await resolvedPath(resolve(cwd)),
    home: env.home,
    approved: externalImports === "approved",
  };
  const managedOnly = mode === "managed-only";
  const skippedByMode = `Skipped: instruction mode is ${mode}`;
  const out: Instruction[] = [];

  const managed = await readInstruction(join(env.managedDir, "CLAUDE.md"));
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

  const user = await readInstruction(join(env.claudeDir, "CLAUDE.md"));
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
  for (const path of await walkMarkdown(join(env.claudeDir, "rules"))) {
    const file = await readInstruction(path);
    if (file) out.push(await rule(file, "user", env.claudeDir, ctx));
  }

  // Per directory, root first: CLAUDE.md, .claude/CLAUDE.md, rules, then CLAUDE.local.md last
  // ("your personal notes are the last thing Claude reads at that level"), then AGENTS.md.
  const claudeFiles: Instruction[] = [];
  const agentsFiles: Instruction[] = [];
  for (const dir of ancestorsRootFirst(cwd)) {
    // ~/.claude/CLAUDE.md and ~/.claude/rules are the user files above, not the home's project files.
    const isConfigHome = join(dir, ".claude") === env.claudeDir;
    for (const name of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
      if (isConfigHome && name === ".claude/CLAUDE.md") continue;
      const file = await readInstruction(join(dir, name));
      if (file) claudeFiles.push(await instruction(file, "claude-md", "project", dir, ctx, ""));
    }
    if (!isConfigHome && dir !== env.claudeDir)
      for (const path of await walkMarkdown(join(dir, ".claude", "rules"))) {
        const file = await readInstruction(path);
        if (file) claudeFiles.push(await rule(file, "project", dir, ctx));
      }
    const local = await readInstruction(join(dir, "CLAUDE.local.md"));
    if (local) claudeFiles.push(await instruction(local, "claude-local-md", "local", dir, ctx, ""));
    for (const name of ["AGENTS.md", ".claude/AGENTS.md"]) {
      const file = await readInstruction(join(dir, name));
      if (file) agentsFiles.push(await instruction(file, "agents-md", "project", dir, ctx, ""));
    }
  }

  const hasClaudeMd = claudeFiles.some((f) => f.kind !== "rule");
  for (const file of claudeFiles) {
    if (file.kind === "rule") continue;
    file.reason =
      file.kind === "claude-local-md"
        ? "Your private notes for this directory"
        : file.dir === resolve(cwd)
          ? "Instructions for this directory"
          : "Inherited from a parent directory";
  }

  const includedElsewhere = new Set(
    claudeFiles.flatMap((f) => [f.realPath ?? f.path, ...f.imports.map((i) => i.resolved)])
  );
  for (const file of agentsFiles) {
    if (mode === "managed-only" || mode === "claude-md") skip(file, skippedByMode);
    else if (includedElsewhere.has(file.realPath ?? file.path))
      skip(file, "Already included through a CLAUDE.md import or symlink");
    else if (mode === "claude-md-and-agents-md")
      file.reason = "Loaded alongside CLAUDE.md (instruction mode claude-md-and-agents-md)";
    else if (hasClaudeMd)
      skip(
        file,
        "Ignored: a CLAUDE.md or CLAUDE.local.md exists here or above, so Claude Code reads that instead"
      );
    else file.reason = "Loaded because there is no CLAUDE.md here or above";
  }

  for (const dir of ancestorsRootFirst(cwd))
    out.push(
      ...claudeFiles.filter((f) => f.dir === dir),
      ...agentsFiles.filter((f) => f.dir === dir)
    );

  const waiting =
    externalImports === "declined"
      ? "You declined imports from outside this project"
      : "Waits for you to approve imports from outside this project";
  for (const file of out) {
    if (file.scope === "managed") continue;
    // Path-scoped rules still load on demand in managed-only mode (docs: memory#choose-which-instruction-files-load).
    if (managedOnly && file.status === "loaded") skip(file, skippedByMode);
    // Managed files cannot be excluded; a linked file is excluded by its own path or its target's
    // (docs: memory#exclude-specific-claude-md-files).
    const excluded = excludes.some((glob) =>
      [file.path, file.realPath].some((p) => p !== undefined && safeMatch(p, glob))
    );
    if (excluded) skip(file, "Skipped by claudeMdExcludes");
    if (file.status !== "skipped" && file.bytes > MAX_TEXT_BYTES)
      skip(file, "Skipped: Claude Code does not load an instruction file over 4 MiB");
    // A project's links outside it need your approval, like its imports; your own files do not.
    if (file.scope !== "project" && file.scope !== "local") continue;
    if (file.kind === "rule" && file.realPath && !isWithin(ctx.realCwd, file.realPath)) {
      if (!ctx.approved) skip(file, `${waiting}; this rule links outside it`);
      // docs: memory#share-rules-across-projects-with-symlinks
      else if (file.paths)
        skip(file, "Links outside this project, and such a rule loads only without a paths field");
    }
  }
  addChecks(out);
  return out;
}

function skip(file: Instruction, reason: string) {
  if (file.status === "skipped") return;
  file.status = "skipped";
  file.reason = reason;
}

/** An invalid pattern matches nothing. */
function safeMatch(path: string, glob: string): boolean {
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

async function rule(file: TextFile, scope: Scope, dir: string, ctx: Ctx) {
  const paths = toStringList(parseFrontmatter(file.text).data.paths);
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
  const real = await resolvedPath(file.path);
  if (!entry.realPath && !isWithin(ctx.realCwd, real) && !isWithin(await resolvedPath(dir), real))
    entry.realPath = real;
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
  const imports = await collectImports(file, ctx, own || ctx.approved);
  if (!own && !ctx.approved) for (const ref of imports) if (ref.external) ref.pending = true;
  return { ...file, kind, scope, dir, status: "loaded", reason, imports, checks: [] };
}

/**
 * `@path` imports, depth first up to four hops, each with the file that imports it. An import
 * outside the project is read only when Claude Code would read it: from your own files, or once
 * you approved the project's external imports.
 */
async function collectImports(
  file: TextFile,
  ctx: Ctx,
  readExternal: boolean
): Promise<ImportRef[]> {
  const seen = new Set<string>([file.realPath ?? file.path]);
  const out: ImportRef[] = [];
  const visit = async (source: TextFile, via: string, hop: number) => {
    if (hop >= MAX_IMPORT_HOPS) return;
    for (const raw of importPaths(source.text)) {
      const target = expandImport(raw, dirname(source.path), ctx.home);
      if (isNetworkPath(target)) continue;
      const real = await resolvedPath(target);
      if (seen.has(real)) continue;
      seen.add(real);
      const external = !isWithin(ctx.realCwd, real);
      const imported = !external || readExternal ? await readTextFile(target) : null;
      const ref: ImportRef = {
        raw,
        resolved: real,
        via,
        exists: imported !== null || (await isFile(target)),
        external,
      };
      if (imported && imported.bytes > MAX_TEXT_BYTES) ref.tooLarge = true;
      out.push(ref);
      if (imported) await visit(imported, real, hop + 1);
    }
  };
  await visit(file, file.path, 0);
  return out;
}

function expandImport(raw: string, baseDir: string, home: string): string {
  const unescaped = raw.replaceAll("\\ ", " ");
  if (unescaped.startsWith("~/")) return join(home, unescaped.slice(2));
  return isAbsolute(unescaped) ? unescaped : resolve(baseDir, unescaped);
}

/**
 * `@path` references outside code spans and fences; a backslash keeps a space in the path. A code
 * span opens with a run of backticks and closes at the next run of the same length.
 */
function importPaths(text: string): string[] {
  const withoutFences = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
  const withoutSpans = withoutFences.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
  const found: string[] = [];
  for (const match of withoutSpans.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
    const path = match[1]?.replace(/[.,;:!?)\]]+$/, "");
    if (path) found.push(path);
  }
  return found;
}
