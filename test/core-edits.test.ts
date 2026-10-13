import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { previewPermissionEdit, restoreBackup, savePermissionEdit } from "../src/core/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

// The review-then-save round trip through the core, where server.test.ts does not already make
// it: its routes pass each edit straight to the same functions, and it saves and undoes settings,
// agents, project MCP servers and memory. Hook and permission edits share one save and one kind
// of backup, so the permission round trip below stands for both.

// Laid out by hand, not as ccdesk writes JSON, so a save reformats it.
const HAND_WRITTEN = `{
    "permissions": { "allow": ["Read", "Bash(npm test:*)"] },
    "model": "opus"
}
`;

test("undoing a permission change puts back the file's own text, layout included", async () => {
  // Catches a restore that writes the backup re-serialized instead of the saved bytes.
  const f = makeFixture();
  const dir = f.at("app");
  const file = f.write("app/.claude/settings.json", HAND_WRITTEN);
  const edit = {
    dir,
    file,
    remove: { list: "allow" as const, rule: "Bash(npm test:*)" },
    add: { list: "deny" as const, rule: "Bash(npm test:*)" },
  };

  const { revision, reformats } = await previewPermissionEdit(f.env, edit);
  assert.equal(reformats, true);
  const change = await savePermissionEdit(f.env, edit, revision);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).permissions, {
    allow: ["Read"],
    deny: ["Bash(npm test:*)"],
  });

  await restoreBackup(f.env, change.id, change.revision);
  assert.equal(readFileSync(file, "utf8"), HAND_WRITTEN);
});

test("a settings file with a byte order mark can be edited, and undo puts the mark back", async () => {
  const f = makeFixture();
  const text = `\uFEFF${JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2)}\n`;
  const file = f.write("app/.claude/settings.json", text);
  const edit = { dir: f.at("app"), file, add: { list: "deny" as const, rule: "Bash(rm:*)" } };

  // Saving writes ccdesk's own layout, without the mark, so the preview says it reformats.
  const { revision, reformats } = await previewPermissionEdit(f.env, edit);
  assert.equal(reformats, true);
  const change = await savePermissionEdit(f.env, edit, revision);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).permissions.deny, ["Bash(rm:*)"]);

  await restoreBackup(f.env, change.id, change.revision);
  assert.equal(readFileSync(file, "utf8"), text);
});
