import { type BigIntStats, type FSWatcher, watch } from "node:fs";
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
/**
 * While some folders cannot be watched, a poll this long after the last try tries them again. The
 * wait doubles with each failure of the same folder, up to RETRY_MAX_MS.
 */
const RETRY_MS = 5000;
const RETRY_MAX_MS = 300_000;
/** Watchers outlive a request by this much, so nothing is missed between two polls. */
const IDLE_MS = 60_000;
/** How long after subscribers are told macOS can report the same change again. */
const REPEAT_MS = 1000;

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
    { path: join(env.managedDir, ".claude"), recursive: false, names: CONFIG_FOLDERS },
    ...CONFIG_FOLDERS.map((sub) => ({
      path: join(env.managedDir, ".claude", sub),
      recursive: true,
    })),
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
  return out;
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

/**
 * One target per folder and kind. Several missing files and folders can stand in for the same
 * folder that exists, and each watch costs a handle on Windows and a path in the macOS stream. A
 * plain watch is kept beside a recursive one: on Linux, Node's recursive watch can lose track of a
 * file after an editor saves it by renaming over it, and the plain watch still reports it.
 */
function oncePerFolder(list: Target[]): Target[] {
  const byKind = new Map<string, Target>();
  for (const target of list) {
    const key = `${target.recursive}:${target.path}`;
    const known = byKind.get(key);
    if (!known) {
      byKind.set(key, target);
      continue;
    }
    const names =
      known.names && target.names ? [...new Set([...known.names, ...target.names])] : undefined;
    byKind.set(key, { path: target.path, recursive: target.recursive, ...(names && { names }) });
  }
  return [...byKind.values()];
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
  /**
   * Folders the watchers should cover but do not: one that could not be watched, such as when the
   * system ran out of watches, one whose watcher failed, or one on a network drive. Empty when
   * every change is seen.
   */
  unwatched: string[];
  /** Each folder's failed tries in a row (see `Retries`), network drives aside. */
  retries: Retries;
  waiters: Set<() => void>;
  /** Callers of `subscribe`, called after every change until they unsubscribe. */
  listeners: Set<() => void>;
  extra: Target[];
  /** What the watchers saw since subscribers were last told. */
  seen: Seen;
  /** On macOS, the state of each path read before subscribers were last told, until `repeatsUntil`. */
  told: Map<string, string>;
  repeatsUntil: number;
  idle?: NodeJS.Timeout;
  settle?: NodeJS.Timeout;
}

/** The events of one settle, so one made only of repeats can be left untold. */
interface Seen {
  /** Whether an event was not a repeat, or was found to report a change. */
  counts: boolean;
  /** Possible repeats whose path is still being read. */
  checking: number;
  /** On macOS, each named path's state, once read. */
  states: Map<string, string>;
}

const nothingSeen = (): Seen => ({ counts: false, checking: 0, states: new Map() });

const identity = (info: BigIntStats) => `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

/** A path's inode, size and times, or undefined when it cannot be read. */
async function fileState(path: string): Promise<string | undefined> {
  const info = await stat(path, { bigint: true }).catch(() => null);
  return info ? identity(info) : undefined;
}

/**
 * `fileState` of a file, or undefined when it cannot tell a repeat from a change. The change time
 * moves on every write, even when a tool sets the modification time back, and a file renamed over
 * it has another inode. That needs times finer than a second: on a volume that keeps whole
 * seconds, such as HFS+ or FAT, two writes in one second look alike. A folder's own state does not
 * move when a file in it is edited, so a folder has none either.
 */
async function repeatState(path: string): Promise<string | undefined> {
  const info = await stat(path, { bigint: true }).catch(() => null);
  if (!info?.isFile() || info.ctimeNs % 1_000_000_000n === 0n) return undefined;
  return identity(info);
}

/** The latest scan of a directory, with when it started and ~/.claude.json as it was then. */
interface Scanned {
  view: DirectoryView;
  startedAt: number;
  stateFile: string;
}

/**
 * How many tries in a row failed to watch each folder, and since when a folder that has failed is
 * watched again. A count is cleared only once its folder has been watched for RETRY_MS, so a folder
 * whose watcher starts and soon fails keeps backing off.
 */
type Retries = Map<string, { failures: number; watchedSince?: number }>;

const lasted = (retry: { watchedSince?: number } | undefined, now: number) =>
  retry?.watchedSince !== undefined && now - retry.watchedSince >= RETRY_MS;

/**
 * The retries after a rewatch. A folder that failed counts one more failure only when the rewatch
 * was a timed retry: a rewatch for an ordinary change is no try, so changes elsewhere do not
 * lengthen the wait.
 */
function afterRewatch(
  before: Retries,
  unwatched: string[],
  started: string[],
  timed: boolean,
  now: number
): Retries {
  const after: Retries = new Map();
  for (const path of unwatched.filter((p) => !isNetworkPath(p))) {
    const retry = lasted(before.get(path), now) ? undefined : before.get(path);
    after.set(path, { failures: retry ? retry.failures + (timed ? 1 : 0) : 1 });
  }
  for (const path of started) {
    const retry = before.get(path);
    if (retry && !lasted(retry, now))
      after.set(path, { failures: retry.failures, watchedSince: retry.watchedSince ?? now });
  }
  return after;
}

/**
 * How long after the watchers started the folders they could not watch are tried again: the
 * shortest wait among them, doubling with each failure of a folder in a row.
 */
function retryDelay(subscription: Subscription): number {
  const tries = subscription.unwatched
    .filter((path) => !isNetworkPath(path))
    .map((path) => subscription.retries.get(path)?.failures ?? 1);
  return Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (Math.min(...tries) - 1));
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
   * current only while watchers that started before it, on every file it read, have seen no change
   * since it started, and ~/.claude.json, which is not watched, is as it was. Only an interactive
   * scan is reused, as the path tester describes an interactive session.
   */
  async view(dir: string): Promise<DirectoryView> {
    // Read first, so a watcher that fails meanwhile is seen below.
    const stateFile = await this.stateFile();
    const latest = this.latest.get(dir);
    const subscription = this.subscriptions.get(dir);
    if (
      latest?.view.profile === "interactive" &&
      subscription?.unwatched.length === 0 &&
      subscription.watchingSince < latest.startedAt &&
      subscription.touchedAt < latest.startedAt &&
      latest.stateFile === stateFile
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
   * the last change time, whichever comes first. While some folders cannot be watched, it tries
   * them again now and then, and answers at once with them in `unwatched`, since a change there
   * would never end the wait.
   */
  async wait(
    dir: string,
    since: number,
    signal: AbortSignal,
    timeoutMs = WAIT_MS
  ): Promise<{ changed: boolean; at: number; unwatched: string[] }> {
    const subscription = await this.watching(dir);
    if (
      // A network drive is never watched, so only other folders are worth another try.
      subscription.unwatched.some((path) => !isNetworkPath(path)) &&
      Date.now() - subscription.watchingSince >= retryDelay(subscription) &&
      this.subscriptions.get(dir) === subscription
    ) {
      this.restart(dir, subscription, true);
      await subscription.ready;
    }
    clearTimeout(subscription.idle);
    // Closed while its watchers were starting: there is nothing left to wait on.
    const closed = this.subscriptions.get(dir) !== subscription;
    try {
      if (
        !closed &&
        subscription.unwatched.length === 0 &&
        subscription.changedAt <= since &&
        !signal.aborted
      )
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
    return {
      changed: subscription.changedAt > since,
      at: subscription.changedAt,
      unwatched: subscription.unwatched,
    };
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
      unwatched: [],
      retries: new Map(),
      waiters: new Set(),
      listeners: new Set(),
      extra: this.scanned.get(dir) ?? [],
      seen: nothingSeen(),
      told: new Map(),
      repeatsUntil: 0,
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
   * Settles a change a watcher reported at `path`, or at an unnamed path. On macOS, a watcher can
   * report a change again soon after subscribers were told about it, after the watchers moved; a
   * change seen there and then is checked against the path's state from before they were told.
   * Every other event, on every other platform, counts without a check.
   */
  private noticed(dir: string, subscription: Subscription, path?: string): void {
    const seen = subscription.seen;
    if (this.host.platform === "darwin" && path !== undefined) {
      const told = Date.now() < subscription.repeatsUntil ? subscription.told.get(path) : undefined;
      if (told === undefined) seen.counts = true;
      else seen.checking++;
      void repeatState(path).then((state) => {
        if (state !== undefined) seen.states.set(path, state);
        if (told === undefined) return;
        seen.checking--;
        if (state !== told) seen.counts = true;
      });
    } else seen.counts = true;
    clearTimeout(subscription.settle);
    subscription.settle = setTimeout(() => this.tell(dir, subscription), SETTLE_MS);
  }

  /**
   * Tells waiters and subscribers about a settled change, unless every event in it was a repeat of
   * one they were told about. A path still being read counts, so a slow read never hides a change.
   * The states read by now were read before this, so a subscriber reads them or newer ones.
   */
  private tell(dir: string, subscription: Subscription): void {
    const seen = subscription.seen;
    subscription.seen = nothingSeen();
    if (!seen.counts && seen.checking === 0) return;
    // A copy: a read that finishes after this may see a later state, which the subscriber may not.
    subscription.told = new Map(seen.states);
    subscription.repeatsUntil = Date.now() + REPEAT_MS;
    subscription.changedAt = Date.now();
    // First, so a subscriber that throws cannot leave the old watchers in place.
    this.restart(dir, subscription);
    for (const wake of [...subscription.waiters, ...subscription.listeners]) wake();
  }

  /**
   * Rewatches `dir`; `timed` for a retry of folders that could not be watched. A failure rejects
   * `ready` for whoever awaits it, and is handled when no one does.
   */
  private restart(dir: string, subscription: Subscription, timed = false): void {
    subscription.ready = this.rewatch(dir, subscription, timed);
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
  private async rewatch(dir: string, subscription: Subscription, timed: boolean): Promise<void> {
    const list = oncePerFolder(
      await Promise.all((await targets(this.env, dir, subscription.extra)).map(nearestWatchable))
    );
    const old = subscription.watchers;
    subscription.watchers = [];
    if (this.subscriptions.get(dir) !== subscription) {
      for (const w of old) w.close();
      return;
    }
    const started: string[] = [];
    const unwatched: string[] = [];
    for (const target of list) {
      // A network drive may not report changes, so the folder is not watched (see isNetworkPath).
      if (isNetworkPath(target.path)) {
        unwatched.push(target.path);
        continue;
      }
      try {
        const watcher = this.host.watch(
          target.path,
          { recursive: target.recursive },
          (_event, name) => {
            // An event that names nothing may be about any entry, so it counts.
            if (target.names && name !== null && !target.names.includes(basename(String(name))))
              return;
            subscription.touchedAt = Date.now();
            this.noticed(
              dir,
              subscription,
              name === null ? undefined : join(target.path, String(name))
            );
          }
        );
        watcher.on("error", () => {
          watcher.close();
          if (!subscription.watchers.includes(watcher)) return;
          if (!subscription.unwatched.includes(target.path))
            subscription.unwatched = [...subscription.unwatched, target.path];
          // A watcher that failed soon after it started counts as one more failed try.
          const retry = subscription.retries.get(target.path);
          subscription.retries.set(target.path, {
            failures: retry && !lasted(retry, Date.now()) ? retry.failures + 1 : 1,
          });
          // A page waiting for a change hears that this folder is no longer watched.
          for (const wake of [...subscription.waiters]) wake();
        });
        subscription.watchers.push(watcher);
        started.push(target.path);
      } catch (error) {
        // A folder removed since nearestWatchable looked is caught by its parent's watcher. Any other
        // failure, such as running out of watches, leaves the folder unwatched.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") unwatched.push(target.path);
      }
    }
    for (const w of old) w.close();
    if (this.host.platform === "darwin" && started.length > 0) this.waitUntilLive(dir, started);
    subscription.watchingSince = Date.now();
    subscription.unwatched = [...new Set(unwatched)];
    subscription.retries = afterRewatch(
      subscription.retries,
      subscription.unwatched,
      started,
      timed,
      subscription.watchingSince
    );
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
