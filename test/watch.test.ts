import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, test } from "node:test";
import { scanDirectory } from "../src/core/scan/index.ts";
import { testPath } from "../src/core/scan/path-test.ts";
import { Watcher } from "../src/core/watch.ts";
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

test("editing a project's CLAUDE.md wakes a page waiting for changes", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  setTimeout(() => f.write("app/CLAUDE.md", "two\n"), 100);

  assert.equal((await waiting).changed, true);
});

test("creating a file CLAUDE.md imports but that was missing wakes a page waiting for changes", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/new.md\n");
  f.write("app/docs/README.md", "Not imported.\n");
  const watcher = watcherFor(f);
  await watcher.scan(f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  setTimeout(() => f.write("app/docs/new.md", "Now here.\n"), 100);

  assert.equal((await waiting).changed, true);
});

test("creating the missing folder of an import, then the file, wakes a page each time", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/new-folder/new.md\n");
  f.write("app/docs/README.md", "Not imported.\n");
  const watcher = watcherFor(f);
  await watcher.scan(f.at("app"));
  const signal = new AbortController().signal;

  const folder = watcher.wait(f.at("app"), Date.now(), signal, 5000);
  setTimeout(() => mkdirSync(f.at("app/docs/new-folder")), 100);
  const first = await folder;
  assert.equal(first.changed, true);

  // No scan in between: the watchers move into the new folder on their own.
  const file = watcher.wait(f.at("app"), first.at, signal, 5000);
  setTimeout(() => f.write("app/docs/new-folder/new.md", "Now here.\n"), 100);
  assert.equal((await file).changed, true);
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

test("editing a file inside an installed plugin wakes a page waiting for changes", async () => {
  const { f, plugin, watcher } = pluginFixture({});
  f.write(`${plugin}/agents/review.md`, "---\nname: review\ndescription: one\n---\n");
  await watcher.scan(f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  setTimeout(
    () => f.write(`${plugin}/agents/review.md`, "---\nname: review\ndescription: two\n---\n"),
    100
  );

  assert.equal((await waiting).changed, true);
});

test("editing an agent in a folder the plugin's manifest names wakes a page waiting for changes", async () => {
  const { f, plugin, watcher } = pluginFixture({ agents: "./custom/" });
  f.write(`${plugin}/custom/review.md`, "---\nname: review\ndescription: one\n---\n");
  await watcher.scan(f.at("app"));

  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  setTimeout(
    () => f.write(`${plugin}/custom/review.md`, "---\nname: review\ndescription: two\n---\n"),
    100
  );

  assert.equal((await waiting).changed, true);
});

test("files a plugin's MCP server writes in its own folder do not count as a config change", async () => {
  const { f, plugin, watcher } = pluginFixture({});
  f.json(`${plugin}/.mcp.json`, { mcpServers: { db: { command: "node", args: ["server.js"] } } });
  f.write(`${plugin}/node_modules/dep/index.js`, "a");
  f.write(`${plugin}/data/state.json`, "a");
  await watcher.scan(f.at("app"));
  // macOS can report changes made just before a watch starts; let those settle first.
  const signal = new AbortController().signal;
  await watcher.wait(f.at("app"), Number.MAX_SAFE_INTEGER, signal, 1000);

  const waiting = watcher.wait(f.at("app"), Date.now(), signal, 800);
  setTimeout(() => {
    f.write(`${plugin}/node_modules/dep/index.js`, "b");
    f.write(`${plugin}/data/state.json`, "b");
  }, 100);

  assert.equal((await waiting).changed, false);
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a subscriber hears once about an editor's save, and nothing after unsubscribing", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "one\n");
  const watcher = watcherFor(f);
  // macOS can report changes made just before a watch starts; let those settle first.
  await watcher.wait(f.at("app"), Number.MAX_SAFE_INTEGER, new AbortController().signal, 1000);
  let calls = 0;
  const unsubscribe = await watcher.subscribe(f.at("app"), () => calls++);

  // An editor writes a file in several steps; the subscriber hears about the save once.
  f.write("app/CLAUDE.md", "two\n");
  await pause(100);
  f.write("app/CLAUDE.md", "three\n");
  await pause(1000);
  assert.equal(calls, 1);

  unsubscribe();
  f.write("app/CLAUDE.md", "four\n");
  await pause(1000);
  assert.equal(calls, 1);
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
  const waiting = watcher.wait(f.at("app"), Date.now(), new AbortController().signal, 5000);
  await new Promise((resolve) => setTimeout(resolve, 100));

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
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(
    (await watcher.wait(f.at("app"), since, new AbortController().signal, 50)).changed,
    true
  );
});

test("work in Claude Code's worktrees or unrelated files does not count as a config change", async () => {
  const f = makeFixture();
  f.write("app/.claude/worktrees/feature/CLAUDE.md", "a");
  f.write("app/notes.txt", "a");
  const watcher = watcherFor(f);
  // macOS can report changes made just before a watch starts, such as the files above; wait
  // until those have settled so only the edits below are judged.
  const signal = new AbortController().signal;
  await watcher.wait(f.at("app"), Number.MAX_SAFE_INTEGER, signal, 1000);

  const waiting = watcher.wait(f.at("app"), Date.now(), signal, 800);
  setTimeout(() => {
    f.write("app/.claude/worktrees/feature/CLAUDE.md", "b");
    f.write("app/notes.txt", "b");
  }, 100);

  assert.equal((await waiting).changed, false);
});

/**
 * A watcher that counts its scans, set up as a page does it: `app` is scanned, then watched, with
 * change reports from before the watch settled.
 */
async function countingWatcher(f: ReturnType<typeof makeFixture>) {
  const counter = { scans: 0 };
  const watcher = new Watcher(f.env, (env, dir, profile) => {
    counter.scans++;
    return scanDirectory(env, dir, profile);
  });
  watchers.push(watcher);
  await watcher.scan(f.at("app"));
  await watcher.wait(f.at("app"), Number.MAX_SAFE_INTEGER, new AbortController().signal, 1000);
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
