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

test("a submodule's subfolders share the submodule's memory, and a bare repository's worktrees share the bare folder's", async () => {
  const f = makeFixture();
  const commit = (dir: string) => {
    f.git(dir, "init", "-q");
    f.git(dir, "add", ".");
    f.git(dir, "commit", "-qm", "init");
  };
  f.write("lib-src/pkg/README.md", "lib");
  commit("lib-src");
  f.write("super/README.md", "super");
  commit("super");
  f.git(
    "super",
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    f.at("lib-src"),
    "lib"
  );
  f.git("lib-src", "clone", "-q", "--bare", f.at("lib-src"), f.at("repo.git"));
  f.git("repo.git", "worktree", "add", "-q", f.at("wt"));

  for (const [dir, key] of [
    ["super/lib/pkg", "super/lib"],
    ["super/lib", "super/lib"],
    // Claude Code names the store after the bare folder itself, not its parent (observed in v2.1.296).
    ["wt/pkg", "repo.git"],
  ] as const) {
    const view = await scanDirectory(f.env, f.at(dir));
    assert.equal(view.memory.projectPath, f.at(key), dir);
    assert.equal(view.memory.dir, memoryDirFor(f, f.at(key)), dir);
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
  f.write(`${dir}/a.md`, memoryFile("a", "user", "first", "See [[b]] and [[missing]]."));
  f.write(`${dir}/b.md`, memoryFile("b", "reference", "second", "Plain."));
  // A percent-encoded link names a file that is there.
  f.write(
    `${dir}/MEMORY.md`,
    "- [A](a.md) — first\n- [Gone](gone.md) — deleted by hand\n- [C](my%20c.md)\n"
  );
  f.write(`${dir}/my c.md`, memoryFile("c", "user", "third", "Spaces."));

  const view = await scanDirectory(f.env, f.at("app"));
  const byName = Object.fromEntries((view.memory?.memories ?? []).map((m) => [m.name, m]));

  assert.equal(byName.a?.inIndex, true);
  assert.equal(byName.b?.inIndex, false);
  assert.equal(byName.c?.inIndex, true);
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

test("a repository's memory store shows under the repository when Claude Code only ran in a subfolder of it", async () => {
  const f = makeFixture();
  const repo = f.at("repo");
  const api = f.at("repo/services/api");
  mkdirSync(api, { recursive: true });
  // Sessions are kept under the folder Claude Code ran in; memory under the repository root.
  f.write(
    join(f.env.claudeDir, "projects", storeDirName(api), "one.jsonl"),
    `${JSON.stringify({ type: "user", cwd: api })}\n`
  );
  const review = memoryFile("review", "feedback", "how to review", "Use a fresh reviewer.");
  f.write(`${memoryDirFor(f, repo)}/review.md`, review);
  f.write(`${memoryDirFor(f, "/work/other")}/review.md`, review);
  f.json("home/.claude.json", { projects: { "/work/other": {} } });

  const overview = await scanOverview(f.env, f.at("home"));

  const row = overview.projects.find((p) => p.path === repo);
  assert.deepEqual(row && { exists: row.exists, sessions: row.sessions, memories: row.memories }, {
    exists: true,
    sessions: 0,
    memories: 1,
  });
  assert.deepEqual(
    overview.memoryCatalog.filter((m) => m.projectPath === repo).map((m) => m.name),
    ["review"]
  );
  assert.deepEqual(
    overview.sharedMemories.map((s) => s.stores.map((store) => store.projectPath).sort()),
    [[repo, "/work/other"].sort()]
  );
});

test("a store named like the launch directory goes to it, not to a parent of another directory with the same store name", async () => {
  const f = makeFixture();
  // a/b and a-b/c's parent a-b both give the store name ...-a-b.
  const launch = f.at("a/b");
  mkdirSync(launch, { recursive: true });
  f.json("home/.claude.json", { projects: { [f.at("a-b/c")]: {} } });
  f.write(`${memoryDirFor(f, launch)}/note.md`, memoryFile("note", "user", "d", "b"));

  const overview = await scanOverview(f.env, launch);

  assert.deepEqual(
    overview.memoryCatalog.map((m) => m.projectPath),
    [launch]
  );
  assert.equal(
    overview.projects.find((p) => p.path === f.at("a-b")),
    undefined
  );
});

test("a leftover store named after a subfolder of a repository is not listed under that subfolder", async () => {
  const f = makeFixture();
  const api = f.at("repo/services/api");
  mkdirSync(api, { recursive: true });
  f.git("repo", "init", "-q");
  f.json("home/.claude.json", { projects: { [api]: {} } });
  // Left from before `git init` at the root: Claude Code in repo/services now uses repo's store.
  f.write(`${memoryDirFor(f, f.at("repo/services"))}/old.md`, memoryFile("old", "user", "d", "b"));
  f.write(`${memoryDirFor(f, f.at("repo"))}/new.md`, memoryFile("new", "user", "d", "b"));

  const overview = await scanOverview(f.env, f.at("home"));

  assert.deepEqual(
    overview.memoryCatalog.map((m) => [m.projectPath, m.name]),
    [[f.at("repo"), "new"]]
  );
  assert.equal(
    overview.projects.find((p) => p.path === f.at("repo/services")),
    undefined
  );
});

test("a leftover store named after the launch directory inside a repository is not its memory", async () => {
  // Catches the launch directory taking a store Claude Code no longer uses there: All directories
  // and the palette would list a memory its page does not show.
  const f = makeFixture();
  const services = f.at("repo/services");
  mkdirSync(services, { recursive: true });
  f.git("repo", "init", "-q");
  f.write(`${memoryDirFor(f, services)}/old.md`, memoryFile("old", "user", "d", "b"));

  const overview = await scanOverview(f.env, services);

  assert.deepEqual(overview.memoryCatalog, []);
  assert.equal(overview.projects.find((p) => p.path === services)?.memories, 0);
});

test("a store without memory adds no row for a parent folder", async () => {
  const f = makeFixture();
  const app = f.at("src/app");
  mkdirSync(app, { recursive: true });
  f.json("home/.claude.json", { projects: { [app]: {} } });
  // What a cleanup of old transcripts leaves: a session folder and no memory.
  mkdirSync(join(f.env.claudeDir, "projects", storeDirName(f.at("src")), "session-1"), {
    recursive: true,
  });

  const overview = await scanOverview(f.env, f.at("home"));

  assert.equal(
    overview.projects.find((p) => p.path === f.at("src")),
    undefined
  );
});
