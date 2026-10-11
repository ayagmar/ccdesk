import { access, constants, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Change, type MemoryAction, type MemoryChangePreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isWithin, parseFrontmatter, revisionOf, shownText, stringField } from "./scan/files.ts";
import { deadLinks } from "./scan/memory.ts";
import {
  RefusedError,
  readIfExists,
  recordChange,
  removeExactly,
  serially,
  writeAtomic,
} from "./write.ts";

async function projectsRoot(env: ScanEnv): Promise<string> {
  return realpath(join(env.claudeDir, "projects")).catch(() => {
    throw new RefusedError("There is no auto memory folder.");
  });
}

/** A real `<config>/projects/<store>/memory` folder, after following links. */
export async function assertMemoryDir(env: ScanEnv, dir: string): Promise<string> {
  const real = await realpath(dir).catch(() => {
    throw new RefusedError("That memory folder no longer exists.");
  });
  const root = await projectsRoot(env);
  if (real === root || !isWithin(root, real) || basename(real) !== "memory")
    throw new RefusedError("ccdesk only changes auto memory under ~/.claude/projects.");
  return real;
}

/**
 * A memory folder's MEMORY.md. When it is a link, the file it leads to must be in the same folder,
 * so changing the index can never rewrite a file elsewhere.
 */
export async function indexPathIn(store: string): Promise<string> {
  const path = join(store, "MEMORY.md");
  const real = await realpath(path).catch(() => path);
  if (dirname(real) !== store)
    throw new RefusedError(
      "This MEMORY.md links outside its memory folder; ccdesk leaves it alone."
    );
  return path;
}

/** A topic file inside a memory folder: the only kind of file ccdesk deletes. */
async function assertMemoryFile(env: ScanEnv, path: string): Promise<string> {
  const real = await realpath(path).catch(() => {
    throw new RefusedError("That memory file no longer exists.");
  });
  await assertMemoryDir(env, dirname(real));
  if (!real.endsWith(".md") || basename(real) === "MEMORY.md")
    throw new RefusedError(
      "MEMORY.md is the index Claude maintains; delete individual memories instead."
    );
  if (!(await stat(real)).isFile()) throw new RefusedError("Not a file.");
  return real;
}

/** One fingerprint for two files, so a change can require both as they were reviewed. */
export function revisionOfBoth(first: string | null, second: string | null): string {
  return `${revisionOf(first)}+${revisionOf(second)}`;
}

/** A memory change worked out from disk as it is now: what it shows for review and what it writes. */
interface Plan {
  preview: MemoryChangePreview;
  save: () => Promise<Change>;
}

const reviewAgain = () =>
  new RefusedError("The memory or MEMORY.md changed since you reviewed this; review it again.");

/** Runs a plan only while everything it was worked out from is as reviewed. */
function saveReviewed(plan: () => Promise<Plan>, expectedRevision: string): Promise<Change> {
  return serially(async () => {
    const planned = await plan();
    if (planned.preview.revision !== expectedRevision) throw reviewAgain();
    return planned.save();
  });
}

/** MEMORY.md's lines without the empty ones a trailing newline leaves. */
function indexLines(index: string | null): string[] {
  const lines = (index ?? "").split("\n");
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Deletes a memory with the MEMORY.md lines that point at it. */
async function planDelete(env: ScanEnv, path: string): Promise<Plan> {
  const real = await assertMemoryFile(env, path);
  const text = await readIfExists(env, real);
  const indexPath = await indexPathIn(dirname(real));
  const index = await readIfExists(env, indexPath);
  const removedIndexLines: string[] = [];
  const kept = (index ?? "").split("\n").filter((line) => {
    if (!line.includes(`(${basename(real)})`)) return true;
    removedIndexLines.push(line);
    return false;
  });
  const next = removedIndexLines.length > 0 ? kept.join("\n") : index;
  const revision = revisionOfBoth(text, index);
  const save = async () => {
    // A folder that refuses the delete would leave MEMORY.md changed with the memory still there.
    await access(dirname(real), constants.W_OK);
    // Nothing of the delete is left when the index is as reviewed and the memory is still there,
    // even if Claude rewrote the memory meanwhile.
    const unchanged = async () =>
      revisionOf(await readIfExists(env, indexPath)) === revisionOf(index) &&
      (await readIfExists(env, real)) !== null;
    return recordChange(
      env,
      { kind: "memory-delete", target: real, before: text, removedIndexLines, unchanged },
      async () => {
        // The index goes first: if it changed meanwhile, nothing has been removed yet.
        if (next !== index) await writeAtomic(env, indexPath, next ?? "", revisionOf(index));
        let removed = false;
        try {
          removed = await removeExactly(real, revisionOf(text));
        } finally {
          // Claude may have rewritten the memory while the index was saved; then the index goes back.
          if (!removed && next !== index)
            await writeAtomic(env, indexPath, index ?? "", revisionOf(next)).catch((error) => {
              // The index was already changed, so this is not a "nothing written" refusal.
              throw new RefusedError(
                `MEMORY.md changed again, so ccdesk could not put its line back: ${error instanceof Error ? error.message : error}`
              );
            });
        }
        if (!removed) throw reviewAgain();
        return { target: real, revision: revisionOfBoth(null, next), removedIndexLines };
      }
    );
  };
  return {
    preview: {
      files: [
        { path: real, before: text, after: null },
        ...(next !== index ? [{ path: indexPath, before: index, after: next }] : []),
      ],
      revision,
    },
    save,
  };
}

/** Rewrites MEMORY.md through `edit`, recorded in Recent changes. */
async function planIndex(
  env: ScanEnv,
  store: string,
  edit: (lines: string[]) => string[],
  /** Other text the new index was worked out from, bound into the revision. */
  source: string | null
): Promise<Plan> {
  const path = await indexPathIn(store);
  const before = await readIfExists(env, path);
  const after = `${edit(indexLines(before)).join("\n")}\n`;
  if (after === before) throw new RefusedError("MEMORY.md already says that.");
  const save = () =>
    recordChange(env, { kind: "memory-index", target: path, before }, async () => {
      await writeAtomic(env, path, after, revisionOf(before));
      return { target: path, revision: revisionOf(after) };
    });
  return {
    preview: { files: [{ path, before, after }], revision: revisionOfBoth(before, source) },
    save,
  };
}

/** One line of text: frontmatter can hold multi-line strings, an index line cannot. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Adds a memory that MEMORY.md does not mention, in the `- [name](file) — description` form. */
async function planAdd(env: ScanEnv, memoryPath: string): Promise<Plan> {
  const real = await assertMemoryFile(env, memoryPath);
  const text = await readIfExists(env, real);
  const { data } = parseFrontmatter(text ?? "");
  const name = oneLine(stringField(data, "name")) || basename(real, ".md");
  const description = oneLine(stringField(data, "description"));
  const line = `- [${name}](${basename(real)})${description ? ` — ${description}` : ""}`;
  return planIndex(env, dirname(real), (lines) => [...lines, line], text);
}

/** Removes every MEMORY.md line that points at a memory file that no longer exists. */
async function planRemoveDead(env: ScanEnv, indexPath: string): Promise<Plan> {
  if (basename(indexPath) !== "MEMORY.md")
    throw new RefusedError("Only a memory folder's MEMORY.md can be changed.");
  const store = await assertMemoryDir(env, dirname(indexPath));
  const files = (await readdir(store)).sort();
  return planIndex(
    env,
    store,
    (lines) => lines.filter((line) => deadLinks(line, files).length === 0),
    files.join("\n")
  );
}

const PLANS: Record<MemoryAction, (env: ScanEnv, path: string) => Promise<Plan>> = {
  delete: planDelete,
  add: planAdd,
  "remove-dead": planRemoveDead,
};

export function isMemoryAction(value: string): value is MemoryAction {
  return Object.hasOwn(PLANS, value);
}

/** What a memory action would change, for review. */
export async function previewMemoryChange(
  env: ScanEnv,
  action: MemoryAction,
  path: string
): Promise<MemoryChangePreview> {
  // Shown like any other text: a memory folder could hold a JSON file with secrets.
  const { files, revision } = (await PLANS[action](env, path)).preview;
  return {
    files: files.map((f) => ({
      path: f.path,
      before: shownText(f.before),
      after: shownText(f.after),
    })),
    revision,
  };
}

/**
 * Makes a reviewed memory action. `path` is the memory file, or MEMORY.md for remove-dead; the
 * action runs only while everything its review was worked out from is unchanged.
 */
export function changeMemory(
  env: ScanEnv,
  action: MemoryAction,
  path: string,
  expectedRevision: string
): Promise<Change> {
  return saveReviewed(() => PLANS[action](env, path), expectedRevision);
}
