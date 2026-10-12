import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { storeDirName } from "../shared/memory.ts";
import { type DirectoryView, type SessionProfile } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isNetworkPath, mainWorktreeRoot } from "./scan/files.ts";
import { scanDirectory } from "./scan/index.ts";

/** How long one request waits for a change before answering "nothing changed". */
const WAIT_MS = 25_000;
/** Editors write a file in several steps; one change covers them all. */
const SETTLE_MS = 300;
/** Watchers outlive a request by this much, so nothing is missed between two polls. */
const IDLE_MS = 60_000;

interface Target {
  path: string;
  recursive: boolean;
  /** For a folder watched only for some of its entries. */
  names?: string[];
}

const CONFIG_FOLDERS = ["rules", "agents", "skills", "commands", "output-styles"];

/**
 * The files and folders whose changes alter what ccdesk shows for `dir`. A `.claude` folder is
 * watched only for its config files and folders, never recursively, because Claude Code keeps
 * whole checkouts in `.claude/worktrees`. ~/.claude.json is left out: Claude Code rewrites it
 * during every session, and focusing the tab picks up its changes.
 */
async function targets(env: ScanEnv, dir: string, extra: Target[]): Promise<Target[]> {
  const claude = (folder: string): Target[] => [
    {
      path: folder,
      recursive: false,
      names: ["settings.json", "settings.local.json", "CLAUDE.md", "AGENTS.md", ...CONFIG_FOLDERS],
    },
    ...CONFIG_FOLDERS.map((sub) => ({ path: join(folder, sub), recursive: true })),
  ];
  const memoryKey = (await mainWorktreeRoot(dir)) ?? dir;
  const out: Target[] = [
    ...claude(env.claudeDir),
    { path: join(env.claudeDir, "plugins"), recursive: false },
    { path: join(env.claudeDir, "projects", storeDirName(memoryKey), "memory"), recursive: false },
    { path: env.managedDir, recursive: false },
    { path: join(env.managedDir, "managed-settings.d"), recursive: false },
    ...extra,
  ];
  // The start directory and every parent can hold instructions, rules and settings.
  for (let d = dir; ; d = dirname(d)) {
    out.push({
      path: d,
      recursive: false,
      names: ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".mcp.json", ".claude"],
    });
    if (join(d, ".claude") !== env.claudeDir) out.push(...claude(join(d, ".claude")));
    if (dirname(d) === d) break;
  }
  if (memoryKey !== dir) out.push(...claude(join(memoryKey, ".claude")));
  return out.filter((t) => !isNetworkPath(t.path));
}

/**
 * Files a scan read that the fixed list does not cover: a custom memory folder, imports, installed
 * plugins. A missing import is watched too, so creating it shows up, even when its folder is missing
 * as well. Each plugin's own folder is watched, not ~/.claude/plugins as a whole, which also holds
 * marketplace checkouts and caches Claude Code rewrites.
 */
export function dependencies(view: DirectoryView): Target[] {
  const files = view.instructions.flatMap((i) => [
    i.realPath ?? i.path,
    ...i.imports.map((r) => r.resolved),
  ]);
  const byFolder = new Map<string, Set<string>>();
  for (const file of files) {
    const names = byFolder.get(dirname(file)) ?? new Set();
    names.add(basename(file));
    byFolder.set(dirname(file), names);
  }
  return [
    ...[...byFolder].map(([path, names]) => ({ path, recursive: false, names: [...names] })),
    ...(view.memory ? [{ path: view.memory.dir, recursive: false }] : []),
    ...view.inventory.plugins
      .filter((p) => p.installPath)
      .map((p) => ({ path: p.installPath, recursive: true })),
  ];
}

/**
 * `target`, or when it does not exist yet, the nearest folder above it that does, watched for the
 * next missing name only. Watching needs a folder that exists, and the watchers are rebuilt after
 * every change, so each folder that appears moves the watch one level closer.
 */
async function existing(target: Target): Promise<Target> {
  if (isNetworkPath(target.path) || (await stat(target.path).catch(() => null))) return target;
  for (let missing = target.path; dirname(missing) !== missing; missing = dirname(missing)) {
    const parent = dirname(missing);
    if (await stat(parent).catch(() => null))
      return { path: parent, recursive: false, names: [basename(missing)] };
  }
  return target;
}

interface Subscription {
  watchers: FSWatcher[];
  /** When a watched file last changed, in ms since the epoch. */
  changedAt: number;
  /** When a watcher last saw any change, before it settled; 0 for none. */
  touchedAt: number;
  /** When the current watchers started. */
  watchingSince: number;
  waiters: Set<() => void>;
  extra: Target[];
  idle?: NodeJS.Timeout;
  settle?: NodeJS.Timeout;
}

/** The latest scan of a directory, with when it started and ~/.claude.json as it was then. */
interface Scanned {
  view: DirectoryView;
  startedAt: number;
  stateFile: string;
}

/** One set of file watchers per directory a page is looking at, shared by its requests. */
export class Watcher {
  private readonly subscriptions = new Map<string, Subscription>();
  /** What the latest scan of each directory read, kept for a watch that starts after the scan. */
  private readonly scanned = new Map<string, Target[]>();
  private readonly latest = new Map<string, Scanned>();

  constructor(
    private readonly env: ScanEnv,
    private readonly scanOf: typeof scanDirectory = scanDirectory
  ) {}

  /** Scans `dir` and remembers what the scan read, so those files are watched too. */
  async scan(dir: string, profile: SessionProfile = "interactive"): Promise<DirectoryView> {
    const startedAt = Date.now();
    const stateFile = await this.stateFile();
    const view = await this.scanOf(this.env, dir, profile);
    const subscription = this.subscriptions.get(view.path);
    // Only a watched directory's view can be known to be current later.
    if (subscription) this.latest.set(view.path, { view, startedAt, stateFile });
    const extra = dependencies(view);
    this.scanned.set(view.path, extra);
    if (subscription && JSON.stringify(extra) !== JSON.stringify(subscription.extra)) {
      subscription.extra = extra;
      void this.rewatch(view.path, subscription);
    }
    return view;
  }

  /**
   * The view of `dir`: the latest scan while it is known to be current, else a new scan. It is
   * current only while watchers that started before it have seen no change since it started, and
   * ~/.claude.json, which is not watched, is as it was. Only an interactive scan is reused, as the
   * path tester describes an interactive session.
   */
  async view(dir: string): Promise<DirectoryView> {
    const latest = this.latest.get(dir);
    const subscription = this.subscriptions.get(dir);
    if (
      latest?.view.profile === "interactive" &&
      subscription &&
      subscription.watchingSince < latest.startedAt &&
      subscription.touchedAt < latest.startedAt &&
      latest.stateFile === (await this.stateFile())
    )
      return latest.view;
    return this.scan(dir);
  }

  /** ~/.claude.json's size and time; Claude Code rewrites it too often to watch. */
  private async stateFile(): Promise<string> {
    const info = await stat(this.env.claudeJson).catch(() => null);
    return info ? `${info.size}:${info.mtimeMs}` : "missing";
  }

  /**
   * Answers once something changed after `since` (ms since the epoch), or after `timeoutMs` with
   * the last change time, whichever comes first.
   */
  async wait(
    dir: string,
    since: number,
    signal: AbortSignal,
    timeoutMs = WAIT_MS
  ): Promise<{ changed: boolean; at: number }> {
    const subscription = await this.subscribe(dir);
    clearTimeout(subscription.idle);
    // Closed while its watchers were starting: there is nothing left to wait on.
    const closed = this.subscriptions.get(dir) !== subscription;
    try {
      if (!closed && subscription.changedAt <= since && !signal.aborted)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            subscription.waiters.delete(done);
            resolve();
          };
          const timer = setTimeout(done, timeoutMs);
          signal.addEventListener("abort", done);
          subscription.waiters.add(done);
        });
    } finally {
      // A dropped subscription has nothing left to clean up later.
      if (subscription.waiters.size === 0 && this.subscriptions.get(dir) === subscription)
        subscription.idle = setTimeout(() => this.drop(dir), IDLE_MS);
    }
    return { changed: subscription.changedAt > since, at: subscription.changedAt };
  }

  close(): void {
    for (const dir of [...this.subscriptions.keys()]) this.drop(dir);
  }

  private async subscribe(dir: string): Promise<Subscription> {
    const existing = this.subscriptions.get(dir);
    if (existing) return existing;
    const subscription: Subscription = {
      watchers: [],
      changedAt: 0,
      touchedAt: 0,
      watchingSince: Number.POSITIVE_INFINITY,
      waiters: new Set(),
      extra: this.scanned.get(dir) ?? [],
    };
    this.subscriptions.set(dir, subscription);
    await this.rewatch(dir, subscription);
    return subscription;
  }

  private drop(dir: string): void {
    const subscription = this.subscriptions.get(dir);
    if (!subscription) return;
    clearTimeout(subscription.idle);
    clearTimeout(subscription.settle);
    for (const w of subscription.watchers) w.close();
    this.subscriptions.delete(dir);
    this.latest.delete(dir);
    // Pages still waiting are answered now, so no timer outlives the watcher.
    for (const wake of [...subscription.waiters]) wake();
  }

  /** (Re)creates the watchers, so a folder created since, such as a new .claude, is watched. */
  private async rewatch(dir: string, subscription: Subscription): Promise<void> {
    const extra = await Promise.all(subscription.extra.map(existing));
    const list = await targets(this.env, dir, extra);
    for (const w of subscription.watchers) w.close();
    subscription.watchers = [];
    if (this.subscriptions.get(dir) !== subscription) return;
    for (const target of list) {
      try {
        const watcher = watch(target.path, { recursive: target.recursive }, (_event, name) => {
          const changed = name === null ? "" : String(name);
          if (target.names && !target.names.includes(basename(changed))) return;
          subscription.touchedAt = Date.now();
          clearTimeout(subscription.settle);
          subscription.settle = setTimeout(() => {
            subscription.changedAt = Date.now();
            for (const wake of [...subscription.waiters]) wake();
            void this.rewatch(dir, subscription);
          }, SETTLE_MS);
        });
        watcher.on("error", () => watcher.close());
        subscription.watchers.push(watcher);
      } catch {
        // A folder that does not exist yet is caught by watching its parent.
      }
    }
    subscription.watchingSince = Date.now();
  }
}
