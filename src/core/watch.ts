import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { storeDirName } from "../shared/memory.ts";
import { type DirectoryView, type Plugin, type SessionProfile } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isDir, isFile, isNetworkPath } from "./scan/files.ts";
import { canonicalRoot, mainWorktreeRoot } from "./scan/git.ts";
import { scanDirectory } from "./scan/index.ts";
import {
  isSkillsDirPlugin,
  knownMarketplacesFile,
  loadPlugin,
  manifestCommandMap,
  manifestPaths,
  marketplaceFiles,
  pluginsRoot,
} from "./scan/plugins.ts";

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
  const mainRoot = (await mainWorktreeRoot(dir)) ?? dir;
  const out: Target[] = [
    ...claude(env.claudeDir),
    // Only the install list: Windows reports a write deep in a plugin as a change to `cache`.
    { path: pluginsRoot(env), recursive: false, names: ["installed_plugins.json"] },
    {
      path: join(env.claudeDir, "projects", storeDirName(await canonicalRoot(dir)), "memory"),
      recursive: false,
    },
    { path: env.managedDir, recursive: false },
    { path: join(env.managedDir, "managed-settings.d"), recursive: false },
    { path: join(env.managedDir, ".claude", "rules"), recursive: true },
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
  if (mainRoot !== dir) out.push(...claude(join(mainRoot, ".claude")));
  return out.filter((t) => !isNetworkPath(t.path));
}

/**
 * Files a scan read that the fixed list does not cover: a custom memory folder, imports, installed
 * plugins and their marketplace records. A missing import or marketplace file is watched too, so
 * creating it shows up, even when its folder is missing as well.
 */
async function dependencies(env: ScanEnv, view: DirectoryView): Promise<Target[]> {
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
  const plugins = await Promise.all(view.inventory.plugins.map((p) => pluginTargets(env, view, p)));
  // An installed plugin's marketplace entry can decide whether it is on.
  const installed = view.inventory.plugins.filter((p) => !isSkillsDirPlugin(p)).map((p) => p.id);
  const marketplaces = [knownMarketplacesFile(env), ...(await marketplaceFiles(env, installed))];
  return [
    ...[...byFolder].map(([path, names]) => ({ path, recursive: false, names: [...names] })),
    ...(view.memory ? [{ path: view.memory.dir, recursive: false }] : []),
    ...plugins.flat(),
    ...marketplaces.map((file) => ({
      path: dirname(file),
      recursive: false,
      names: [basename(file)],
    })),
  ];
}

/** A plugin's folders the scan reads from, when they are not named in its manifest. */
const PLUGIN_FOLDERS = ["agents", "skills", "commands", "output-styles", "hooks"];
/** Manifest keys that name files or folders inside the plugin. */
const PLUGIN_KEYS = ["agents", "skills", "commands", "outputStyles", "hooks", "mcpServers"];

/**
 * What the scan reads in a plugin: its manifest, .mcp.json, a skill at its root, its component
 * folders and the paths its manifest names. Not the whole plugin, which can hold an MCP server's
 * node_modules and files the server writes while it runs.
 */
async function pluginTargets(env: ScanEnv, view: DirectoryView, plugin: Plugin): Promise<Target[]> {
  const root = plugin.installPath;
  // A path from installed_plugins.json that is not absolute names no folder Claude Code would load.
  if (!isAbsolute(root)) return [];
  // The scan reports a manifest that does not parse; here it only names paths to watch.
  const loaded = await loadPlugin(env, plugin, []);
  const named = await Promise.all(PLUGIN_KEYS.map((key) => manifestPaths(loaded, key)));
  const commands = await manifestCommandMap(loaded);
  // Without a skills folder, each folder at the root holding SKILL.md is a skill.
  const rootSkills = view.inventory.skills
    .filter((s) => s.plugin === plugin.id && s.folder && dirname(s.folder) === root)
    .map((s) => s.folder as string);
  const paths = [
    ...PLUGIN_FOLDERS.map((name) => join(root, name)),
    ...named.flatMap((list) => list ?? []),
    ...commands.map((c) => c.path),
    ...rootSkills,
  ];
  const out: Target[] = [
    {
      path: root,
      recursive: false,
      names: [".claude-plugin", ".mcp.json", "SKILL.md", ...PLUGIN_FOLDERS],
    },
    { path: join(root, ".claude-plugin"), recursive: false, names: ["plugin.json"] },
  ];
  for (const path of new Set(paths)) {
    if (await isDir(path)) out.push({ path, recursive: true });
    else if (await isFile(path))
      out.push({ path: dirname(path), recursive: false, names: [basename(path)] });
  }
  return out;
}

/**
 * `target`, or when it does not exist yet, the nearest folder above it that does, watched for the
 * next missing name only. Watching needs a folder that exists, and the watchers are rebuilt after
 * every change, so each folder that appears moves the watch one level closer.
 */
async function nearestWatchable(target: Target): Promise<Target> {
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
  /** The latest (re)start of the watchers; they cover every current target once it settles. */
  ready: Promise<void>;
  /** When a watched file last changed, in ms since the epoch. */
  changedAt: number;
  /** When a watcher last saw any change, before it settled; 0 for none. */
  touchedAt: number;
  /** When the current watchers started. */
  watchingSince: number;
  waiters: Set<() => void>;
  /** Callers of `subscribe`, called after every change until they unsubscribe. */
  listeners: Set<() => void>;
  extra: Target[];
  /** Paths watchers named since subscribers were last told. */
  pending: Set<string>;
  /** Each path's state when subscribers were last told about it, from `fileState`. */
  told: Map<string, string>;
  idle?: NodeJS.Timeout;
  settle?: NodeJS.Timeout;
}

/** A file or folder's size and modification time, or undefined when it cannot be read. */
async function fileState(path: string): Promise<string | undefined> {
  const info = await stat(path).catch(() => null);
  return info ? `${info.size}:${info.mtimeMs}` : undefined;
}

/** The latest scan of a directory, with when it started and ~/.claude.json as it was then. */
interface Scanned {
  view: DirectoryView;
  startedAt: number;
  stateFile: string;
}

/** The file watching the watchers run on: Node's, on the platform ccdesk runs on. */
export interface WatchHost {
  watch: typeof watch;
  platform: NodeJS.Platform;
}

/** One set of file watchers per directory a page is looking at, shared by its requests. */
export class Watcher {
  private readonly subscriptions = new Map<string, Subscription>();
  /** What the latest scan of each directory read, kept for a watch that starts after the scan. */
  private readonly scanned = new Map<string, Target[]>();
  private readonly latest = new Map<string, Scanned>();
  private readonly env: ScanEnv;
  private readonly scanOf: typeof scanDirectory;
  private readonly host: WatchHost;

  constructor(
    env: ScanEnv,
    scanOf: typeof scanDirectory = scanDirectory,
    host: WatchHost = { watch, platform: process.platform }
  ) {
    this.env = env;
    this.scanOf = scanOf;
    this.host = host;
  }

  /** Scans `dir` and remembers what the scan read, so those files are watched too. */
  async scan(dir: string, profile: SessionProfile = "interactive"): Promise<DirectoryView> {
    const startedAt = Date.now();
    const stateFile = await this.stateFile();
    const view = await this.scanOf(this.env, dir, profile);
    const subscription = this.subscriptions.get(view.path);
    // Only a watched directory's view can be known to be current later.
    if (subscription) this.latest.set(view.path, { view, startedAt, stateFile });
    const extra = await dependencies(this.env, view);
    this.scanned.set(view.path, extra);
    if (subscription && JSON.stringify(extra) !== JSON.stringify(subscription.extra)) {
      subscription.extra = extra;
      this.restart(view.path, subscription);
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
    return (await fileState(this.env.claudeJson)) ?? "missing";
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
    const subscription = await this.watching(dir);
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
      this.release(dir, subscription);
    }
    return { changed: subscription.changedAt > since, at: subscription.changedAt };
  }

  /**
   * Calls `onChange` once after each change to what ccdesk shows for `dir`, until the returned
   * function is called. Resolves once the watchers have started, so a change made after it
   * resolves is seen. `close` stops the calls without making one.
   */
  async subscribe(dir: string, onChange: () => void): Promise<() => void> {
    const subscription = await this.watching(dir);
    // Closed while its watchers were starting: nothing will change.
    if (this.subscriptions.get(dir) !== subscription)
      return () => {
        // Nothing was subscribed, so there is nothing to stop.
      };
    clearTimeout(subscription.idle);
    // A function of its own, so the same onChange subscribed twice is unsubscribed twice.
    const listener = () => onChange();
    subscription.listeners.add(listener);
    return () => {
      if (subscription.listeners.delete(listener)) this.release(dir, subscription);
    };
  }

  /** Drops the watchers of `dir` after a while once no one waits or listens for changes. */
  private release(dir: string, subscription: Subscription): void {
    // A dropped subscription has nothing left to clean up later.
    if (
      subscription.waiters.size === 0 &&
      subscription.listeners.size === 0 &&
      this.subscriptions.get(dir) === subscription
    )
      subscription.idle = setTimeout(() => this.drop(dir), IDLE_MS);
  }

  close(): void {
    for (const dir of [...this.subscriptions.keys()]) this.drop(dir);
  }

  private async watching(dir: string): Promise<Subscription> {
    const existing = this.subscriptions.get(dir);
    if (existing) {
      // Watchers moving to a new target after a change are not watching it yet.
      await existing.ready;
      return existing;
    }
    const subscription: Subscription = {
      watchers: [],
      ready: Promise.resolve(),
      changedAt: 0,
      touchedAt: 0,
      watchingSince: Number.POSITIVE_INFINITY,
      waiters: new Set(),
      listeners: new Set(),
      extra: this.scanned.get(dir) ?? [],
      pending: new Set(),
      told: new Map(),
    };
    this.subscriptions.set(dir, subscription);
    this.restart(dir, subscription);
    await subscription.ready;
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

  /**
   * Settles a change a watcher reported at `path`, or at an unnamed path, unless `path` is as it was
   * when subscribers were last told about it. On macOS, the stream that replaces the old one when
   * watchers move can report a change again, after subscribers heard about it.
   */
  private async noticed(dir: string, subscription: Subscription, path?: string): Promise<void> {
    if (path !== undefined) {
      const state = await fileState(path);
      if (this.subscriptions.get(dir) !== subscription) return;
      // A path that cannot be read always counts, since a deleted file has no state to compare.
      if (state !== undefined && state === subscription.told.get(path)) return;
      subscription.pending.add(path);
    }
    clearTimeout(subscription.settle);
    subscription.settle = setTimeout(() => void this.tell(dir, subscription), SETTLE_MS);
  }

  /**
   * Notes the state of each path changed since the last time, then tells waiters and subscribers.
   * The states are read first, so whatever a subscriber reads after being told is at least as new.
   */
  private async tell(dir: string, subscription: Subscription): Promise<void> {
    const paths = [...subscription.pending];
    subscription.pending.clear();
    const states = await Promise.all(paths.map(fileState));
    if (this.subscriptions.get(dir) !== subscription) return;
    paths.forEach((path, i) => {
      const state = states[i];
      if (state === undefined) subscription.told.delete(path);
      else subscription.told.set(path, state);
    });
    subscription.changedAt = Date.now();
    // First, so a subscriber that throws cannot leave the old watchers in place.
    this.restart(dir, subscription);
    for (const wake of [...subscription.waiters, ...subscription.listeners]) wake();
  }

  /** Rewatches `dir`. A failure rejects `ready` for whoever awaits it, and is handled when no one does. */
  private restart(dir: string, subscription: Subscription): void {
    subscription.ready = this.rewatch(dir, subscription);
    subscription.ready.catch(() => {
      // Reported to the callers that await `ready`; a change that triggered it has no caller.
    });
  }

  /**
   * (Re)creates the watchers, so a folder created since, such as a new .claude, is watched. The old
   * watchers close only once the new ones have started, so no folder goes without a watch between
   * the two sets.
   *
   * On macOS, libuv runs every folder watch of an event loop through one FSEvents stream, which its
   * own thread rebuilds whenever a watch starts or closes. Starting a watch returns before that
   * rebuild, so a change made right after it is lost; closing one waits until the rebuilt stream,
   * with every watch started before it, is running. Closing a spare watch last therefore makes the
   * new watchers live before this resolves, and without one this fails rather than resolve early.
   * A rebuild replaces the stream, so a change made during one can still be lost.
   */
  private async rewatch(dir: string, subscription: Subscription): Promise<void> {
    const extra = await Promise.all(subscription.extra.map(nearestWatchable));
    const list = await targets(this.env, dir, extra);
    const old = subscription.watchers;
    subscription.watchers = [];
    if (this.subscriptions.get(dir) !== subscription) {
      for (const w of old) w.close();
      return;
    }
    const started: string[] = [];
    for (const target of list) {
      try {
        const watcher = this.host.watch(
          target.path,
          { recursive: target.recursive },
          (_event, name) => {
            const changed = name === null ? "" : String(name);
            if (target.names && !target.names.includes(basename(changed))) return;
            subscription.touchedAt = Date.now();
            void this.noticed(
              dir,
              subscription,
              name === null ? undefined : join(target.path, changed)
            );
          }
        );
        watcher.on("error", () => watcher.close());
        subscription.watchers.push(watcher);
        started.push(target.path);
      } catch {
        // A folder that does not exist yet is caught by watching its parent.
      }
    }
    for (const w of old) w.close();
    if (this.host.platform === "darwin" && started.length > 0) this.waitUntilLive(dir, started);
    subscription.watchingSince = Date.now();
  }

  /**
   * Opens and closes a spare watch on one of the `started` folders, which on macOS returns once the
   * watchers are live. A folder can go away meanwhile, so each is tried in turn. When none opens,
   * the watchers are dropped and the error is thrown, since they may not be live.
   */
  private waitUntilLive(dir: string, started: string[]): void {
    let error: unknown;
    for (const path of started) {
      try {
        this.host.watch(path).close();
        return;
      } catch (e) {
        error = e;
      }
    }
    this.drop(dir);
    throw error;
  }
}
