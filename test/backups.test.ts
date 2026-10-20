import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCore, listBackups, revisionOf, StaleError } from "../src/core/index.ts";
import { recordChange, writeAtomic } from "../src/core/write.ts";
import { type Fixture, makeFixture } from "./helpers/fixture.ts";

async function denyRule(f: Fixture, rule: string): Promise<void> {
  const edit = {
    dir: f.at("app"),
    file: f.at("app/.claude/settings.json"),
    add: { list: "deny" as const, rule },
  };
  const core = createCore(f.env);
  await core.savePermissionEdit(edit, (await core.previewPermissionEdit(edit)).revision);
}

test("a file changed while ccdesk writes it is kept, and the change leaves no backup", async () => {
  // Another editor, or Claude, saves the file after the revision check and before the rename.
  const f = makeFixture();
  const before = `${JSON.stringify({ model: "opus" }, null, 2)}\n`;
  const file = f.write("app/.claude/settings.json", before);
  const elsewhere = `${JSON.stringify({ model: "haiku" }, null, 2)}\n`;
  const ours = `${JSON.stringify({ model: "sonnet" }, null, 2)}\n`;

  await assert.rejects(
    recordChange(f.env, { kind: "settings", target: file, before }, async () => {
      writeFileSync(file, elsewhere);
      await writeAtomic(f.env, file, ours, revisionOf(before));
      return { revision: revisionOf(ours) };
    }),
    StaleError
  );

  assert.equal(readFileSync(file, "utf8"), elsewhere);
  assert.deepEqual((await listBackups(f.env, { limit: 10 })).changes, []);
});

test("recent changes come a page at a time, newest first, and the last page says so", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", {});
  for (const rule of ["Bash(rm:*)", "Bash(curl:*)", "Bash(wget:*)"]) await denyRule(f, rule);

  const first = await listBackups(f.env, { limit: 2 });
  const last = first.changes.at(-1);
  assert.ok(last);
  const second = await listBackups(f.env, { before: last.id, limit: 2 });

  assert.equal(first.changes.length, 2);
  assert.equal(first.more, true);
  assert.equal(second.changes.length, 1);
  assert.equal(second.more, false);
  const ids = [...first.changes, ...second.changes].map((c) => c.id);
  assert.deepEqual(ids, [...new Set(ids)].sort().reverse());
});

test("a backup folder ccdesk cannot read is an error, not an empty list", {
  // Root reads any folder, and Windows ignores the mode bits that make a folder unreadable.
  skip: process.getuid?.() === 0 || process.platform === "win32",
}, async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", {});
  await denyRule(f, "Bash(rm:*)");
  const root = join(f.env.claudeDir, "backups", "ccdesk");
  chmodSync(root, 0o000);

  try {
    await assert.rejects(listBackups(f.env, { limit: 10 }), { code: "EACCES" });
  } finally {
    chmodSync(root, 0o700);
  }
});

test("a change shows the file before it and right after it, even after later changes", async () => {
  // Catches the after side read from the file as it is now, which would fold later changes into
  // an earlier one.
  const f = makeFixture();
  f.json("app/.claude/settings.json", {});
  await denyRule(f, "Bash(rm:*)");
  await denyRule(f, "Bash(curl:*)");
  const core = createCore(f.env);
  const [second, first] = (await listBackups(f.env, { limit: 10 })).changes;
  assert.ok(first && second);

  const one = await core.showChange(first.id);
  assert.ok(!one.before?.includes("Bash(rm:*)"));
  assert.ok(one.after?.includes("Bash(rm:*)"));
  assert.ok(!one.after?.includes("Bash(curl:*)"), one.after ?? "");

  const two = await core.showChange(second.id);
  assert.ok(two.before?.includes("Bash(rm:*)"));
  assert.ok(two.after?.includes("Bash(curl:*)"));
});

test("a change to a file edited outside ccdesk since has no after side to show", async () => {
  // Catches a hand edit presented as part of what ccdesk wrote.
  const f = makeFixture();
  f.json("app/.claude/settings.json", {});
  await denyRule(f, "Bash(rm:*)");
  f.json("app/.claude/settings.json", { model: "opus" });
  const [change] = (await listBackups(f.env, { limit: 1 })).changes;
  assert.ok(change);

  const view = await createCore(f.env).showChange(change.id);

  assert.equal(view.after, undefined);
  assert.ok(view.before !== null);
});

test("a change shows a file it created as new, and env values in a backup stay hidden", async () => {
  // Catches a secret from a backup reaching the page, and a created file shown as an edit.
  const f = makeFixture();
  f.write("app/README.md", "An app.\n");
  await denyRule(f, "Bash(rm:*)");
  f.json("app/.claude/settings.json", {
    env: { API_TOKEN: "secret-123" },
    permissions: { deny: ["Bash(rm:*)"] },
  });
  await denyRule(f, "Bash(curl:*)");
  const core = createCore(f.env);
  const [edited, created] = (await listBackups(f.env, { limit: 10 })).changes;
  assert.ok(edited && created);

  const made = await core.showChange(created.id);
  assert.equal(made.before, null);
  assert.equal(made.after, undefined, "the file was rewritten by hand after it was created");

  const view = await core.showChange(edited.id);
  assert.ok(view.before?.includes("API_TOKEN"), view.before ?? "");
  assert.ok(view.after?.includes("Bash(curl:*)"), view.after ?? "");
  assert.ok(!JSON.stringify(view).includes("secret-123"));
});
