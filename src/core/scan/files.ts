import { createHash } from "node:crypto";
import { type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open, readdir, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, error: String(error) };
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
