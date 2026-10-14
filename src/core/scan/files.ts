import { createHash } from "node:crypto";
import { type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open, readdir, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import { type Problem, type TextFile } from "../../shared/types.ts";
import { jsonSyntaxError, shownJsonFile, shownText } from "../secrets.ts";
import { isRecord, parseJson } from "./data.ts";
import { type ScanEnv } from "./env.ts";

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
async function leadsToSecret(path: string): Promise<boolean> {
  let current = path;
  for (let hop = 0; hop < 40; hop++) {
    if (isSecretPath(current)) return true;
    const info = await lstat(current).catch(() => null);
    if (!info?.isSymbolicLink()) break;
    current = resolve(dirname(current), await readlink(current));
  }
  return isSecretPath(await realpath(path).catch(() => path));
}

/** The identity of `<config>/.credentials.json`, or null when there is none. */
function credentialsIdentity(env: ScanEnv): Promise<BigIntStats | null> {
  return stat(join(env.claudeDir, ".credentials.json"), { bigint: true }).catch(() => null);
}

function sameFile(a: BigIntStats, b: BigIntStats | null): boolean {
  return b !== null && a.dev === b.dev && a.ino === b.ino;
}

/**
 * Whether a path is Claude Code's credentials file: by name, through any link on the way, or by
 * being the same file as `<config>/.credentials.json`, so a copy kept under another name or a hard
 * link to it counts too.
 */
export async function isCredentials(env: ScanEnv, path: string): Promise<boolean> {
  if (await leadsToSecret(path)) return true;
  const info = await stat(path, { bigint: true }).catch(() => null);
  return info !== null && sameFile(info, await credentialsIdentity(env));
}

/**
 * Opens a file to read, or null for the credentials file. The open file is checked again, so a
 * file swapped in after the first check is not read either.
 */
export async function openUnlessCredentials(
  env: ScanEnv,
  path: string
): Promise<FileHandle | null> {
  if (await isCredentials(env, path)) return null;
  const handle = await open(path, "r");
  if (sameFile(await handle.stat({ bigint: true }), await credentialsIdentity(env))) {
    await handle.close();
    return null;
  }
  return handle;
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
  // Only the parent segment leads out; a name such as ..cache is inside.
  const up = rel === ".." || rel.startsWith(`..${sep}`);
  return rel === "" || (!up && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
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

/**
 * A text file, or null when there is none to read: nothing at the path, a folder, a link to a
 * network location, or the credentials file. A file that is there but cannot be read, such as one
 * without read permission or a link loop, also goes into `problems`.
 */
export async function readTextFile(
  env: ScanEnv,
  path: string,
  problems?: Problem[]
): Promise<TextFile | null> {
  try {
    if (await linksToNetwork(path)) return null;
    const real = await realpath(path);
    const info = await stat(path);
    if (!info.isFile()) return null;
    const handle = await openUnlessCredentials(env, path);
    if (!handle) return null;
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
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR")
      problems?.push({ path, error: `cannot be read (${code ?? String(error)})` });
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
  env: ScanEnv,
  path: string,
  { emptyIsObject = false } = {}
): Promise<JsonResult> {
  let raw: string;
  try {
    const handle = await openUnlessCredentials(env, path);
    if (!handle) return { ok: false, missing: false, error: "ccdesk does not read credentials" };
    try {
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Worded as readTextFile words it, without Node's message and the absolute path it repeats.
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      missing: code === "ENOENT",
      error: `cannot be read (${code ?? String(error)})`,
    };
  }
  if (emptyIsObject && raw.trim() === "") return { ok: true, data: {} };
  try {
    const data: unknown = parseJson(raw);
    if (!isRecord(data))
      return { ok: false, missing: false, unparsed: true, error: "not a JSON object" };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, missing: false, unparsed: true, error: jsonSyntaxError(error) };
  }
}

/** The object in a JSON file, or null; a file that is there but does not read or parse goes into `problems`. */
export async function readJsonOrReport(
  env: ScanEnv,
  path: string,
  problems: Problem[]
): Promise<Record<string, unknown> | null> {
  const result = await readJsonObject(env, path);
  if (result.ok) return result.data;
  if (!result.missing) problems.push({ path, error: result.error });
  return null;
}

/** The strings in a JSON list; anything else counts as no strings. */
export function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * A frontmatter list given as a YAML list or a comma-separated string, such as `paths`. Like
 * Claude Code, it splits a string and each list item at commas outside braces, so
 * `src/*.{ts,tsx}` stays one glob (docs: memory#rules-frontmatter-reference).
 */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value !== "string") return [];
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "{") depth++;
    else if (char === "}") depth--;
    if (char === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * A rule's or skill's `paths` globs as written, or none when it applies everywhere: without the
 * field, or when each of its patterns is empty or `**` (observed in v2.1.296; the docs do not say).
 */
export function pathsField(value: unknown): string[] {
  const paths = toStringList(value);
  return pathPatterns(paths)
    .flat()
    .every((p) => p === "**")
    ? []
    : paths;
}

/**
 * The glob in `globs` that matches `path`, relative to the folder the globs are read from, or
 * none. Claude Code 2.1.296 matches with gitignore rules (the ignore package): a pattern without
 * a slash matches at any depth, `*` and `**` match dot folders, and case does not count. The docs
 * read differently, such as `*.md` for Markdown files in the project root only; ccdesk follows
 * Claude Code (docs: memory#path-specific-rules).
 */
export function matchingGlob(globs: string[], path: string): string | undefined {
  // Claude Code matches nothing outside the folder, nor a path that starts with two dots.
  if (path === "" || path.startsWith("..")) return undefined;
  const patterns = pathPatterns(globs).map((each) => each.filter(compiles));
  if (!ignore().add(patterns.flat()).ignores(path)) return undefined;
  return globs.find((_, i) =>
    ignore()
      .add(patterns[i] ?? [])
      .ignores(path)
  );
}

/**
 * Whether the ignore package can use a pattern; one it cannot, such as one too long for a regular
 * expression, matches nothing and the others still count, as in Claude Code 2.1.296 (docs:
 * memory#path-specific-rules).
 */
function compiles(pattern: string): boolean {
  try {
    ignore().add([pattern]).test("probe");
    return true;
  } catch {
    return false;
  }
}

/**
 * The patterns Claude Code matches for each glob: braces expanded, then a trailing `/**` cut, so
 * `src/**` is the folder `src` at any depth (observed in v2.1.296).
 */
function pathPatterns(globs: string[]): string[][] {
  const budget = { patterns: MAX_BRACE_PATTERNS, bytes: MAX_BRACE_BYTES };
  return globs.map((glob) =>
    expandBraces(glob, budget)
      .map((p) => (p.endsWith("/**") ? p.slice(0, -3) : p))
      .filter(Boolean)
  );
}

/** A `paths` list shares this budget of expanded patterns (docs: memory#path-specific-rules). */
const MAX_BRACE_PATTERNS = 1000;
const MAX_BRACE_BYTES = 4 * 1024 * 1024;

/**
 * A glob with each `{a,b}` group expanded, first group first, as Claude Code does. A glob whose
 * expansion would exceed what is left of the budget is kept as written, so its braces match
 * nothing (docs: memory#path-specific-rules).
 */
function expandBraces(glob: string, budget: { patterns: number; bytes: number }): string[] {
  if (!glob.includes("{")) return [glob];
  const done: string[] = [];
  const pending = [glob];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const group = /^([^{]*)\{([^}]+)\}(.*)$/.exec(next);
    if (!group) {
      done.push(next);
      continue;
    }
    const [, before = "", options = "", after = ""] = group;
    const choices = options.split(",").map((c) => c.trim());
    budget.bytes -= next.length;
    const count = done.length + pending.length + choices.length;
    if (budget.bytes < 0 || count > budget.patterns || count * glob.length > budget.bytes)
      return [glob];
    for (let i = choices.length - 1; i >= 0; i--) pending.push(before + choices[i] + after);
  }
  budget.patterns -= done.length;
  budget.bytes -= done.length * glob.length;
  return done;
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

/**
 * Markdown files under `dir`. A symlinked folder is entered once, so a link loop ends, and a link
 * to a network location is not followed, `dir` and the folder holding it included; such a `dir`
 * goes into `problems`. Depth and count are bounded by ccdesk, since a link can lead anywhere;
 * Claude Code's own limits are not documented.
 */
export async function walkMarkdown(dir: string, problems?: Problem[]): Promise<string[]> {
  if ((await linksToNetwork(dir)) || (await linksToNetwork(dirname(dir)))) {
    problems?.push({
      path: dir,
      error:
        "links to a network location, which Claude Code does not follow, so ccdesk does not read it either",
    });
    return [];
  }
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
