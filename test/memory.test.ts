import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { test } from "node:test";
import { scanDirectory, scanOverview } from "../src/server/scan/index.ts";
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
