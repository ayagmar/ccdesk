import assert from "node:assert/strict";
import { type FSWatcher, mkdirSync, utimesSync, type WatchListener, watch } from "node:fs";
import { after, test } from "node:test";
import { scanDirectory, testPath, Watcher } from "../src/core/index.ts";
import { type WatchHost } from "../src/core/watch.ts";
import { makeFixture } from "./helpers/fixture.ts";

const watchers: Watcher[] = [];
after(() => {
  for (const w of watchers) w.close();
});

function watcherFor(f: ReturnType<typeof makeFixture>) {
  const watcher = new Watcher(f.env);
  watchers.push(watcher);
  return watcher;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the watchers of `dir` have started, so a change made after it is seen. */
async function started(watcher: Watcher, dir: string): Promise<void> {
  await watcher.subscribe(dir, () => {
    // Only here to start the watchers.
  });
}

/**
 * Starts the watchers of `dir`. macOS can report changes made just before a watch starts, such as
 * the fixture's own files; there it also waits until those have settled, so only later edits count.
 */
async function settled(watcher: Watcher, dir: string): Promise<void> {
  await started(watcher, dir);
  if (process.platform === "darwin") await pause(1000);
}

test("editing a project's CLAUDE.md wakes a page waiting for changes", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  await started(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write("app/CLAUDE.md", "two\n");

  assert.equal((await waiting).changed, true);
});

test("adding a rule to the managed folder wakes a page waiting for changes", async () => {
  const f = makeFixture();
  mkdirSync(f.at("app"), { recursive: true });
  f.write("etc/claude-code/.claude/rules/security.md", "one\n");
  const watcher = watcherFor(f);
  await settled(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write("etc/claude-code/.claude/rules/infra/new.md", "two\n");

  assert.equal((await waiting).changed, true);
});

test("editing a skill in the managed folder wakes a page waiting for changes", async () => {
  const f = makeFixture();
  mkdirSync(f.at("app"), { recursive: true });
  f.write("etc/claude-code/.claude/skills/deploy/SKILL.md", "---\ndescription: one\n---\n");
  const watcher = watcherFor(f);
  await settled(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write("etc/claude-code/.claude/skills/deploy/SKILL.md", "---\ndescription: two\n---\n");

  assert.equal((await waiting).changed, true);
});

test("creating a file CLAUDE.md imports but that was missing wakes a page waiting for changes", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/new.md\n");
  f.write("app/docs/README.md", "Not imported.\n");
  const watcher = watcherFor(f);
  await watcher.scan(f.at("app"));
  await started(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write("app/docs/new.md", "Now here.\n");

  assert.equal((await waiting).changed, true);
});

test("creating the missing folder of an import, then the file, wakes a page each time", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/new-folder/new.md\n");
  f.write("app/docs/README.md", "Not imported.\n");
  const watcher = watcherFor(f);
  await watcher.scan(f.at("app"));
  await started(watcher, f.at("app"));
  const signal = new AbortController().signal;

  const folder = watcher.wait(f.at("app"), Date.now(), signal, 5000);
  mkdirSync(f.at("app/docs/new-folder"));
  const first = await folder;
  assert.equal(first.changed, true);

  // No scan in between: the watchers move into the new folder on their own.
  await started(watcher, f.at("app"));
  const file = watcher.wait(f.at("app"), first.at, signal, 5000);
  f.write("app/docs/new-folder/new.md", "Now here.\n");
  assert.equal((await file).changed, true);
});

test("on macOS, subscribing fails while the watchers cannot be shown to be live, and works once they can", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  // The watchers open. The spare watch, opened without a listener to show they are live, fails
  // while `spareFails` is set, as when its folder goes away or no more watches can open.
  let spareFails = true;
  const host: WatchHost = {
    platform: "darwin",
    watch: ((path: string, options?: { recursive?: boolean }, listener?: WatchListener<string>) => {
      if (listener) return watch(path, options ?? {}, listener);
      if (spareFails)
        throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${path}'`), {
          code: "ENOENT",
        });
      return watch(path);
    }) as typeof watch,
  };
  const watcher = new Watcher(f.env, scanDirectory, host);
  watchers.push(watcher);

  await assert.rejects(started(watcher, f.at("app")), { code: "ENOENT" });

  // The failed start is not kept: the next subscriber starts the watchers again.
  spareFails = false;
  await started(watcher, f.at("app"));
  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write("app/CLAUDE.md", "two\n");
  assert.equal((await waiting).changed, true);
});

/** A watcher on `app`, with the plugin `alpha` installed at `plugin` and its manifest. */
function pluginFixture(manifest: Record<string, unknown>) {
  const f = makeFixture();
  const plugin = "home/.claude/plugins/cache/market/alpha/1.0.0";
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "alpha@market": [{ scope: "user", installPath: f.at(plugin), version: "1.0.0" }] },
  });
  f.json(`${plugin}/.claude-plugin/plugin.json`, { name: "alpha", ...manifest });
  f.write("app/README.md", "x");
  return { f, plugin, watcher: watcherFor(f) };
}

test("a change to a plugin's marketplace entry, or the marketplace record appearing, wakes a page and updates its view", async () => {
  const { f, watcher } = pluginFixture({});
  const entry = (defaultEnabled: boolean) => ({
    name: "market",
    plugins: [{ name: "alpha", source: "./alpha", defaultEnabled }],
  });
  f.json("market/.claude-plugin/marketplace.json", entry(false));
  const enabled = async () =>
    (await watcher.view(f.at("app"))).inventory.plugins.find((p) => p.id === "alpha@market")
      ?.enabled;
  await watcher.scan(f.at("app"));
  await started(watcher, f.at("app"));
  assert.equal(await enabled(), true);

  // known_marketplaces.json does not exist yet: creating it counts.
  const created = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.json("home/.claude/plugins/known_marketplaces.json", {
    market: {
      source: { source: "directory", path: f.at("market") },
      installLocation: f.at("market"),
    },
  });
  assert.equal((await created).changed, true);
  assert.equal(await enabled(), false);

  await started(watcher, f.at("app"));
  const edited = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.json("market/.claude-plugin/marketplace.json", entry(true));
  assert.equal((await edited).changed, true);
  assert.equal(await enabled(), true);
});

test("editing a file inside an installed plugin wakes a page waiting for changes", async () => {
  const { f, plugin, watcher } = pluginFixture({});
  f.write(`${plugin}/agents/review.md`, "---\nname: review\ndescription: one\n---\n");
  await watcher.scan(f.at("app"));
  await started(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write(`${plugin}/agents/review.md`, "---\nname: review\ndescription: two\n---\n");

  assert.equal((await waiting).changed, true);
});

test("editing an agent in a folder the plugin's manifest names wakes a page waiting for changes", async () => {
  const { f, plugin, watcher } = pluginFixture({ agents: "./custom/" });
  f.write(`${plugin}/custom/review.md`, "---\nname: review\ndescription: one\n---\n");
  await watcher.scan(f.at("app"));
  await started(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  f.write(`${plugin}/custom/review.md`, "---\nname: review\ndescription: two\n---\n");

  assert.equal((await waiting).changed, true);
});

test("files a plugin's MCP server writes in its own folder do not count as a config change", async () => {
  const { f, plugin, watcher } = pluginFixture({});
  f.json(`${plugin}/.mcp.json`, { mcpServers: { db: { command: "node", args: ["server.js"] } } });
  f.write(`${plugin}/node_modules/dep/index.js`, "a");
  f.write(`${plugin}/data/state.json`, "a");
  await watcher.scan(f.at("app"));
  await settled(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 800);
  f.write(`${plugin}/node_modules/dep/index.js`, "b");
  f.write(`${plugin}/data/state.json`, "b");

  assert.equal((await waiting).changed, false);
});

test("a subscriber hears once about an editor's save, and nothing after unsubscribing", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  await settled(watcher, f.at("app"));
  let calls = 0;
  let heard = () => {
    // Replaced below, before anything can change.
  };
  const first = new Promise<void>((resolve) => {
    heard = resolve;
  });
  const unsubscribe = await watcher.subscribe(f.at("app"), () => {
    calls++;
    heard();
  });

  // An editor writes a file in several steps; the subscriber hears about the save once.
  f.write("app/CLAUDE.md", "two\n");
  await pause(100);
  f.write("app/CLAUDE.md", "three\n");
  await first;
  // A second call would come one settle (300 ms) after the last change was reported.
  await pause(500);
  assert.equal(calls, 1);

  unsubscribe();
  const since = Date.now();
  f.write("app/CLAUDE.md", "four\n");
  // Answers once the change has settled, when subscribers are told.
  await watcher.wait(f.at("app"), since, new AbortController().signal, 5000);
  assert.equal(calls, 1);
});

/**
 * A watcher on `app` on a `platform` host whose watchers report only what the test passes to
 * `reportEdit`, as fs.watch would, after `app/CLAUDE.md` was edited to "two" and subscribers were told.
 */
async function toldOn(platform: NodeJS.Platform) {
  const open = new Set<{ path: string; listener: WatchListener<string> | undefined }>();
  const host: WatchHost = {
    platform,
    watch: ((path: string, _options?: unknown, listener?: WatchListener<string>) => {
      const entry = { path, listener };
      open.add(entry);
      const watcher = {
        close: () => open.delete(entry),
        on: () => watcher,
      };
      return watcher as unknown as FSWatcher;
    }) as typeof watch,
  };
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = new Watcher(f.env, scanDirectory, host);
  watchers.push(watcher);
  const counter = { calls: 0 };
  await watcher.subscribe(f.at("app"), () => counter.calls++);
  const reportEdit = (name = "CLAUDE.md") => {
    for (const entry of [...open]) if (entry.path === f.at("app")) entry.listener?.("change", name);
  };
  const waitFor = (changedSince: number, timeoutMs: number) =>
    watcher.wait(f.at("app"), changedSince, new AbortController().signal, timeoutMs);

  const since = Date.now();
  f.write("app/CLAUDE.md", "two\n");
  // A whole second, so a test can set the same modification time back exactly.
  const mtime = new Date("2026-01-01T00:00:00Z");
  utimesSync(f.at("app/CLAUDE.md"), mtime, mtime);
  reportEdit();
  const first = await waitFor(since, 5000);
  assert.equal(first.changed, true);
  // The watchers move after a change; macOS can report the change again to the new ones.
  await started(watcher, f.at("app"));
  return { f, watcher, counter, reportEdit, waitFor, told: first.at, mtime };
}

test("on macOS, a change reported again after the watchers move is told once, and the next edit is told", async () => {
  const { f, counter, reportEdit, waitFor, told } = await toldOn("darwin");

  reportEdit();
  assert.equal((await waitFor(told, 800)).changed, false);
  assert.equal(counter.calls, 1);

  f.write("app/CLAUDE.md", "three\n");
  reportEdit();
  assert.equal((await waitFor(told, 5000)).changed, true);
  assert.equal(counter.calls, 2);
});

test("on macOS, an edit right after the watchers move is told even with the same size and modification time", async () => {
  const { f, counter, reportEdit, waitFor, told, mtime } = await toldOn("darwin");

  // As cp -p or rsync -a leave it: other text of the same length, with the old modification time.
  f.write("app/CLAUDE.md", "six\n");
  utimesSync(f.at("app/CLAUDE.md"), mtime, mtime);
  reportEdit();

  assert.equal((await waitFor(told, 5000)).changed, true);
  assert.equal(counter.calls, 2);
});

test("on Linux, a change reported again after the watchers move is told again, as every change is", async () => {
  const { counter, reportEdit, waitFor, told } = await toldOn("linux");

  reportEdit();

  assert.equal((await waitFor(told, 5000)).changed, true);
  assert.equal(counter.calls, 2);
});

test("on macOS, a folder reported again right after the watchers move is told, since a file in it may have changed", async () => {
  const { f, watcher, counter, reportEdit, waitFor, told } = await toldOn("darwin");
  f.write("app/.claude/settings.json", "{}\n");
  reportEdit(".claude");
  const second = await waitFor(told, 5000);
  assert.equal(second.changed, true);
  await started(watcher, f.at("app"));

  // An edit inside the folder leaves the folder's own size and times as they were.
  f.write("app/.claude/settings.json", "[]\n");
  reportEdit(".claude");

  assert.equal((await waitFor(second.at, 5000)).changed, true);
  assert.equal(counter.calls, 3);
});

test("a change a watcher reports without naming the file wakes a page waiting for changes", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const listeners = new Map<string, WatchListener<string>>();
  // fs.watch passes no file name where the system does not give one.
  const host: WatchHost = {
    platform: process.platform,
    watch: ((path: string, _options?: unknown, listener?: WatchListener<string>) => {
      if (listener) listeners.set(path, listener);
      const watcher = { close: () => undefined, on: () => watcher };
      return watcher as unknown as FSWatcher;
    }) as typeof watch,
  };
  const watcher = new Watcher(f.env, scanDirectory, host);
  watchers.push(watcher);
  await started(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  listeners.get(f.at("app"))?.("change", null);

  assert.equal((await waiting).changed, true);
});

test("closing the watcher does not tell a subscriber something changed", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  let calls = 0;
  await watcher.subscribe(f.at("app"), () => calls++);

  watcher.close();
  await pause(100);

  assert.equal(calls, 0);
});

test("closing the watcher answers a page still waiting, instead of keeping it until the timeout", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  await started(watcher, f.at("app"));
  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  // The wait is waiting once the calls it queued have run.
  await new Promise((resolve) => setImmediate(resolve));

  watcher.close();
  const answered = await Promise.race([
    waiting.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);

  assert.equal(answered, true);
});

test("closing the watcher while a wait is still starting answers it too", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  watcher.close();
  const answered = await Promise.race([
    waiting.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);

  assert.equal(answered, true);
});

test("a change between two polls is reported to the next poll", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  const since = Date.now();

  await watcher.wait(f.at("app"), since, new AbortController().signal, 50);
  f.write("app/CLAUDE.md", "two\n");

  // Watchers started by this poll would miss the change, and wait until the timeout.
  assert.equal(
    (await watcher.wait(f.at("app"), since, new AbortController().signal, 5000)).changed,
    true
  );
});

test("work in Claude Code's worktrees or unrelated files does not count as a config change", async () => {
  const f = makeFixture();
  f.write("app/.claude/worktrees/feature/CLAUDE.md", "a");
  f.write("app/notes.txt", "a");
  const watcher = watcherFor(f);
  await settled(watcher, f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 800);
  f.write("app/.claude/worktrees/feature/CLAUDE.md", "b");
  f.write("app/notes.txt", "b");

  assert.equal((await waiting).changed, false);
});

/**
 * A watcher that counts its scans, set up as a page does it: `app` is scanned, then watched, with
 * change reports from before the watch settled.
 */
async function countingWatcher(f: ReturnType<typeof makeFixture>, host?: WatchHost) {
  const counter = { scans: 0 };
  const watcher = new Watcher(
    f.env,
    (env, dir, profile) => {
      counter.scans++;
      return scanDirectory(env, dir, profile);
    },
    host
  );
  watchers.push(watcher);
  await watcher.scan(f.at("app"));
  await settled(watcher, f.at("app"));
  // A scan is reused only when it started after the watchers, in a later millisecond.
  const watchingSince = Date.now();
  while (Date.now() === watchingSince) await pause(1);
  counter.scans = 0;
  const pathTest = () => testPath(f.env, f.at("app"), "src/api/x.ts", (cwd) => watcher.view(cwd));
  return { watcher, counter, pathTest };
}

test("the path tester reuses a scan until a file it read changes", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/api.md", "---\npaths: src/api/**\n---\nAPI\n");
  const { watcher, counter, pathTest } = await countingWatcher(f);

  // The page's scan started before the watch, so the first test scans again; the next reuses it.
  await pathTest();
  await pathTest();
  assert.equal(counter.scans, 1);

  const since = Date.now();
  f.write("app/.claude/rules/web.md", "---\npaths: src/**\n---\nWeb\n");
  await watcher.wait(f.at("app"), since, new AbortController().signal, 5000);
  const result = await pathTest();

  assert.equal(counter.scans, 2);
  assert.ok(result.matches.some((m) => m.path.endsWith("web.md")));
});

test("the path tester does not reuse a claude -p scan, since it describes an interactive session", async () => {
  const f = makeFixture();
  const { watcher, counter, pathTest } = await countingWatcher(f);
  await pathTest();
  await watcher.scan(f.at("app"), "print");
  counter.scans = 0;

  await pathTest();
  await pathTest();

  assert.equal(counter.scans, 1);
});

test("the path tester scans again after ~/.claude.json changes, which is not watched", async () => {
  const f = makeFixture();
  f.json("home/.claude.json", { projects: {} });
  const { counter, pathTest } = await countingWatcher(f);

  await pathTest();
  await pathTest();
  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  await pathTest();

  assert.equal(counter.scans, 2);
});

/** A host on which `folder` cannot be watched, as when the system runs out of watches. */
function cannotWatch(folder: string): WatchHost {
  return {
    platform: process.platform,
    watch: ((path: string, options?: { recursive?: boolean }, listener?: WatchListener<string>) => {
      if (path === folder)
        throw Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), {
          code: "ENOSPC",
        });
      return listener ? watch(path, options ?? {}, listener) : watch(path);
    }) as typeof watch,
  };
}

test("the path tester does not reuse a scan while a folder it read cannot be watched", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/api.md", "---\npaths: src/api/**\n---\nAPI\n");
  const { pathTest } = await countingWatcher(f, cannotWatch(f.at("app/.claude/rules")));
  await pathTest();

  f.write("app/.claude/rules/web.md", "---\npaths: src/**\n---\nWeb\n");
  const result = await pathTest();

  assert.ok(result.matches.some((m) => m.path.endsWith("web.md")));
});

test("while a folder cannot be watched, a waiting page hears at once that live updates are off", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/api.md", "API\n");
  const watcher = new Watcher(f.env, scanDirectory, cannotWatch(f.at("app/.claude/rules")));
  watchers.push(watcher);

  const answer = await watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);

  assert.equal(answer.watching, false);
  assert.equal(answer.changed, false);
});
