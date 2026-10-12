import { execFile } from "node:child_process";
import { dirname, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { type Visibility } from "../../shared/types.ts";
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
