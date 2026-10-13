import assert from "node:assert/strict";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scanDirectory, scanOverview } from "../src/core/index.ts";
import { storeDirName } from "../src/shared/memory.ts";
import { makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

test("a worktree and a subdirectory of a repository share the main repository's memory", async () => {
  const f = makeFixture();
  f.write("repo/packages/api/README.md", "hi");
  f.git("repo", "init", "-q");
  f.git("repo", "add", ".");
  f.git("repo", "commit", "-qm", "init");
  f.git("repo", "worktree", "add", "-q", f.at("repo-feature"));
  f.write(`${memoryDirFor(f, f.at("repo"))}/MEMORY.md`, "- [Style](style.md) — tabs\n");
  f.write(
    `${memoryDirFor(f, f.at("repo"))}/style.md`,
    memoryFile("style", "feedback", "tabs", "Use tabs.")
  );

  for (const dir of ["repo-feature", "repo/packages/api"]) {
    const view = await scanDirectory(f.env, f.at(dir));
    assert.equal(view.memory.projectPath, f.at("repo"), dir);
    assert.deepEqual(
      view.memory.memories.map((m) => m.name),
      ["style"],
      dir
    );
  }
});

test("MEMORY.md past 200 lines is flagged as partly unread", async () => {
  const f = makeFixture();
  const lines = Array.from({ length: 230 }, (_, i) => `- [m${i}](m${i}.md) — note`);
  f.write(`${memoryDirFor(f, f.at("app"))}/MEMORY.md`, lines.join("\n"));
  mkdirSync(f.at("app"));

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.memory?.index?.truncated, true);
  assert.equal(view.memory?.index?.loadedLines, 200);
});

test("MEMORY.md of exactly 200 lines, ending in a newline, loads in full", async () => {
  const f = makeFixture();
  const lines = Array.from({ length: 200 }, (_, i) => `- [m${i}](m${i}.md) — note`);
  f.write(`${memoryDirFor(f, f.at("app"))}/MEMORY.md`, `${lines.join("\n")}\n`);
  mkdirSync(f.at("app"));

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.memory?.index?.truncated, false);
  assert.equal(view.memory?.index?.loadedLines, 200);
});

test("upkeep problems are reported: unindexed memory, broken links, index entries without a file", async () => {
  const f = makeFixture();
  mkdirSync(f.at("app"));
  const dir = memoryDirFor(f, f.at("app"));
  f.write(`${dir}/MEMORY.md`, "- [A](a.md) — first\n- [Gone](gone.md) — deleted by hand\n");
  f.write(`${dir}/a.md`, memoryFile("a", "user", "first", "See [[b]] and [[missing]]."));
  f.write(`${dir}/b.md`, memoryFile("b", "reference", "second", "Plain."));

  const view = await scanDirectory(f.env, f.at("app"));
  const byName = Object.fromEntries((view.memory?.memories ?? []).map((m) => [m.name, m]));

  assert.equal(byName.a?.inIndex, true);
  assert.equal(byName.b?.inIndex, false);
  assert.deepEqual(byName.a?.brokenLinks, ["missing"]);
  assert.deepEqual(byName.b?.linkedFrom, ["a"]);
  assert.deepEqual(view.memory?.index?.missingFiles, ["gone.md"]);
});

test("the overview finds the same memory saved in two projects and whether it drifted", async () => {
  const f = makeFixture();
  const same = memoryFile("review", "feedback", "how to review", "Use a fresh reviewer.");
  f.write(`${memoryDirFor(f, "/work/one")}/review.md`, same);
  f.write(`${memoryDirFor(f, "/work/two")}/review.md`, same);
  f.write(`${memoryDirFor(f, "/work/two")}/only.md`, memoryFile("only", "project", "d", "b"));
  f.json("home/.claude.json", { projects: { "/work/one": {}, "/work/two": {} } });

  const overview = await scanOverview(f.env, f.at("home"));

  assert.equal(overview.sharedMemories.length, 1);
  const [shared] = overview.sharedMemories;
  assert.equal(shared?.name, "review");
  assert.deepEqual(
    shared?.stores.map((s) => s.projectPath),
    ["/work/one", "/work/two"]
  );
  assert.equal(shared?.stores[0]?.hash, shared?.stores[1]?.hash);
});

test("a memory file that cannot be read is reported as a problem, not dropped silently", {
  // Root reads any file, and Windows ignores the mode bits that make a file unreadable.
  skip: process.getuid?.() === 0 || process.platform === "win32",
}, async () => {
  const f = makeFixture();
  mkdirSync(f.at("app"));
  const dir = memoryDirFor(f, f.at("app"));
  f.write(`${dir}/a.md`, memoryFile("a", "user", "first", "Readable."));
  const locked = f.write(`${dir}/b.md`, memoryFile("b", "user", "second", "Locked."));
  chmodSync(locked, 0o000);

  const view = await scanDirectory(f.env, f.at("app"));

  chmodSync(locked, 0o644);
  assert.deepEqual(
    view.problems.map((p) => [p.path, p.error]),
    [[locked, "cannot be read (EACCES)"]]
  );
});

test("a link loop where a memory file should be is reported as a problem", async () => {
  const f = makeFixture();
  mkdirSync(f.at("app"));
  const dir = memoryDirFor(f, f.at("app"));
  const loop = join(dir, "loop.md");
  f.link(loop, loop);

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.problems.map((p) => [p.path, p.error]),
    [[loop, "cannot be read (ELOOP)"]]
  );
});

test("a project path over 200 characters gets the store name Claude Code gives it", () => {
  const deep = `/home/dev/${"monorepo/packages/".repeat(10)}service-with-a-long-name/src`;
  // Worked out with the SDK 0.3.296's own function for this path: cut at 200, then a hash.
  assert.equal(storeDirName(deep), `-home-dev-${"monorepo-packages-".repeat(10)}service-wi-9nhroh`);
  assert.equal(storeDirName("/home/dev/app"), "-home-dev-app");
});
