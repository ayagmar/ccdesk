import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDirectory } from "../src/server/scan/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

async function toolsFor(settings: Record<string, unknown>) {
  const f = makeFixture();
  f.json("home/.claude/settings.json", settings);
  f.write("app/README.md", "x");
  const view = await scanDirectory(f.env, f.at("app"));
  return Object.fromEntries(view.tools.map((t) => [t.name, t]));
}

test("a rule naming the whole tool decides it, deny before ask before allow", async () => {
  const tools = await toolsFor({
    permissions: { allow: ["WebFetch", "Bash"], ask: ["Bash(*)"], deny: ["WebFetch"] },
  });

  assert.equal(tools.WebFetch?.verdict, "denied");
  assert.equal(tools.Bash?.verdict, "asks", "Bash(*) is the whole tool");
  assert.equal(tools.Read?.verdict, "default");
  assert.equal(tools.Read?.asks, false);
  assert.equal(tools.Write?.asks, true);
});

test("deny and ask rules may glob the tool name; an unanchored allow glob approves nothing", async () => {
  const tools = await toolsFor({ permissions: { deny: ["Web*"], allow: ["Task*"] } });

  assert.equal(tools.WebSearch?.verdict, "denied");
  assert.equal(tools.WebFetch?.verdict, "denied");
  assert.equal(tools.TaskCreate?.verdict, "default");
});

test("rules for some uses are listed under the tools they cover, Edit paths under every editing tool", async () => {
  const tools = await toolsFor({
    permissions: { allow: ["Bash(npm test *)", "Edit(docs/**)"], deny: ["Read(./.env)"] },
  });

  assert.equal(tools.Bash?.verdict, "default");
  assert.deepEqual(
    tools.Bash?.scoped.map((r) => r.rule),
    ["Bash(npm test *)"]
  );
  assert.deepEqual(
    tools.Grep?.scoped.map((r) => r.rule),
    ["Read(./.env)"]
  );
  assert.deepEqual(
    tools.Monitor?.scoped.map((r) => r.rule),
    ["Bash(npm test *)"]
  );
  // A Read deny also blocks editing that path, but not NotebookEdit.
  assert.deepEqual(
    tools.Write?.scoped.map((r) => r.rule),
    ["Read(./.env)", "Edit(docs/**)"]
  );
  assert.deepEqual(
    tools.NotebookEdit?.scoped.map((r) => r.rule),
    ["Edit(docs/**)"]
  );
});

test("a path rule on Write is marked as one Claude Code never checks", async () => {
  const tools = await toolsFor({ permissions: { deny: ["Write(docs/**)"] } });

  assert.deepEqual(tools.Write?.scoped, [
    { list: "deny", rule: "Write(docs/**)", scope: "user", unchecked: true },
  ]);
  assert.deepEqual(tools.Edit?.scoped, []);
});

test("EndConversation is never blocked, asked for or hooked while other tools remain", async () => {
  const tools = await toolsFor({
    permissions: { deny: ["EndConversation"], ask: ["End*"] },
    hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "check" }] }] },
  });

  assert.equal(tools.EndConversation?.verdict, "default");
  assert.equal(tools.EndConversation?.hooks, 0);
});

test("EndConversation goes too when deny * removes every other tool, unless an allow rule names it", async () => {
  const denyAll = await toolsFor({ permissions: { deny: ["*"] } });
  const kept = await toolsFor({ permissions: { deny: ["*"], allow: ["EndConversation"] } });

  assert.equal(denyAll.EndConversation?.verdict, "denied");
  assert.equal(kept.EndConversation?.verdict, "default");
});

test("PreToolUse hooks count for the tools their matcher covers", async () => {
  const hook = (matcher: string) => ({ matcher, hooks: [{ type: "command", command: "check" }] });
  const tools = await toolsFor({
    hooks: { PreToolUse: [hook("Edit|Write"), hook("^Notebook"), hook("*")] },
  });

  assert.equal(tools.Write?.hooks, 2);
  assert.equal(tools.NotebookEdit?.hooks, 2);
  assert.equal(tools.Edit?.hooks, 2);
  assert.equal(tools.Bash?.hooks, 1);
});

test("a tool lists every deny rule that removes it, so turning it back on can remove them all", async () => {
  const tools = await toolsFor({
    permissions: { deny: ["WebFetch", "Web*", "Bash (*)", "Bash(rm *)"] },
  });

  assert.deepEqual(
    tools.WebFetch?.removedBy?.map((r) => r.rule),
    ["WebFetch", "Web*"]
  );
  assert.deepEqual(
    tools.Bash?.removedBy?.map((r) => r.rule),
    ["Bash (*)"],
    "a rule for some uses does not remove the tool"
  );
  assert.equal(tools.Read?.removedBy, undefined);
});
