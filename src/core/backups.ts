import { lstat, mkdir, readdir, readFile, realpath, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Compile } from "typebox/compile";
import { type BackupSummary, type ChangeView, type RestorePreview } from "../shared/types.ts";
import { storeContents } from "./forget.ts";
import { assertMemoryDir, indexPathIn, revisionOfBoth } from "./mutations.ts";
import { parseJson } from "./scan/data.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isDir, isWithin, revisionOf } from "./scan/files.ts";
import { hiddenValues, shown, shownText } from "./secrets.ts";
import {
  type BackupManifest,
  BackupManifestSchema,
  backupRoot,
  forgetChange,
  MANIFEST,
  MOVED_STORE,
  RefusedError,
  readIfExists,
  recordChange,
  removeExactly,
  type Serially,
  SHOWN_AFTER,
  SNAPSHOT,
  StaleError,
  writeAtomic,
} from "./write.ts";

const backupManifest = Compile(BackupManifestSchema);

/** A backup folder's manifest; anything that does not look like one ccdesk wrote is skipped. */
async function readManifest(env: ScanEnv, id: string): Promise<BackupManifest | null> {
  // ccdesk's ids are letters, digits and dashes, so no id can name a folder outside the root.
  if (!/^[\w-]+$/.test(id)) return null;
  let text: string | null;
  try {
    text = await readIfExists(env, join(backupRoot(env), id, MANIFEST));
  } catch (error) {
    // A stray file in the backup folder is not a backup; a folder ccdesk cannot read is an error.
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return null;
    throw error;
  }
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return backupManifest.Check(data) ? data : null;
}

/**
 * Backup folder names, newest first. No folder yet means no changes; one ccdesk cannot read, such
 * as one a `sudo ccdesk` left owned by root, is an error rather than an empty list.
 */
async function backupIds(env: ScanEnv): Promise<string[]> {
  try {
    return (await readdir(backupRoot(env))).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The changes ccdesk made, newest first, a page at a time. */
export async function listBackups(
  env: ScanEnv,
  { before, limit }: { before?: string; limit: number }
): Promise<{ changes: BackupSummary[]; more: boolean }> {
  const ids = await backupIds(env);
  const changes: BackupSummary[] = [];
  for (const id of ids) {
    if (before !== undefined && id >= before) continue;
    const manifest = await readManifest(env, id);
    if (!manifest) continue;
    if (changes.length === limit) return { changes, more: true };
    changes.push({
      id,
      kind: manifest.kind,
      target: manifest.target,
      createdAt: manifest.createdAt,
      created: manifest.before === revisionOf(null),
      ...(manifest.after === "pending" || manifest.after === "partial" ? { incomplete: true } : {}),
      ...(manifest.projectPath ? { projectPath: manifest.projectPath } : {}),
    });
  }
  return { changes, more: false };
}

/** A settings file Claude Code reads: your user file, or settings(.local).json in a .claude folder. */
function isSettingsFile(env: ScanEnv, path: string): boolean {
  if (path === join(env.claudeDir, "settings.json")) return true;
  return (
    ["settings.json", "settings.local.json"].includes(basename(path)) &&
    basename(dirname(path)) === ".claude"
  );
}

/** A `.md` file in your agents folder or a project's `.claude/agents`, or a subfolder of one. */
function isAgentFile(env: ScanEnv, path: string): boolean {
  if (!path.endsWith(".md")) return false;
  if (isWithin(join(env.claudeDir, "agents"), path)) return true;
  const parts = path.split(/[/\\]/);
  return parts.some(
    (part, i) => part === ".claude" && parts[i + 1] === "agents" && i + 2 < parts.length
  );
}

/** Settings are shown parsed with env and header values hidden, as everywhere else in ccdesk. */
function shownSettings(text: string | null): string | null {
  if (text === null) return null;
  try {
    return shown(parseJson(text));
  } catch {
    return "(not valid JSON; open the file to see it)\n";
  }
}

interface Plan {
  manifest: BackupManifest;
  /** The file's text now, null when it does not exist. */
  current: string | null;
  /** The text the backup holds; null for a file ccdesk created, which has no earlier version. */
  saved: string | null;
  /** Whether the target is a link now; a file ccdesk created never is. */
  linked: boolean;
  /** For a deleted memory: MEMORY.md now, and the lines the restore puts back. */
  index?: { path: string; text: string | null; missing: string[] };
}

/** A backup's manifest and its folder, which must be inside the backup folder. */
async function backupAt(env: ScanEnv, id: string) {
  const manifest = await readManifest(env, id);
  if (!manifest) throw new RefusedError("That backup is gone or was not made by ccdesk.");
  const root = await realpath(backupRoot(env));
  const dir = await realpath(join(root, id));
  if (!isWithin(root, dir) || dir === root) throw new RefusedError("Not a ccdesk backup.");
  return { manifest, dir };
}

const MADE_BY_CLAUDE =
  "Claude Code made this change through claude mcp, so ccdesk cannot undo it. Run the commands below to put it back.";

/**
 * What a change made through `claude mcp` did, as ccdesk recorded it: the servers before and
 * after, values hidden, and the commands that put them back.
 */
async function claudeMcpPreview(
  id: string,
  manifest: BackupManifest,
  dir: string
): Promise<RestorePreview> {
  const read = async (name: string, revision: string) => {
    const text = await readFile(join(dir, name), "utf8").catch(() => null);
    if (text === null || revisionOf(text) !== revision)
      throw new RefusedError("The record of this change is missing or was changed.");
    return text;
  };
  return {
    id,
    kind: manifest.kind,
    target: manifest.target,
    before: await read(SNAPSHOT, manifest.before),
    after: await read(SHOWN_AFTER, manifest.after),
    revision: manifest.after,
    blocked: MADE_BY_CLAUDE,
    undoCommands: manifest.undoCommands ?? [],
  };
}

/**
 * A forgotten directory's store: where it goes back to, why it cannot, and what it holds. It goes
 * back only under the projects folder, and never over a store Claude Code made there since.
 */
async function planStoreRestore(env: ScanEnv, manifest: BackupManifest, dir: string) {
  const target = manifest.target;
  if (dirname(target) !== join(env.claudeDir, "projects"))
    throw new RefusedError(
      "This backup does not point at a store in Claude Code's projects folder."
    );
  const moved = join(dir, MOVED_STORE);
  const kept = (await lstat(moved).catch(() => null)) !== null;
  const taken = (await lstat(target).catch(() => null)) !== null;
  const listing = kept ? (await storeContents(moved)).listing : "";
  let blocked: string | undefined;
  if (!kept)
    blocked = taken
      ? "This store was moved back already."
      : "The forgotten store is missing from the backup folder.";
  else if (taken)
    blocked =
      "A folder of that name exists in Claude Code's projects folder again. Move it aside first to restore this one.";
  return { target, moved, listing, blocked, revision: revisionOf(`${taken}\0${listing}`) };
}

/** What a forgotten store holds, in words: its sessions and memory files. */
function storeSummary(listing: string): string {
  const files = listing.split("\n").map((line) => line.split("\t")[0]?.split(/[/\\]/) ?? []);
  const sessions = files.filter((f) => f.length === 1 && f[0]?.endsWith(".jsonl")).length;
  const memories = files.filter(
    (f) => f.length === 2 && f[0] === "memory" && f[1]?.endsWith(".md") && f[1] !== "MEMORY.md"
  ).length;
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return `${count(sessions, "session")} and ${count(memories, "memory file")}\n`;
}

async function planRestore(env: ScanEnv, id: string): Promise<Plan> {
  const { manifest, dir } = await backupAt(env, id);
  let target = manifest.target;
  switch (manifest.kind) {
    case "mcp-claude":
      throw new RefusedError(MADE_BY_CLAUDE);
    // Moved back by restoreStore; a store is a folder, not a file this plan can write.
    case "directory-forget":
      throw new RefusedError("This backup holds a store folder, not a file.");
    case "settings":
      if (!isSettingsFile(env, target))
        throw new RefusedError("This backup does not point at a settings file.");
      break;
    case "mcp":
      if (basename(target) !== ".mcp.json")
        throw new RefusedError("This backup does not point at a .mcp.json.");
      break;
    case "agent":
      if (!isAgentFile(env, target))
        throw new RefusedError("This backup does not point at a subagent file.");
      break;
    // The same confinement as any other MEMORY.md change: a link out of the folder is refused.
    case "memory-index": {
      if (basename(target) !== "MEMORY.md")
        throw new RefusedError("This backup does not point at a MEMORY.md.");
      target = await indexPathIn(await assertMemoryDir(env, dirname(target)));
      break;
    }
    // A deleted memory comes back only as a topic file, as ccdesk deletes only those.
    case "memory-delete":
    case "memory-restore": {
      const store = await assertMemoryDir(env, dirname(target));
      target = join(store, basename(target));
      if (!target.endsWith(".md") || basename(target) === "MEMORY.md")
        throw new RefusedError("This backup does not point at a memory file.");
      break;
    }
  }

  let saved: string | null = null;
  if (manifest.before !== revisionOf(null)) {
    const snapshot = join(dir, SNAPSHOT);
    if (!(await lstat(snapshot).catch(() => null))?.isFile())
      throw new RefusedError("The backed-up file is missing from the backup folder.");
    saved = await readFile(snapshot, "utf8");
    if (revisionOf(saved) !== manifest.before)
      throw new RefusedError("The backed-up file was changed after ccdesk saved it.");
  }
  const plan: Plan = {
    manifest: { ...manifest, target },
    current: await readIfExists(env, target),
    saved,
    linked: (await lstat(target).catch(() => null))?.isSymbolicLink() ?? false,
  };
  if (manifest.kind === "memory-delete") {
    const path = await indexPathIn(dirname(target));
    const text = await readIfExists(env, path);
    const missing = (manifest.removedIndexLines ?? []).filter(
      (l) => !(text ?? "").split("\n").includes(l)
    );
    plan.index = { path, text, missing };
  }
  return plan;
}

/** What a restore must find unchanged: the file, and for a deleted memory MEMORY.md as well. */
function planRevision({ current, index }: Plan): string {
  return index ? revisionOfBoth(current, index.text) : revisionOf(current);
}

/**
 * A delete that stopped halfway, after Claude rewrote the memory: the memory was never removed, so
 * only the MEMORY.md lines the delete took out come back, and the memory stays as it is now.
 */
function onlyIndexLines({ manifest, current, saved, index }: Plan): boolean {
  return (
    manifest.kind === "memory-delete" &&
    manifest.after === "partial" &&
    current !== null &&
    current !== saved &&
    (index?.missing.length ?? 0) > 0
  );
}

function blockedReason(plan: Plan): string | undefined {
  const { manifest, current, saved } = plan;
  if (saved === null && manifest.kind === "memory-restore")
    return "This put a deleted memory back. To undo it, delete the memory again.";
  // Undoing a change that created its file removes the file, but only the one ccdesk wrote.
  if (saved === null) {
    if (manifest.after === "pending" || manifest.after === "partial")
      return "This change stopped halfway, so ccdesk cannot tell what it wrote. Remove the file by hand if you need to.";
    if (current === null) return "The file ccdesk created is gone already.";
    if (plan.linked || revisionOf(current) !== manifest.after)
      return "The file changed after ccdesk created it, so ccdesk does not remove it. Change it in place instead.";
    return undefined;
  }
  if (onlyIndexLines(plan)) return undefined;
  // A file broken since the backup has no values ccdesk could keep; the backup is the way out of it,
  // and the broken file is itself backed up before the restore replaces it.
  const now = hiddenValues(current);
  if (
    (manifest.kind === "settings" || manifest.kind === "mcp") &&
    current !== null &&
    now !== null &&
    now !== hiddenValues(saved)
  )
    return "Hidden values in this file (env, headers, a URL's key or a key in args) changed since the backup. ccdesk does not show or change those, so restore this one by hand.";
  // A retry after a restore that wrote the memory but not MEMORY.md finds the memory already back.
  if (manifest.kind === "memory-delete" && current !== null && current !== saved)
    return "A memory with this file name exists again; delete or rename it first.";
  return undefined;
}

/**
 * What a change did: the file before it, from its backup, and the file right after it. The manifest
 * keeps only the fingerprint of the after text, so the text comes from the next ccdesk backup of
 * the same file when that one started from it, or from the file now when it still matches.
 */
export async function showChange(env: ScanEnv, id: string): Promise<ChangeView> {
  const { manifest, dir } = await backupAt(env, id);
  const { kind } = manifest;
  if (kind === "mcp-claude") {
    const { target, before, after } = await claudeMcpPreview(id, manifest, dir);
    return { id, kind, target, before, after };
  }
  if (kind === "directory-forget")
    throw new RefusedError("A forgotten directory moved a store, not a file; review its restore.");
  const plan = await planRestore(env, id);
  const show = kind === "settings" || kind === "mcp" ? shownSettings : shownText;
  const after = await textAfter(env, id, manifest, plan.current);
  const lines = manifest.removedIndexLines?.map((line) => shownText(line) ?? line);
  return {
    id,
    kind,
    target: plan.manifest.target,
    before: show(plan.saved),
    ...(after === undefined ? {} : { after: show(after) }),
    ...(lines && lines.length > 0 ? { removedIndexLines: lines } : {}),
  };
}

/** The target's text right after change `id`; undefined when no copy of it is left. */
async function textAfter(
  env: ScanEnv,
  id: string,
  manifest: BackupManifest,
  current: string | null
): Promise<string | null | undefined> {
  const { after } = manifest;
  if (after === "pending" || after === "partial") return undefined;
  if (after === revisionOf(null)) return null;
  // Ids sort by time; oldest first, the first one for the same file is the next change to it.
  const later = (await backupIds(env)).filter((other) => other > id).reverse();
  for (const other of later) {
    const next = await readManifest(env, other);
    if (next?.target !== manifest.target) continue;
    // A later change that started from another text means the file changed in between.
    if (next.before !== after) return undefined;
    const text = await readFile(join(backupRoot(env), other, SNAPSHOT), "utf8").catch(() => null);
    return text !== null && revisionOf(text) === after ? text : undefined;
  }
  return revisionOf(current) === after ? current : undefined;
}

export async function previewRestore(env: ScanEnv, id: string): Promise<RestorePreview> {
  const { manifest: recorded, dir } = await backupAt(env, id);
  if (recorded.kind === "mcp-claude") return claudeMcpPreview(id, recorded, dir);
  if (recorded.kind === "directory-forget") {
    const store = await planStoreRestore(env, recorded, dir);
    return {
      id,
      kind: recorded.kind,
      target: store.target,
      before: null,
      after: storeSummary(store.listing),
      revision: store.revision,
      movesBack: store.target,
      ...(store.blocked ? { blocked: store.blocked } : {}),
    };
  }
  const plan = await planRestore(env, id);
  const { manifest, current, saved, index } = plan;
  const show = manifest.kind === "settings" || manifest.kind === "mcp" ? shownSettings : shownText;
  const before = show(current);
  const after = (onlyIndexLines(plan) ? before : show(saved)) ?? "";
  const blocked = blockedReason(plan);
  const createsFolder = saved === null ? null : await missingFolder(manifest.target);
  return {
    id,
    kind: manifest.kind,
    target: manifest.target,
    before,
    after,
    revision: planRevision(plan),
    ...(saved === null ? { removes: true } : {}),
    ...(blocked ? { blocked } : {}),
    ...(createsFolder ? { createsFolder } : {}),
    ...(index && index.missing.length > 0
      ? { indexLines: index.missing.map((line) => shownText(line) ?? line) }
      : {}),
  };
}

/** The outermost folder above `file` that does not exist, which writing `file` creates; null if none. */
async function missingFolder(file: string): Promise<string | null> {
  let missing: string | null = null;
  for (let dir = dirname(file); dir !== dirname(dir) && !(await isDir(dir)); dir = dirname(dir))
    missing = dir;
  return missing;
}

/** Moves a forgotten directory's store back, while the backup and the place it goes are as reviewed. */
async function restoreStore(
  env: ScanEnv,
  manifest: BackupManifest,
  dir: string,
  expectedRevision: string
): Promise<{ target: string }> {
  const store = await planStoreRestore(env, manifest, dir);
  if (store.blocked) throw new RefusedError(store.blocked);
  if (store.revision !== expectedRevision)
    throw new RefusedError("The store changed since you reviewed this restore; review it again.");
  await mkdir(dirname(store.target), { recursive: true });
  // A store Claude Code made in the meantime is never replaced: rename fails on a folder with files
  // in it, and an empty one holds nothing.
  await rename(store.moved, store.target);
  return { target: store.target };
}

/**
 * Puts a backed-up file back, or removes a file ccdesk created, if the file is still as it was
 * when the restore was reviewed. A removed file is backed up first, so it can be put back too. A
 * forgotten directory's store moves back to where it was.
 */
export function restoreBackup(
  env: ScanEnv,
  id: string,
  expectedRevision: string,
  queue: Serially
): Promise<{ target: string }> {
  return queue(async () => {
    const { manifest: recorded, dir } = await backupAt(env, id);
    if (recorded.kind === "directory-forget")
      return restoreStore(env, recorded, dir, expectedRevision);
    const plan = await planRestore(env, id);
    const { manifest, current, saved, index } = plan;
    const blocked = blockedReason(plan);
    if (blocked) throw new RefusedError(blocked);
    if (planRevision(plan) !== expectedRevision)
      throw new RefusedError("The file changed since you reviewed this restore; review it again.");
    const { target, projectPath } = manifest;
    if (saved === null) {
      await recordChange(
        env,
        { kind: manifest.kind, target, before: current, projectPath },
        async () => {
          if (!(await removeExactly(target, revisionOf(current))))
            throw new StaleError(
              `${target} changed while ccdesk was removing it; nothing was removed. Review it again.`
            );
          return { revision: revisionOf(null) };
        }
      );
      return { target };
    }
    if (manifest.kind !== "memory-delete") {
      await recordChange(
        env,
        { kind: manifest.kind, target, before: current, projectPath },
        async () => {
          await writeAtomic(env, target, saved, revisionOf(current));
          return { revision: revisionOf(saved) };
        }
      );
      return { target };
    }
    // A memory and its MEMORY.md lines come back together: when the index cannot be written, the
    // memory just put back is removed again, with its record, so a refused restore leaves both as
    // they were.
    const created =
      current === null
        ? await recordChange(
            env,
            { kind: "memory-restore", target, before: null, projectPath },
            async () => {
              await writeAtomic(env, target, saved, revisionOf(null));
              return { revision: revisionOf(saved) };
            }
          )
        : null;
    try {
      if (index && index.missing.length > 0) {
        const lines = (index.text ?? "").split("\n");
        while (lines.at(-1) === "") lines.pop();
        const next = `${[...lines, ...index.missing].join("\n")}\n`;
        await recordChange(
          env,
          { kind: "memory-index", target: index.path, before: index.text, projectPath },
          async () => {
            await writeAtomic(env, index.path, next, revisionOf(index.text));
            return { revision: revisionOf(next) };
          }
        );
      }
    } catch (error) {
      if (created && (await removeExactly(target, revisionOf(saved))))
        await forgetChange(env, created.id);
      throw error;
    }
    return { target };
  });
}
