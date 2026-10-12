import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type BackupSummary, type RestorePreview } from "../shared/types.ts";
import { assertMemoryDir, indexPathIn, revisionOfBoth } from "./mutations.ts";
import { type ScanEnv } from "./scan/env.ts";
import {
  isRecord,
  isWithin,
  redactSecrets,
  revisionOf,
  shownText,
  shownUrl,
} from "./scan/files.ts";
import {
  type BackupManifest,
  backupRoot,
  forgetChange,
  MANIFEST,
  RefusedError,
  readIfExists,
  recordChange,
  removeExactly,
  SNAPSHOT,
  StaleError,
  serially,
  writeAtomic,
} from "./write.ts";

const KINDS = new Set([
  "settings",
  "mcp",
  "agent",
  "memory-index",
  "memory-delete",
  "memory-restore",
]);

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** A backup folder's manifest; anything that does not look like one ccdesk wrote is skipped. */
async function readManifest(env: ScanEnv, id: string): Promise<BackupManifest | null> {
  // ccdesk's ids are letters, digits and dashes, so no id can name a folder outside the root.
  if (!/^[\w-]+$/.test(id)) return null;
  const text = await readIfExists(env, join(backupRoot(env), id, MANIFEST)).catch(() => null);
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(data) ||
    typeof data.kind !== "string" ||
    !KINDS.has(data.kind) ||
    typeof data.target !== "string" ||
    typeof data.createdAt !== "string" ||
    typeof data.before !== "string" ||
    typeof data.after !== "string" ||
    (data.removedIndexLines !== undefined && !strings(data.removedIndexLines))
  )
    return null;
  return data as unknown as BackupManifest;
}

/** The changes ccdesk made, newest first, a page at a time. */
export async function listBackups(
  env: ScanEnv,
  { before, limit }: { before?: string; limit: number }
): Promise<{ changes: BackupSummary[]; more: boolean }> {
  const ids = (await readdir(backupRoot(env)).catch(() => [] as string[])).sort().reverse();
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

/**
 * Every value ccdesk shows hidden and never changes in a settings file: env and headers objects,
 * and URLs with a user, password or query. Null for a file that is not valid JSON.
 */
function hiddenValues(text: string | null): string | null {
  const found: unknown[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    if (!isRecord(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if ((key === "env" || key === "headers") && isRecord(inner)) found.push(inner);
      else if (key === "url" && typeof inner === "string" && shownUrl(inner) !== inner)
        found.push(inner);
      else walk(inner);
    }
  };
  try {
    walk(text === null ? null : JSON.parse(text));
  } catch {
    return null;
  }
  return JSON.stringify(found);
}

/** Settings are shown parsed with env and header values hidden, as everywhere else in ccdesk. */
function shownSettings(text: string | null): string | null {
  if (text === null) return null;
  try {
    return `${JSON.stringify(redactSecrets(JSON.parse(text)), null, 2)}\n`;
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

async function planRestore(env: ScanEnv, id: string): Promise<Plan> {
  const manifest = await readManifest(env, id);
  if (!manifest) throw new RefusedError("That backup is gone or was not made by ccdesk.");
  const root = await realpath(backupRoot(env));
  const dir = await realpath(join(root, id));
  if (!isWithin(root, dir) || dir === root) throw new RefusedError("Not a ccdesk backup.");

  let target = manifest.target;
  if (manifest.kind === "settings" && !isSettingsFile(env, target))
    throw new RefusedError("This backup does not point at a settings file.");
  if (manifest.kind === "mcp" && basename(target) !== ".mcp.json")
    throw new RefusedError("This backup does not point at a .mcp.json.");
  if (manifest.kind === "agent" && !isAgentFile(env, target))
    throw new RefusedError("This backup does not point at a subagent file.");
  if (manifest.kind === "memory-index" && basename(target) !== "MEMORY.md")
    throw new RefusedError("This backup does not point at a MEMORY.md.");
  if (manifest.kind !== "settings" && manifest.kind !== "mcp" && manifest.kind !== "agent") {
    const store = await assertMemoryDir(env, dirname(target));
    // The same confinement as any other MEMORY.md change: a link out of the folder is refused.
    target =
      manifest.kind === "memory-index" ? await indexPathIn(store) : join(store, basename(target));
    // A deleted memory comes back only as a topic file, as ccdesk deletes only those.
    if (
      manifest.kind !== "memory-index" &&
      (!target.endsWith(".md") || basename(target) === "MEMORY.md")
    )
      throw new RefusedError("This backup does not point at a memory file.");
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
    return "Hidden values in this file (env, headers or a URL's key) changed since the backup. ccdesk does not show or change those, so restore this one by hand.";
  // A retry after a restore that wrote the memory but not MEMORY.md finds the memory already back.
  if (manifest.kind === "memory-delete" && current !== null && current !== saved)
    return "A memory with this file name exists again; delete or rename it first.";
  return undefined;
}

export async function previewRestore(env: ScanEnv, id: string): Promise<RestorePreview> {
  const plan = await planRestore(env, id);
  const { manifest, current, saved, index } = plan;
  const shown = manifest.kind === "settings" || manifest.kind === "mcp" ? shownSettings : shownText;
  const before = shown(current);
  const after = (onlyIndexLines(plan) ? before : shown(saved)) ?? "";
  const blocked = blockedReason(plan);
  return {
    id,
    kind: manifest.kind,
    target: manifest.target,
    before,
    after,
    revision: planRevision(plan),
    ...(saved === null ? { removes: true } : {}),
    ...(blocked ? { blocked } : {}),
    ...(index && index.missing.length > 0
      ? { indexLines: index.missing.map((line) => shownText(line) ?? line) }
      : {}),
  };
}

/**
 * Puts a backed-up file back, or removes a file ccdesk created, if the file is still as it was
 * when the restore was reviewed. A removed file is backed up first, so it can be put back too.
 */
export function restoreBackup(
  env: ScanEnv,
  id: string,
  expectedRevision: string
): Promise<{ target: string }> {
  return serially(async () => {
    const plan = await planRestore(env, id);
    const { manifest, current, saved, index } = plan;
    const blocked = blockedReason(plan);
    if (blocked) throw new RefusedError(blocked);
    if (planRevision(plan) !== expectedRevision)
      throw new RefusedError("The file changed since you reviewed this restore; review it again.");
    const { target } = manifest;
    if (saved === null) {
      await recordChange(env, { kind: manifest.kind, target, before: current }, async () => {
        if (!(await removeExactly(target, revisionOf(current))))
          throw new StaleError(
            `${target} changed while ccdesk was removing it; nothing was removed. Review it again.`
          );
        return { revision: revisionOf(null) };
      });
      return { target };
    }
    if (manifest.kind !== "memory-delete") {
      await recordChange(env, { kind: manifest.kind, target, before: current }, async () => {
        await writeAtomic(env, target, saved, revisionOf(current));
        return { revision: revisionOf(saved) };
      });
      return { target };
    }
    // A memory and its MEMORY.md lines come back together: when the index cannot be written, the
    // memory just put back is removed again, with its record, so a refused restore leaves both as
    // they were.
    const created =
      current === null
        ? await recordChange(env, { kind: "memory-restore", target, before: null }, async () => {
            await writeAtomic(env, target, saved, revisionOf(null));
            return { revision: revisionOf(saved) };
          })
        : null;
    try {
      if (index && index.missing.length > 0) {
        const lines = (index.text ?? "").split("\n");
        while (lines.at(-1) === "") lines.pop();
        const next = `${[...lines, ...index.missing].join("\n")}\n`;
        await recordChange(
          env,
          { kind: "memory-index", target: index.path, before: index.text },
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
