import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { type TextFile, type Visibility } from "../../shared/types.ts";

const run = promisify(execFile);
/** Claude Code skips a CLAUDE.md larger than this (docs: memory#auto-memory), so ccdesk reads no more. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** ccdesk never reads Claude Code's credentials, whatever name or link leads to them. */
export function isSecretPath(path: string): boolean {
  return basename(path) === ".credentials.json";
}

/**
 * Whether a path, any link on the way, or the file it finally leads to is the credentials file, so
 * a credentials file that is itself a link is caught too. Checked before opening.
 */
export async function leadsToSecret(path: string): Promise<boolean> {
  let current = path;
  for (let hop = 0; hop < 40; hop++) {
    if (isSecretPath(current)) return true;
    const info = await lstat(current).catch(() => null);
    if (!info?.isSymbolicLink()) break;
    current = resolve(dirname(current), await readlink(current));
  }
  return isSecretPath(await realpath(path).catch(() => path));
}

/**
 * A JSON parse failure without the parser's message, which quotes the text around the fault and
 * so can quote a secret.
 */
export function jsonSyntaxError(error: unknown): string {
  const at = /line (\d+) column (\d+)/.exec(String(error));
  return at ? `not valid JSON (line ${at[1]}, column ${at[2]})` : "not valid JSON";
}

/**
 * The text ccdesk shows for a file reached as an instruction, import, memory, agent or skill. A
 * settings or MCP file read this way, whatever it is named, would otherwise show its env and
 * headers values, so anything that parses as JSON is shown parsed with them hidden. Frontmatter can
 * hold the same values, in a subagent's inline MCP servers (docs: sub-agents#scope-mcp-servers-to-a-subagent),
 * so frontmatter that holds any is shown re-written with them hidden.
 */
export function shownText(text: string | null): string | null {
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return shownFrontmatter(text);
  }
  return typeof data === "object" && data !== null
    ? `${JSON.stringify(redactSecrets(data), null, 2)}\n`
    : text;
}

function shownFrontmatter(text: string): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? "");
  } catch {
    return text;
  }
  const redacted = redactSecrets(data);
  if (JSON.stringify(redacted) === JSON.stringify(data)) return text;
  return `---\n${stringifyYaml(redacted)}---\n${text.slice(match[0].length)}`;
}

/** A file named .json that does not parse is not shown: its text could still hold a secret. */
function shownJsonFile(text: string): string {
  try {
    JSON.parse(text);
  } catch {
    return "(a JSON file ccdesk could not parse, so its text is not shown; open it to see it)\n";
  }
  return shownText(text) ?? "";
}

/**
 * A UNC share or a path under /net or /Network. Claude Code does not follow a link there, because
 * looking it up can contact the host it names (docs: memory#share-rules-across-projects-with-symlinks).
 */
export function isNetworkPath(path: string): boolean {
  if (/^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(path)) return false;
  return /^[\\/]{2}[^\\/]/.test(path) || /^\/(net|Network)(\/|$)/.test(path);
}

/** Where a symlink points, read without following it; null for anything else. */
async function linkTarget(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return null;
    return resolve(dirname(path), await readlink(path));
  } catch {
    return null;
  }
}

/** A link to a network location, which ccdesk, like Claude Code, does not follow. */
async function linksToNetwork(path: string): Promise<boolean> {
  const target = await linkTarget(path);
  return target !== null && isNetworkPath(target);
}

/** A pattern where `*` matches anything, matched against the whole string. */
export function wildcard(pattern: string, flags = ""): RegExp {
  const body = pattern
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, flags);
}

export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch {
    return [];
  }
}

export async function readTextFile(path: string): Promise<TextFile | null> {
  try {
    if (await linksToNetwork(path)) return null;
    if (await leadsToSecret(path)) return null;
    const real = await realpath(path);
    const info = await stat(path);
    if (!info.isFile()) return null;
    const handle = await open(path, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(Math.min(info.size, MAX_TEXT_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    text = real.endsWith(".json") ? shownJsonFile(text) : (shownText(text) ?? "");
    const ref: TextFile = {
      path,
      mtime: info.mtime.toISOString(),
      bytes: info.size,
      lines: text === "" ? 0 : text.split("\n").length,
      text,
    };
    if ((await lstat(path)).isSymbolicLink()) ref.realPath = real;
    return ref;
  } catch {
    return null;
  }
}

export async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

type JsonResult =
  | { ok: true; data: Record<string, unknown> }
  /** `unparsed`: the file was read, but is not a JSON object. */
  | { ok: false; missing: boolean; unparsed?: boolean; error: string };

/** A JSON object file; `emptyIsObject` reads an empty file as `{}`. */
export async function readJsonObject(
  path: string,
  { emptyIsObject = false } = {}
): Promise<JsonResult> {
  let raw: string;
  try {
    if (await leadsToSecret(path))
      return { ok: false, missing: false, error: "ccdesk does not read credentials" };
    raw = await readFile(path, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, error: String(error) };
  }
  if (emptyIsObject && raw.trim() === "") return { ok: true, data: {} };
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data))
      return { ok: false, missing: false, unparsed: true, error: "not a JSON object" };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, missing: false, unparsed: true, error: jsonSyntaxError(error) };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A server URL as ccdesk shows it: a user name, password or query string can carry a key, so they
 * are hidden, as Claude Code hides the URL in its own status output (docs: mcp).
 */
export function shownUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password && !u.search) return url;
    if (u.username || u.password) {
      u.username = "•••";
      u.password = "";
    }
    if (u.search) u.search = "?•••";
    return decodeURI(u.toString());
  } catch {
    return url.replace(/\/\/[^/@]*@/, "//•••@").replace(/\?.*$/, "?•••");
  }
}

/**
 * Replace values that commonly hold secrets with a placeholder, keeping the keys: env and headers
 * values, and the user, password and query of a `url`.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return value;
  // Built with fromEntries: assigning a key named __proto__ would set the prototype instead.
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if ((key === "env" || key === "headers") && isRecord(inner))
        return [key, Object.fromEntries(Object.keys(inner).map((k) => [k, "•••"]))];
      if (key === "url" && typeof inner === "string") return [key, shownUrl(inner)];
      return [key, redactSecrets(inner)];
    })
  );
}

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  try {
    const data: unknown = parseYaml(match[1] ?? "");
    return { data: isRecord(data) ? data : {}, body: text.slice(match[0].length) };
  } catch {
    return { data: {}, body: text.slice(match[0].length) };
  }
}

/** The strings in a JSON list; anything else counts as no strings. */
export function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A frontmatter list given as a YAML list or a comma-separated string, such as `paths`. */
export function toStringList(value: unknown): string[] {
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return stringsIn(value);
}

export function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Fingerprint of a file's text, so a change can require the file to be as it was reviewed. */
export function revisionOf(text: string | null): string {
  return text === null ? "missing" : createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function shortHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 10);
}

export async function gitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      timeout: 5000,
    });
    // Git prints forward slashes on Windows too; normalise so path comparisons hold.
    return stdout.trim() ? normalize(stdout.trim()) : null;
  } catch {
    return null;
  }
}

/** Every checkout of the repository `dir` is in, the main one first; empty outside git. */
export async function worktrees(dir: string): Promise<string[]> {
  try {
    const { stdout } = await run("git", ["-C", dir, "worktree", "list", "--porcelain"], {
      timeout: 5000,
    });
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => normalize(line.slice("worktree ".length)));
  } catch {
    return [];
  }
}

/** Main worktree root: worktrees of one repository share Claude Code's auto memory. */
export async function mainWorktreeRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { timeout: 5000 }
    );
    const common = stdout.trim();
    if (!common) return null;
    return common.endsWith("/.git") || common.endsWith("\\.git")
      ? normalize(dirname(common))
      : null;
  } catch {
    return null;
  }
}

/** Git visibility of each path, batched into two git calls per repository. */
export async function visibilityOf(
  root: string | null,
  paths: string[]
): Promise<Map<string, Visibility>> {
  const result = new Map<string, Visibility>();
  if (paths.length === 0) return result;
  if (!root) {
    for (const p of paths) result.set(p, "no-git");
    return result;
  }
  const inside = paths.filter((p) => p !== root && isWithin(root, p));
  for (const p of paths) if (!inside.includes(p)) result.set(p, "no-git");
  if (inside.length === 0) return result;
  const rels = new Map(inside.map((p) => [p, relative(root, p).replaceAll("\\", "/")]));
  const tracked = await gitLines(root, ["ls-files", "--full-name", "-z", "--", ...inside], "\0");
  // check-ignore echoes the paths it matched, and on Windows an absolute path does not come back
  // as written, so it gets relative ones. It accepts -z only with --stdin, so its output is split
  // by line.
  const ignored = await gitLines(
    root,
    ["check-ignore", "--no-index", "--", ...rels.values()],
    "\n"
  );
  for (const [p, rel] of rels) {
    if (tracked.has(rel)) result.set(p, "tracked");
    else if (ignored.has(rel)) result.set(p, "ignored");
    else result.set(p, "untracked");
  }
  return result;
}

// Failures (including check-ignore's exit 1 for "nothing ignored") read as an empty set.
async function gitLines(root: string, args: string[], separator: string): Promise<Set<string>> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], { timeout: 5000 });
    return new Set(stdout.split(separator).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Markdown files under `dir`. A symlinked folder is entered once, so a link loop ends, and a link
 * to a network location is not followed. Depth and count are bounded by ccdesk, since a link can
 * lead anywhere; Claude Code's own limits are not documented.
 */
export async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = async (folder: string, depth: number) => {
    const real = await resolvedPath(folder);
    if (seen.has(real) || depth > MAX_WALK_DEPTH) return;
    seen.add(real);
    for (const name of await listDir(folder)) {
      if (out.length >= MAX_WALK_FILES) return;
      const path = join(folder, name);
      if (await linksToNetwork(path)) continue;
      if (await isDir(path)) await walk(path, depth + 1);
      else if (name.endsWith(".md")) out.push(path);
    }
  };
  await walk(dir, 0);
  return out;
}

const MAX_WALK_DEPTH = 8;
const MAX_WALK_FILES = 1000;
