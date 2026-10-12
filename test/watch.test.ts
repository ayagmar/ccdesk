import assert from "node:assert/strict";
import { after, test } from "node:test";
import { scanDirectory } from "../src/server/scan/index.ts";
import { testPath } from "../src/server/scan/path-test.ts";
import { Watcher } from "../src/server/watch.ts";
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
  const watcher = new Watcher(f.env, (env, dir) => {
    counter.scans++;
    return scanDirectory(env, dir);
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
