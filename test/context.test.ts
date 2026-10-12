import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildContext } from "../src/server/scan/context.ts";
import { scanDirectory } from "../src/server/scan/index.ts";
import { type ContextBlock } from "../src/shared/types.ts";
import { makeFixture, memoryDirFor } from "./helpers/fixture.ts";

/** The blocks ccdesk can measure, leaving out rows it lists without a size. */
function counted(context: ContextBlock[]): ContextBlock[] {
  return context.filter((b) => b.kind !== "not-counted");
}

test("what Claude sees at start leaves out path rules and reads only the loaded part of MEMORY.md", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "Use pnpm.\n@docs/style.md\n");
  f.write("app/docs/style.md", "Two spaces.\n");
  f.write("app/.claude/rules/api.md", '---\npaths: ["src/api/**"]\n---\nValidate input.\n');
  const index = Array.from({ length: 230 }, (_, i) => `- [m${i}](m${i}.md) — note`);
  f.write(`${memoryDirFor(f, f.at("app"))}/MEMORY.md`, index.join("\n"));

  const view = await scanDirectory(f.env, f.at("app"));

  const blocks = counted(view.context);
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.path]),
    [
      ["import", f.at("app/docs/style.md")],
      ["instruction", f.at("app/CLAUDE.md")],
      ["memory-index", join(memoryDirFor(f, f.at("app")), "MEMORY.md")],
    ]
  );
  assert.equal(blocks[0]?.text, "Two spaces.\n");
  const memory = blocks[2];
  assert.equal(memory?.lines, 200);
  assert.equal(memory?.text?.split("\n").length, 200);
});

test("a rule that CLAUDE.md also imports is counted once", async () => {
  const f = makeFixture();
  f.write("home/.claude/rules/style.md", "Early returns.\n");
  f.write("home/.claude/CLAUDE.md", "@~/.claude/rules/style.md\n");
  f.write("home/work/app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("home/work/app"));

  assert.deepEqual(
    counted(view.context).map((b) => [b.kind, b.path]),
    [
      ["instruction", f.at("home/.claude/CLAUDE.md")],
      ["instruction", f.at("home/.claude/rules/style.md")],
    ]
  );
});

test("a linked rule that CLAUDE.md imports by its target's path is counted once", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/shared.md\n");
  const target = f.write("app/docs/shared.md", "Shared rules.\n");
  f.link("app/.claude/rules/shared.md", target);

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    counted(view.context).map((b) => [b.kind, b.path]),
    [
      ["instruction", f.at("app/CLAUDE.md")],
      ["instruction", f.at("app/.claude/rules/shared.md")],
    ]
  );
});

test("a linked rule is counted once by the target the scan read, even if the link changed since", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/shared.md\n");
  const target = f.write("app/docs/shared.md", "Shared rules.\n");
  f.write("app/docs/other.md", "Other rules.\n");
  f.link("app/.claude/rules/shared.md", target);
  const view = await scanDirectory(f.env, f.at("app"));

  rmSync(f.at("app/.claude/rules/shared.md"));
  f.link("app/.claude/rules/shared.md", f.at("app/docs/other.md"));
  const context = await buildContext({ ...view, env: f.env, projectRoot: f.at("app") });

  assert.deepEqual(
    counted(context).map((b) => [b.kind, b.path]),
    [
      ["instruction", f.at("app/CLAUDE.md")],
      ["instruction", f.at("app/.claude/rules/shared.md")],
    ]
  );
});

test("a rule in a linked rules folder that CLAUDE.md imports by its real path is counted once", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@docs/shared.md\n");
  f.write("app/docs/shared.md", "Shared rules.\n");
  f.link("app/.claude/rules/shared", f.at("app/docs"));

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    counted(view.context).map((b) => [b.kind, b.path]),
    [
      ["instruction", f.at("app/CLAUDE.md")],
      ["instruction", f.at("app/.claude/rules/shared/shared.md")],
    ]
  );
});

test("context counts what Claude Code injects: no frontmatter, no HTML comments, and the skill and subagent listings", async () => {
  const f = makeFixture();
  f.write("home/.claude/CLAUDE.md", "<!-- maintainer note -->\nUse pnpm.\n");
  f.write(
    "home/.claude/skills/deploy/SKILL.md",
    "---\nname: deploy\ndescription: Ship the app\n---\nLong body that only loads when used.\n"
  );
  f.write(
    "home/.claude/skills/manual/SKILL.md",
    "---\nname: manual\ndescription: Only by hand\ndisable-model-invocation: true\n---\nx\n"
  );
  f.write(
    "home/.claude/agents/reviewer.md",
    "---\nname: reviewer\ndescription: Reviews diffs\n---\nPrompt.\n"
  );
  f.write("home/work/app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("home/work/app"));

  const byKind = (kind: ContextBlock["kind"]) => view.context.find((b) => b.kind === kind)?.text;
  assert.equal(byKind("instruction"), "Use pnpm.\n");
  assert.equal(byKind("skills"), "- deploy: Ship the app");
  assert.equal(byKind("agents"), "- reviewer: Reviews diffs");
});

test("an import from outside the project waits for approval and is not counted", async () => {
  const f = makeFixture();
  f.write("home/.claude/shared.md", "shared rules\n");
  f.write("home/work/app/CLAUDE.md", "@~/.claude/shared.md\n");

  const view = await scanDirectory(f.env, f.at("home/work/app"));

  const imported = view.context.find((b) => b.kind === "import");
  assert.equal(imported?.text, null);
  assert.equal(imported?.bytes, 0);
  assert.match(imported?.note ?? "", /approve/);
});

test("with auto memory turned off, MEMORY.md is not part of what Claude sees", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { autoMemoryEnabled: false });
  f.write(`${memoryDirFor(f, f.at("app"))}/MEMORY.md`, "- [a](a.md) — note\n");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.memory?.loaded, false);
  assert.equal(
    view.context.find((b) => b.kind === "memory-index"),
    undefined
  );
});

test("project files that shape Claude are grouped by whether the repository shares them", async () => {
  const f = makeFixture();
  f.write("repo/.gitignore", ".claude/settings.local.json\n");
  f.write("repo/CLAUDE.md", "shared\n");
  f.json("repo/.claude/settings.json", { model: "opus" });
  f.json("repo/.claude/settings.local.json", { model: "haiku" });
  f.write("repo/.mcp.json", "{}");
  f.git("repo", "init", "-q");
  f.git("repo", "add", "CLAUDE.md", ".gitignore", ".claude/settings.json");

  const view = await scanDirectory(f.env, f.at("repo"));

  assert.deepEqual(view.sharing, {
    tracked: ["CLAUDE.md", ".claude/settings.json"],
    untracked: [".mcp.json"],
    ignored: [".claude/settings.local.json"],
  });
});

test("outside a git repository there is nothing shared", async () => {
  const f = makeFixture();
  f.write("plain/CLAUDE.md", "x\n");

  const view = await scanDirectory(f.env, f.at("plain"));

  assert.equal(view.sharing, null);
});

test("subagents come from every .claude/agents up to the repository root, the closest definition winning", async () => {
  const f = makeFixture();
  f.git("", "init", "-q", f.at("repo"));
  const agent = (description: string) => `---\nname: reviewer\ndescription: ${description}\n---\n`;
  f.write("repo/.claude/agents/reviewer.md", agent("Root reviewer"));
  f.write("repo/pkg/.claude/agents/reviewer.md", agent("Package reviewer"));
  f.write("home/.claude/agents/reviewer.md", agent("My reviewer"));

  const view = await scanDirectory(f.env, f.at("repo/pkg"));

  const listing = view.context.find((b) => b.kind === "agents");
  assert.equal(listing?.text, "- reviewer: Package reviewer");
  assert.equal(view.inventory.agents.filter((a) => a.shadowedBy).length, 2);
});

test("skillOverrides hide a skill or command from Claude's listing, or list it by name only", async () => {
  const f = makeFixture();
  const skill = (name: string) => `---\nname: ${name}\ndescription: About ${name}\n---\n`;
  f.write("home/.claude/skills/deploy/SKILL.md", skill("deploy"));
  f.write("home/.claude/skills/legacy/SKILL.md", skill("legacy"));
  f.write("home/.claude/commands/review.md", "---\ndescription: Review the diff\n---\n");
  f.write("home/.claude/commands/lint.md", "---\ndescription: Lint\n---\n");
  f.json("home/.claude/settings.json", {
    skillOverrides: { deploy: "off", legacy: "name-only", lint: "user-invocable-only" },
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(
    view.context.find((b) => b.kind === "skills")?.text,
    "- legacy\n- review: Review the diff"
  );
});

test("the skill listing names plugin skills and commands with their plugin, and leaves out a command a skill replaces", async () => {
  const f = makeFixture();
  const skill = (name: string | null, description: string) =>
    `---\n${name ? `name: ${name}\n` : ""}description: ${description}\n---\n`;
  const install = (name: string) => [
    { scope: "user", installPath: f.at(`plugins/${name}`), version: "1.0.0" },
  ];
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "tools@market": install("tools"), "solo@market": install("solo") },
  });
  // Components take the manifest's name, not the name the plugin is enabled under.
  f.json("plugins/tools/.claude-plugin/plugin.json", { name: "kit" });
  f.write("plugins/tools/skills/review/SKILL.md", skill(null, "Plugin review"));
  f.write("plugins/tools/skills/other/SKILL.md", skill("kit:fancy", "Already prefixed"));
  f.write("plugins/tools/commands/lint.md", "---\ndescription: Plugin lint\n---\n");
  f.json("plugins/solo/.claude-plugin/plugin.json", { name: "solo" });
  f.write("plugins/solo/SKILL.md", skill(null, "The only skill"));
  f.write("home/.claude/skills/review/SKILL.md", skill("review", "My review"));
  f.write("home/.claude/commands/review.md", "---\ndescription: Old review command\n---\n");
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.context
      .find((b) => b.kind === "skills")
      ?.text?.split("\n")
      .sort(),
    [
      "- kit:fancy: Already prefixed",
      "- kit:lint: Plugin lint",
      "- kit:review: Plugin review",
      "- review: My review",
      "- solo:solo: The only skill",
    ]
  );
});

test("an output style is found in the managed folder and in the repository root above the start directory", async () => {
  const f = makeFixture();
  f.write("repo/app/README.md", "x");
  f.git("repo", "init", "-q");
  f.write("repo/.claude/output-styles/terse.md", "---\nname: terse\n---\nAnswer briefly.\n");
  f.write("etc/claude-code/.claude/output-styles/policy.md", "---\nname: policy\n---\nCite.\n");
  f.json("home/.claude/settings.json", { outputStyle: "terse" });

  const view = await scanDirectory(f.env, f.at("repo/app"));

  assert.deepEqual(
    view.inventory.outputStyles.map((s) => [s.scope, s.name]),
    [
      ["managed", "policy"],
      ["project", "terse"],
    ]
  );
  const style = view.context.find((b) => b.kind === "output-style");
  assert.equal(style?.text, "Answer briefly.\n");
});
