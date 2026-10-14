import { execFile } from "node:child_process";
import { basename, dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { type Visibility } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isWithin } from "./files.ts";

const run = promisify(execFile);

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

/**
 * The folder Claude Code names a repository's auto memory after, so that every worktree and
 * subfolder shares one store (docs: memory#storage-location): the main checkout's root, the bare
 * folder itself for a worktree of a bare repository, else the repository root, as in a submodule
 * (observed in v2.1.296). Outside git it is `dir`.
 */
export async function memoryKey(dir: string): Promise<string> {
  try {
    const { stdout } = await run(
      "git",
      [
        "-C",
        dir,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
        "--git-dir",
      ],
      { timeout: 5000 }
    );
    const [top, common, gitDir] = stdout.split("\n").map((line) => normalize(line.trim()));
    if (!top || !common || !gitDir) return dir;
    if (basename(common) === ".git") return dirname(common);
    // A linked worktree's git folder is <common>/worktrees/<name>; a submodule's is the common one.
    return dirname(gitDir) === join(common, "worktrees") ? common : top;
  } catch {
    return dir;
  }
}

/**
 * The key ~/.claude.json keeps a folder's trust answers and local MCP servers under: the main
 * checkout's root, else the repository root, else the folder itself outside git. The scan reads
 * under it and `claude mcp add --scope local` writes under it, so both take it from here.
 */
export function trustKey(dir: string, mainRoot: string | null, root: string | null): string {
  return mainRoot ?? root ?? dir;
}

/**
 * A folder as ~/.claude.json names it under `projects`: Claude Code writes Windows paths with
 * forward slashes (observed in v2.1.296; the docs do not say), so lookups go through this.
 */
export function claudeJsonKey(env: ScanEnv, path: string): string {
  return env.platform === "win32" ? path.replaceAll("\\", "/") : path;
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
