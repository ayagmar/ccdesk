import { type FSWatcher, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type DirectoryView } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isNetworkPath, mainWorktreeRoot } from "./scan/files.ts";
import { storeDirName } from "./scan/memory.ts";

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

/** Files a scan read that the fixed list does not cover: a custom memory folder, imports. */
export function dependencies(view: DirectoryView): Target[] {
  const files = view.instructions.flatMap((i) => [
    i.realPath ?? i.path,
    ...i.imports.filter((r) => r.exists).map((r) => r.resolved),
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
  ];
}

interface Subscription {
  watchers: FSWatcher[];
  /** When a watched file last changed, in ms since the epoch. */
  changedAt: number;
  waiters: Set<() => void>;
  extra: Target[];
  idle?: NodeJS.Timeout;
  settle?: NodeJS.Timeout;
}

/** One set of file watchers per directory a page is looking at, shared by its requests. */
export class Watcher {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly env: ScanEnv) {}

  /** Remembers what the latest scan of `dir` read, so those files are watched too. */
  track(dir: string, view: DirectoryView): void {
    const subscription = this.subscriptions.get(dir);
    const extra = dependencies(view);
    if (!subscription || JSON.stringify(extra) === JSON.stringify(subscription.extra)) return;
    subscription.extra = extra;
    void this.rewatch(dir, subscription);
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
    try {
      if (subscription.changedAt <= since && !signal.aborted)
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
      if (subscription.waiters.size === 0)
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
      waiters: new Set(),
      extra: [],
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
  }

  /** (Re)creates the watchers, so a folder created since, such as a new .claude, is watched. */
  private async rewatch(dir: string, subscription: Subscription): Promise<void> {
    const list = await targets(this.env, dir, subscription.extra);
    for (const w of subscription.watchers) w.close();
    subscription.watchers = [];
    if (this.subscriptions.get(dir) !== subscription) return;
    for (const target of list) {
      try {
        const watcher = watch(target.path, { recursive: target.recursive }, (_event, name) => {
          const changed = name === null ? "" : String(name);
          if (target.names && !target.names.includes(basename(changed))) return;
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
  }
}
