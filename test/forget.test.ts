import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCore, listBackups, RefusedError, scanOverview } from "../src/core/index.ts";
import { storeDirName } from "../src/shared/memory.ts";
import { type Fixture, makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

/** A directory Claude Code was used in, with two sessions and one memory, whose folder is gone. */
function goneDirectory(f: Fixture, { inClaudeJson = true } = {}) {
  const dir = f.at("work/deleted-worktree");
  const store = join(f.env.claudeDir, "projects", storeDirName(dir));
  f.write(join(store, "a.jsonl"), `${JSON.stringify({ type: "user", cwd: dir })}\n`);
  f.write(join(store, "b.jsonl"), `${JSON.stringify({ type: "user", cwd: dir })}\n`);
  f.write(`${memoryDirFor(f, dir)}/note.md`, memoryFile("note", "user", "d", "body"));
  f.write(`${memoryDirFor(f, dir)}/MEMORY.md`, "- [note](note.md)\n");
  if (inClaudeJson)
    f.json("home/.claude.json", { projects: { [dir]: { hasTrustDialogAccepted: true } } });
  mkdirSync(f.at("launch"), { recursive: true });
  return { dir, store, launch: f.at("launch") };
}

const listed = async (f: Fixture, launch: string) =>
  (await scanOverview(f.env, launch)).projects.map((p) => p.path);

test("the review says what forgetting a gone directory moves away", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);

  const preview = await createCore(f.env).previewForget(dir, launch);

  assert.deepEqual(
    {
      store: preview.store,
      sessions: preview.sessions,
      memories: preview.memories,
      entry: preview.claudeJsonEntry,
    },
    { store, sessions: 2, memories: 1, entry: true }
  );
  assert.ok(preview.bytes > 0);
});

test("forgetting moves the store aside, leaves ~/.claude.json alone, and the directory is no longer listed", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  const claudeJson = readFileSync(f.env.claudeJson, "utf8");
  const core = createCore(f.env);
  assert.ok((await listed(f, launch)).includes(dir));

  const change = await core.forgetDirectory(
    dir,
    launch,
    (await core.previewForget(dir, launch)).revision
  );

  assert.equal(existsSync(store), false);
  assert.equal(readFileSync(f.env.claudeJson, "utf8"), claudeJson);
  assert.equal((await listed(f, launch)).includes(dir), false);
  const [recorded] = (await listBackups(f.env, { limit: 5 })).changes;
  assert.deepEqual(
    recorded && { id: recorded.id, kind: recorded.kind, projectPath: recorded.projectPath },
    { id: change.id, kind: "directory-forget", projectPath: dir }
  );
});

test("a store known only from its sessions is forgotten without ~/.claude.json", async () => {
  const f = makeFixture();
  const { dir, launch } = goneDirectory(f, { inClaudeJson: false });
  const core = createCore(f.env);

  const preview = await core.previewForget(dir, launch);
  await core.forgetDirectory(dir, launch, preview.revision);

  assert.equal(preview.claudeJsonEntry, false);
  assert.equal(existsSync(f.env.claudeJson), false);
  assert.equal((await listed(f, launch)).includes(dir), false);
});

test("restoring a forgotten directory moves its store back and lists it again", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  const core = createCore(f.env);
  const change = await core.forgetDirectory(
    dir,
    launch,
    (await core.previewForget(dir, launch)).revision
  );

  const restore = await core.previewRestore(change.id);
  await core.restoreBackup(change.id, restore.revision);

  assert.equal(restore.movesBack, store);
  assert.equal(restore.after, "2 sessions and 1 memory file\n");
  assert.ok(existsSync(join(store, "memory", "note.md")));
  const row = (await scanOverview(f.env, launch)).projects.find((p) => p.path === dir);
  assert.deepEqual(row && { sessions: row.sessions, memories: row.memories }, {
    sessions: 2,
    memories: 1,
  });
  assert.equal(
    (await core.previewRestore(change.id)).blocked,
    "This store was moved back already."
  );
});

test("a restore is refused while a new store of the same name exists", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  const core = createCore(f.env);
  const change = await core.forgetDirectory(
    dir,
    launch,
    (await core.previewForget(dir, launch)).revision
  );
  // Claude Code was used there again and made a new store.
  f.write(join(store, "c.jsonl"), "{}\n");

  const restore = await core.previewRestore(change.id);

  assert.match(restore.blocked ?? "", /exists again/);
  await assert.rejects(core.restoreBackup(change.id, restore.revision), RefusedError);
  assert.deepEqual(
    [existsSync(join(store, "c.jsonl")), existsSync(join(store, "a.jsonl"))],
    [true, false]
  );
});

test("a directory whose folder exists is never forgotten", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  mkdirSync(dir, { recursive: true });

  await assert.rejects(createCore(f.env).previewForget(dir, launch), RefusedError);
  assert.ok(existsSync(store));
});

test("the launch directory is never forgotten, even when its folder is gone", async () => {
  const f = makeFixture();
  const { dir, store } = goneDirectory(f);

  await assert.rejects(createCore(f.env).previewForget(dir, dir), RefusedError);
  assert.ok(existsSync(store));
});

test("a folder that came back after the review is not forgotten", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  const core = createCore(f.env);
  const { revision } = await core.previewForget(dir, launch);
  mkdirSync(dir, { recursive: true });

  await assert.rejects(core.forgetDirectory(dir, launch, revision), RefusedError);
  assert.ok(existsSync(store));
  assert.deepEqual((await listBackups(f.env, { limit: 5 })).changes, []);
});

test("a store that gained a session after the review is not forgotten", async () => {
  const f = makeFixture();
  const { dir, store, launch } = goneDirectory(f);
  const core = createCore(f.env);
  const { revision } = await core.previewForget(dir, launch);
  f.write(join(store, "c.jsonl"), "{}\n");

  await assert.rejects(core.forgetDirectory(dir, launch, revision), RefusedError);
  assert.ok(existsSync(join(store, "c.jsonl")));
});
