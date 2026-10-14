import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { storeDirName } from "../../shared/memory.ts";
import { type MemoryStore, type ProjectSummary } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isDir, listDir, openUnlessCredentials } from "./files.ts";
import { isRecord } from "./data.ts";
import { canonicalRoot } from "./git.ts";
import { readMemoryStore } from "./memory.ts";

interface KnownProject extends ProjectSummary {
  /** The project's auto memory, read once for both the counts and the search catalog. */
  store: MemoryStore | null;
}

/** Directories Claude Code has been used in: its project stores, `~/.claude.json`, and the launch directory. */
export async function listProjects(
  env: ScanEnv,
  claudeJson: Record<string, unknown> | null,
  launchDir: string
): Promise<KnownProject[]> {
  const byPath = new Map<string, KnownProject>();
  const storesRoot = join(env.claudeDir, "projects");
  // Claude Code keys Windows folders with forward slashes; listed here as Windows writes them.
  const knownPaths = (isRecord(claudeJson?.projects) ? Object.keys(claudeJson.projects) : []).map(
    (key) => (env.platform === "win32" ? key.replaceAll("/", "\\") : key)
  );

  const add = async (path: string, storeDir: string, sessions: Transcript[]) => {
    const store = await readMemoryStore(env, join(storeDir, "memory"), path);
    byPath.set(path, {
      path,
      store,
      exists: await isDir(path),
      sessions: sessions.length,
      lastActive: sessions[0] ? new Date(sessions[0].mtime).toISOString() : null,
      memories: store?.memories.length ?? 0,
      ephemeral: isEphemeral(env, path),
    });
  };
  const unnamed: Array<{ name: string; storeDir: string; sessions: Transcript[] }> = [];
  for (const name of await listDir(storesRoot)) {
    const storeDir = join(storesRoot, name);
    if (!(await isDir(storeDir))) continue;
    const sessions = await newestFirst(
      storeDir,
      (await listDir(storeDir)).filter((f) => f.endsWith(".jsonl"))
    );
    const path =
      knownPaths.find((p) => storeDirName(p) === name) ??
      (await sessionCwd(env, storeDir, sessions)) ??
      null;
    if (path) await add(path, storeDir, sessions);
    else unnamed.push({ name, storeDir, sessions });
  }
  const byName = storeNames([...knownPaths, ...byPath.keys(), resolve(launchDir)]);
  const claims = await Promise.all(
    unnamed.map(async (store) => {
      const match = byName.get(store.name);
      if (!match || byPath.has(match.path)) return null;
      return (await usesStore(match, store.name, store.storeDir)) ? { ...store, ...match } : null;
    })
  );
  for (const claim of claims)
    if (claim && !byPath.has(claim.path)) await add(claim.path, claim.storeDir, claim.sessions);
  for (const path of [...knownPaths, resolve(launchDir)]) {
    if (byPath.has(path)) continue;
    byPath.set(path, {
      path,
      store: null,
      exists: await isDir(path),
      sessions: 0,
      lastActive: null,
      memories: 0,
      ephemeral: isEphemeral(env, path),
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Auto memory is named after the repository root, so a repository where Claude Code only ran in
 * subfolders has a store with no sessions and no entry of its own. Such a store goes to the known
 * directory, or the nearest ancestor of one, that gives its name (see `usesStore`). A name can come from more than
 * one path (a/b and a-b both give "a-b"); Claude Code then uses one store for both, and ccdesk
 * lists it under the nearer one, else the first by path.
 */
function storeNames(known: string[]): Map<string, { path: string; depth: number }> {
  const byName = new Map<string, { path: string; depth: number }>();
  for (const path of known) {
    for (let d = path, depth = 0; ; d = dirname(d), depth++) {
      const name = storeDirName(d);
      const seen = byName.get(name);
      if (!seen || depth < seen.depth || (depth === seen.depth && d.localeCompare(seen.path) < 0))
        byName.set(name, { path: d, depth });
      if (dirname(d) === d) break;
    }
  }
  return byName;
}

/**
 * Whether a store matched by name is the one Claude Code uses at `match.path` and holds memory. An
 * ancestor's store can be a leftover, such as one from before `git init` at a parent folder, which
 * Claude Code no longer uses there; its page would show another store. A store without a memory
 * folder adds only an empty row.
 */
async function usesStore(
  match: { path: string; depth: number },
  name: string,
  storeDir: string
): Promise<boolean> {
  if (!(await isDir(join(storeDir, "memory")))) return false;
  return storeDirName(await canonicalRoot(match.path)) === name;
}

function isEphemeral(env: ScanEnv, path: string): boolean {
  return (
    path.startsWith("/tmp/") ||
    path === "/tmp" ||
    path.startsWith("/run/") ||
    path.startsWith("/private/var/folders/") ||
    path.startsWith("/var/folders/") ||
    path.startsWith("/private/tmp/") ||
    /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(path) ||
    path.startsWith(join(env.home, ".config", "Claude", "scratch-workspaces"))
  );
}

interface Transcript {
  file: string;
  mtime: number;
}

/** Transcripts by last change, newest first; stat calls run in batches rather than one by one. */
async function newestFirst(dir: string, files: string[]): Promise<Transcript[]> {
  const out: Transcript[] = [];
  for (let i = 0; i < files.length; i += 64) {
    const batch = await Promise.all(
      files.slice(i, i + 64).map(async (file) => {
        const info = await stat(join(dir, file)).catch(() => null);
        return info ? { file, mtime: info.mtimeMs } : null;
      })
    );
    out.push(...batch.filter((t): t is Transcript => t !== null));
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** The `cwd` recorded in the newest transcripts, for store names that do not map back cleanly. */
async function sessionCwd(
  env: ScanEnv,
  storeDir: string,
  sessions: Transcript[]
): Promise<string | null> {
  for (const { file } of sessions.slice(0, 3)) {
    const handle = await openUnlessCredentials(env, join(storeDir, file)).catch(() => null);
    if (!handle) continue;
    const input = handle.createReadStream({ encoding: "utf8" });
    const lines = createInterface({ input });
    let read = 0;
    try {
      for await (const line of lines) {
        if (++read > 50) break;
        if (!line.includes('"cwd"')) continue;
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed) && typeof parsed.cwd === "string") return parsed.cwd;
      }
    } catch {
      // A truncated or malformed transcript line: try the next file.
    } finally {
      lines.close();
      input.destroy();
    }
  }
  return null;
}
