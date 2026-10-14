import { lstat, readdir, rename, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { storeDirName } from "../shared/memory.ts";
import { type Change, type ForgetPreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isDir, readJsonObject, revisionOf } from "./scan/files.ts";
import { claudeJsonPaths, listProjects, storeCwds } from "./scan/projects.ts";
import {
  MOVED_STORE,
  type Planned,
  RefusedError,
  recordChange,
  type Serially,
  saveReviewed,
} from "./write.ts";

/**
 * Every file in a store with its size and last change, one per line, and their total size. A link
 * is listed as itself, never followed.
 */
export async function storeContents(dir: string): Promise<{ listing: string; bytes: number }> {
  const lines: string[] = [];
  let bytes = 0;
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const info = await lstat(path).catch(() => null);
      if (!info) continue;
      bytes += info.size;
      lines.push(`${relative(dir, path)}\t${info.size}\t${info.mtimeMs}`);
    }
  };
  await walk(dir);
  return { listing: `${lines.sort().join("\n")}\n`, bytes };
}

/** A session written this recently may still be running. */
const RECENT_MS = 5 * 60_000;

/**
 * Whether there is a folder at `path`. Only a stat that finds nothing there (ENOENT, or ENOTDIR for
 * a file in its way) counts as gone; a folder ccdesk cannot reach, such as one behind a parent
 * without search permission or on a stale network mount, is refused rather than taken as gone.
 */
async function folderExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new RefusedError(`ccdesk cannot tell whether ${path} exists (${code ?? String(error)}).`);
  }
}

/**
 * Forgetting a directory whose folder is gone, worked out from disk as it is now. Only its store
 * moves; `~/.claude.json`, which ccdesk never writes, keeps its entry, and the scan leaves out a
 * directory known only from there whose folder is gone.
 */
async function planForget(
  env: ScanEnv,
  dir: string,
  launchDir: string
): Promise<Planned<ForgetPreview, Change>> {
  const path = resolve(dir);
  if (path === resolve(launchDir))
    throw new RefusedError(
      "ccdesk was started in this directory, so it stays listed; start ccdesk somewhere else to forget it."
    );
  if (await folderExists(path))
    throw new RefusedError(`${path} exists; ccdesk forgets only a directory whose folder is gone.`);
  const read = await readJsonObject(env, env.claudeJson);
  const claudeJson = read.ok ? read.data : null;
  const projects = await listProjects(env, claudeJson, launchDir);
  const project = projects.find((p) => p.path === path);
  const store = project?.storeDir;
  if (!project || !store)
    throw new RefusedError("Claude Code keeps no sessions or memory for this directory.");
  // Store names replace every character but letters and digits with a dash, so my.app and my-app
  // share one: a store another directory that still exists uses is never moved away.
  const name = basename(store);
  const sharing = [
    ...new Set([
      resolve(launchDir),
      ...claudeJsonPaths(env, claudeJson),
      ...(await storeCwds(env, store)),
    ]),
  ].filter((p) => p !== path && storeDirName(p) === name);
  for (const other of sharing)
    if (await folderExists(other))
      throw new RefusedError(
        `${other} exists and uses the same store, ${store}; forgetting ${path} would take its sessions and memory too.`
      );
  const { listing, bytes } = await storeContents(store);
  const newest = project.lastActive === null ? null : Date.parse(project.lastActive);
  return {
    preview: {
      path,
      store,
      sessions: project.sessions,
      memories: project.memories,
      bytes,
      claudeJsonEntry: project.inClaudeJson,
      recentlyActive: newest !== null && Date.now() - newest < RECENT_MS,
      revision: revisionOf(`${path}\0${store}\0${listing}`),
    },
    save: () =>
      recordChange(
        env,
        {
          kind: "directory-forget",
          target: store,
          // The listing, so Recent changes can tell whether the store it moves back is the one moved.
          before: listing,
          projectPath: path,
          unchanged: () => isDir(store),
        },
        async (backupDir) => {
          // A rename, not a copy: the backup folder is in the same Claude folder.
          await rename(store, join(backupDir, MOVED_STORE)).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
            throw new RefusedError(
              `${store} is on another drive than ccdesk's backup folder, so ccdesk cannot move it aside.`
            );
          });
          return { target: store, revision: revisionOf(null) };
        }
      ),
  };
}

/** What forgetting a directory whose folder is gone would move away. */
export async function previewForget(
  env: ScanEnv,
  dir: string,
  launchDir: string
): Promise<ForgetPreview> {
  return (await planForget(env, dir, launchDir)).preview;
}

/**
 * Moves the store of a directory whose folder is gone into a backup folder, so the directory is no
 * longer listed and Recent changes can move it back. Refused for the launch directory and for a
 * folder that exists again, checked anew rather than taken from the review.
 */
export function forgetDirectory(
  env: ScanEnv,
  dir: string,
  launchDir: string,
  expectedRevision: string,
  queue: Serially
): Promise<Change> {
  return saveReviewed(
    queue,
    () => planForget(env, dir, launchDir),
    expectedRevision,
    "The directory's store changed since you reviewed this; review it again."
  );
}
