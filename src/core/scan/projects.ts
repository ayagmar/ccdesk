import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { storeDirName } from "../../shared/memory.ts";
import { type MemoryStore, type ProjectSummary } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isDir, listDir, openUnlessCredentials } from "./files.ts";
import { isRecord } from "./data.ts";
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
    if (!path) continue;
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
  }
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
