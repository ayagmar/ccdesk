import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import { BACKUP_KINDS, type BackupKind } from "../shared/types.ts";
import { isRecord, parseJson } from "./scan/data.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isCredentials, isSecretPath, revisionOf } from "./scan/files.ts";
import { jsonSyntaxError } from "./secrets.ts";

/** A change ccdesk refuses on purpose; the server answers 409 with the message. */
export class RefusedError extends Error {}

/** A write refused because its file changed after review: nothing was written. */
export class StaleError extends RefusedError {}

const CREDENTIALS = "ccdesk does not read or change Claude Code's credentials.";
const STATE_FILE = "ccdesk does not change ~/.claude.json; Claude Code rewrites it all the time.";

/**
 * Runs changes one at a time, so two of them can never both pass a revision check before either
 * writes. Every exported change goes through one; helpers it calls must not.
 */
export type Serially = <T>(change: () => Promise<T>) => Promise<T>;

/** A new, empty queue of changes. Each core has its own. */
export function changeQueue(): Serially {
  let queue: Promise<unknown> = Promise.resolve();
  return (change) => {
    const run = queue.then(change);
    queue = run.catch(() => undefined);
    return run;
  };
}

/** What every change's review has: the revision it was worked out from and why it cannot be saved. */
interface Review {
  /** Fingerprint of everything the change was worked out from. */
  revision: string;
  /** When there are any, nothing is saved. */
  errors?: string[];
}

/** A change worked out from disk as it is now: what it shows for review, and how to make it. */
export interface Planned<Preview extends Review, T> {
  preview: Preview;
  save: () => Promise<T>;
}

/**
 * Plans a change again and makes it, but only when it has no errors and everything it was worked
 * out from is as reviewed; `changed` is the refusal otherwise. Planning and saving share one turn
 * of the queue, so no other change lands between the check and the write.
 */
export function saveReviewed<T>(
  queue: Serially,
  plan: () => Promise<Planned<Review, T>>,
  expectedRevision: string,
  changed: string
): Promise<T> {
  return queue(async () => {
    const { preview, save } = await plan();
    const errors = preview.errors ?? [];
    if (errors.length > 0) throw new RefusedError(errors.join("; "));
    if (preview.revision !== expectedRevision) throw new RefusedError(changed);
    return save();
  });
}

export function backupRoot(env: ScanEnv): string {
  return join(env.claudeDir, "backups", "ccdesk");
}

/** Where a path leads after links, or null when it does not exist. */
function realOrNull(path: string): Promise<string | null> {
  return realpath(path).catch(() => null);
}

/**
 * The revision a review of one file is saved against: its content, the path, and where the path
 * leads. Saving works the change out again, so without the path a file that moved after the review
 * (a local settings file once its folder becomes a git repository, a link pointed elsewhere) would
 * be written instead of the one reviewed; two missing files have the same content.
 */
export async function reviewRevision(path: string, raw: string | null): Promise<string> {
  return revisionOf(`${path}\0${await leadsTo(path)}\0${revisionOf(raw)}`);
}

/**
 * Where a path leads after links. A file that does not exist yet leads where its nearest existing
 * folder does, so a linked parent folder pointed elsewhere changes it too.
 */
async function leadsTo(path: string): Promise<string> {
  const rest: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    const real = await realOrNull(at);
    if (real) return join(real, ...rest);
    if (dirname(at) === at) return path;
    rest.unshift(basename(at));
  }
}

/** The file a path leads to after links; a missing file keeps its own path. */
async function target(env: ScanEnv, path: string): Promise<string> {
  if (await isCredentials(env, path)) throw new RefusedError(CREDENTIALS);
  try {
    const real = await realpath(path);
    if (isSecretPath(real) || isSecretPath(path)) throw new RefusedError(CREDENTIALS);
    return real;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if ((await lstat(path).catch(() => null))?.isSymbolicLink())
      throw new RefusedError(
        `${path} is a link to a file that does not exist; fix the link first.`
      );
    if (isSecretPath(path)) throw new RefusedError(CREDENTIALS);
    return path;
  }
}

/** The file's text, or null when it does not exist. Any other read error is thrown, not hidden. */
export async function readIfExists(env: ScanEnv, path: string): Promise<string | null> {
  try {
    return await readFile(await target(env, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A JSON file that holds an object, as ccdesk edits it: missing or empty is `{}`, anything else
 * that is not an object is refused. `reformats` says whether writing it back as 2-space JSON
 * changes more than the edit, since its diff is rendered from the parsed file.
 */
export async function readJsonObject(
  env: ScanEnv,
  path: string
): Promise<{ raw: string | null; data: Record<string, unknown>; reformats: boolean }> {
  const raw = await readIfExists(env, path);
  if (raw === null || raw.trim() === "") return { raw, data: {}, reformats: false };
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch (error) {
    throw new RefusedError(`${path} is ${jsonSyntaxError(error)}; fix it by hand first.`);
  }
  if (!isRecord(parsed)) throw new RefusedError(`${path} does not hold a JSON object.`);
  return { raw, data: parsed, reformats: raw !== `${JSON.stringify(parsed, null, 2)}\n` };
}

/**
 * Replaces a file's content, but only while it still has `expected` revision. The new text is
 * written to a temporary file first and the revision is checked again just before the rename, so
 * an edit made elsewhere while ccdesk was saving is kept and the save refused. A symlink is written
 * through, so links into a dotfiles repository survive; the temporary file is new, unguessable and
 * created exclusively, so nothing planted beside the target can redirect the write. A file with
 * other hard links is refused, since the rename would leave them on the old text.
 */
export async function writeAtomic(
  env: ScanEnv,
  path: string,
  content: string,
  expected: string
): Promise<void> {
  const file = await target(env, path);
  if (basename(file) === ".claude.json" || file === (await realOrNull(env.claudeJson)))
    throw new RefusedError(STATE_FILE);
  await mkdir(dirname(file), { recursive: true });
  const existing = await lstat(file).catch(() => null);
  if (existing && existing.nlink > 1)
    throw new RefusedError(
      `${path} has other hard links, and saving it would split it from its other names; edit it in your editor.`
    );
  const temp = join(dirname(file), `.${basename(file)}.ccdesk-${randomBytes(6).toString("hex")}`);
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(content, "utf8");
      await handle.chmod(existing ? existing.mode & 0o7777 : 0o666 & ~process.umask());
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (revisionOf(await readIfExists(env, file)) !== expected)
      throw new StaleError(
        `${path} changed while ccdesk was saving; nothing was written. Review it again.`
      );
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Deletes a file only while it still has `expected` revision, and says whether it did. The file is
 * renamed aside first, so what is removed is exactly what was checked; one that differs is put
 * back, unless a new file took its place meanwhile, which ccdesk then refuses to overwrite.
 */
export async function removeExactly(path: string, expected: string): Promise<boolean> {
  const aside = join(dirname(path), `.${basename(path)}.ccdesk-${randomBytes(6).toString("hex")}`);
  await rename(path, aside);
  let text: string;
  try {
    text = await readFile(aside, "utf8");
  } catch (error) {
    await rename(aside, path);
    throw error;
  }
  if (revisionOf(text) === expected) {
    await rm(aside);
    return true;
  }
  try {
    await link(aside, path);
  } catch (error) {
    const replaced =
      (error as NodeJS.ErrnoException).code === "EEXIST" ||
      (await lstat(path).catch(() => null)) !== null;
    if (replaced)
      throw new RefusedError(
        `${path} changed and was replaced while ccdesk removed it; the earlier text is kept in ${aside}.`
      );
    // A file system without hard links: put it back by name. Unlike a link, this would replace a
    // file created in the instant since the check above.
    await rename(aside, path);
    return false;
  }
  await rm(aside);
  return false;
}

/** What a backup folder records about its change, in its manifest. */
export const BackupManifestSchema = Type.Object({
  kind: Type.Enum(BACKUP_KINDS),
  /** The file that changed (for a deleted memory: the memory file; for a forgotten directory: its store folder). */
  target: Type.String(),
  createdAt: Type.String(),
  /** Revision of the target before the change; "missing" when ccdesk created it. */
  before: Type.String(),
  /** Revision of the target right after the change; "pending" while it runs, "partial" when it failed halfway. */
  after: Type.String(),
  /** For a deleted memory: the MEMORY.md lines removed with it. */
  removedIndexLines: Type.Optional(Type.Array(Type.String())),
  /** For a change made through `claude mcp`: the commands that put it back, values hidden. */
  undoCommands: Type.Optional(Type.Array(Type.String())),
  /** For a memory change or a forgotten directory: the directory its store is saved for. */
  projectPath: Type.Optional(Type.String()),
});
export type BackupManifest = Static<typeof BackupManifestSchema>;

export const MANIFEST = "ccdesk-backup.json";

/** Takes a change out of Recent changes, for one whose effect was undone again right away. */
export function forgetChange(env: ScanEnv, id: string): Promise<void> {
  return rm(join(backupRoot(env), id), { recursive: true, force: true });
}
/** The copy of the target inside a backup folder. */
export const SNAPSHOT = "before";
/** For a change made through `claude mcp`: the affected servers after it, values hidden. */
export const SHOWN_AFTER = "after";
/** For a forgotten directory: its store folder, moved into the backup folder as it was. */
export const MOVED_STORE = "store";

/** A new, empty backup folder that only you can read, and its id. */
async function newBackup(env: ScanEnv, kind: BackupKind) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}-${kind}`;
  const root = backupRoot(env);
  const dir = join(root, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  return { createdAt, id, dir };
}

/**
 * Lists a change Claude Code made through `claude mcp` in Recent changes. ccdesk cannot undo it,
 * so it keeps only the affected servers before and after as the page shows them, secrets hidden,
 * and the commands that would put them back; never a value the page does not show.
 */
export async function recordClaudeMcpChange(
  env: ScanEnv,
  record: { target: string; shownBefore: string; shownAfter: string; undoCommands: string[] }
): Promise<void> {
  const { createdAt, dir } = await newBackup(env, "mcp-claude");
  const manifest: BackupManifest = {
    kind: "mcp-claude",
    target: record.target,
    createdAt,
    before: revisionOf(record.shownBefore),
    after: revisionOf(record.shownAfter),
    undoCommands: record.undoCommands,
  };
  try {
    await writeFile(join(dir, SNAPSHOT), record.shownBefore, { mode: 0o600 });
    await writeFile(join(dir, SHOWN_AFTER), record.shownAfter, { mode: 0o600 });
    // Written last, so a folder without it is never listed.
    await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Makes a change and records it in Recent changes. The file's previous text and a manifest are put
 * in a new backup folder first, so a change interrupted halfway can still be restored; the manifest
 * gets the new revision once the change is made. A change that fails is removed from Recent changes
 * when its first write was refused as stale, or when `unchanged` confirms nothing on disk moved;
 * otherwise it stays, marked partial, so it can be put back. Backups can hold settings with secrets, so only the user can read them.
 */
export async function recordChange<T extends { revision: string }>(
  env: ScanEnv,
  record: {
    kind: BackupKind;
    target: string;
    before: string | null;
    removedIndexLines?: string[];
    /** For a memory change: the directory its store is saved for. */
    projectPath?: string | undefined;
    /** Whether disk is still as before the change; by default, whether the target is. */
    unchanged?: () => Promise<boolean>;
  },
  /** Makes the change; it is given the change's backup folder, for a change that moves into it. */
  change: (backupDir: string) => Promise<T>
): Promise<T & { id: string; created: boolean }> {
  const { createdAt, id, dir } = await newBackup(env, record.kind);
  const manifest: BackupManifest = {
    kind: record.kind,
    target: record.target,
    createdAt,
    before: revisionOf(record.before),
    after: "pending",
    ...(record.removedIndexLines ? { removedIndexLines: record.removedIndexLines } : {}),
    ...(record.projectPath ? { projectPath: record.projectPath } : {}),
  };
  // Replaced by rename, so an interrupted rewrite leaves the earlier manifest rather than half of one.
  const writeManifest = async () => {
    const temp = join(dir, `${MANIFEST}.next`);
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, join(dir, MANIFEST));
  };
  try {
    if (record.before !== null)
      await writeFile(join(dir, SNAPSHOT), record.before, { mode: 0o600 });
    await writeManifest();
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  let result: T;
  try {
    result = await change(dir);
  } catch (error) {
    const unchanged =
      record.unchanged ??
      (async () =>
        revisionOf(await readIfExists(env, record.target)) === revisionOf(record.before));
    // A stale refusal from the change's own first write means ccdesk wrote nothing; changes that
    // write more than once turn a later stale refusal into a plain one (see deleteMemory).
    if (error instanceof StaleError || (await unchanged().catch(() => false))) {
      await rm(dir, { recursive: true, force: true });
    } else {
      manifest.after = "partial";
      await writeManifest().catch(() => undefined);
    }
    throw error;
  }
  manifest.after = result.revision;
  await writeManifest();
  return { ...result, id, created: record.before === null };
}
