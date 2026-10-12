import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";
import { scanDirectory } from "../src/server/scan/index.ts";
import { makeFixture, memoryDirFor } from "./helpers/fixture.ts";

type View = Awaited<ReturnType<typeof scanDirectory>>;

function setting(view: View, key: string) {
  return view.effective.find((s) => s.key === key);
}

test("in a subdirectory, local settings come from the repository root and beat a legacy file left in the subdirectory", async () => {
  const f = makeFixture();
  f.write("repo/app/README.md", "x");
  f.git("repo", "init", "-q");
  f.json("repo/.claude/settings.local.json", { model: "opus" });
  f.json("repo/app/.claude/settings.local.json", { model: "haiku", theme: "dark" });

  const view = await scanDirectory(f.env, f.at("repo/app"));

  assert.equal(setting(view, "model")?.value, "opus");
  assert.equal(setting(view, "theme")?.value, "dark");
  const local = view.settings.filter((l) => l.scope === "local");
  assert.deepEqual(
    local.map((l) => [l.path, l.legacy ?? false]),
    [
      [f.at("repo/.claude/settings.local.json"), false],
      [f.at("repo/app/.claude/settings.local.json"), true],
    ]
  );
});

test("managed drop-ins are merged after managed-settings.json, in name order", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", { model: "sonnet", theme: "light" });
  f.json("etc/claude-code/managed-settings.d/20-model.json", { model: "opus" });
  f.json("etc/claude-code/managed-settings.d/10-theme.json", { theme: "dark", model: "haiku" });
  f.json("etc/claude-code/managed-settings.d/.hidden.json", { model: "ignored" });
  f.write("etc/claude-code/managed-settings.d/notes.txt", "{}");
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(setting(view, "model")?.value, "opus");
  assert.equal(setting(view, "theme")?.value, "dark");
});

test("managed availableModels replaces the list instead of adding your entries", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", { availableModels: ["sonnet"] });
  f.json("home/.claude/settings.json", { availableModels: ["opus"] });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(setting(view, "availableModels")?.value, ["sonnet"]);
});

test("a key set in a file Claude Code does not read it from is shown as ignored", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", { modelPicker: { hidden: ["haiku"] } });

  const view = await scanDirectory(f.env, f.at("app"));

  const picker = setting(view, "modelPicker");
  assert.deepEqual(picker?.from, []);
  assert.equal(picker?.ignored[0]?.scope, "project");
});

test("project skills are found in every folder from the repository root down, and point at SKILL.md", async () => {
  const f = makeFixture();
  f.write(
    "repo/.claude/skills/release/SKILL.md",
    "---\nname: release\ndescription: Cut a release\n---\n"
  );
  f.write("repo/pkg/.claude/skills/lint/SKILL.md", "---\nname: lint\ndescription: Lint it\n---\n");
  f.write("outside/.claude/skills/stray/SKILL.md", "---\nname: stray\ndescription: no\n---\n");
  f.git("repo", "init", "-q");

  const view = await scanDirectory(f.env, f.at("repo/pkg"));

  const skills = view.inventory.skills.filter((s) => s.scope === "project");
  assert.deepEqual(skills.map((s) => [s.name, s.path]).sort(), [
    ["lint", f.at("repo/pkg/.claude/skills/lint/SKILL.md")],
    ["release", f.at("repo/.claude/skills/release/SKILL.md")],
  ]);
});

test("disableAllHooks outside managed settings stops every hook except managed ones", async () => {
  const f = makeFixture();
  const hook = (command: string) => ({
    hooks: { Stop: [{ hooks: [{ type: "command", command }] }] },
  });
  f.json("etc/claude-code/managed-settings.json", hook("audit"));
  f.json("home/.claude/settings.json", { ...hook("notify"), disableAllHooks: true });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.inventory.hooks.map((h) => [h.command, h.active]),
    [
      ["audit", true],
      ["notify", false],
    ]
  );
});

test("an http hook's URL is shown without its user name, password or query", async () => {
  const f = makeFixture();
  const url = "https://bot:hunter2@hooks.example.com/stop?token=abc123";
  f.json("home/.claude/settings.json", {
    hooks: { Stop: [{ hooks: [{ type: "http", url }] }] },
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.inventory.hooks[0]?.command, "https://•••@hooks.example.com/stop?•••");
  assert.doesNotMatch(JSON.stringify(view), /hunter2|abc123/);
});

test(".mcp.json servers wait for approval, and a server defined twice uses the closer definition", async () => {
  const f = makeFixture();
  f.json("app/.mcp.json", {
    mcpServers: { docs: { command: "docs-mcp" }, db: { command: "db-mcp" } },
  });
  f.json("app/.claude/settings.json", { enabledMcpjsonServers: ["db"] });
  f.json("home/.claude.json", { mcpServers: { docs: { command: "my-docs" } } });

  const untrusted = await scanDirectory(f.env, f.at("app"));
  const status = (view: View) =>
    Object.fromEntries(view.inventory.mcpServers.map((s) => [`${s.scope}:${s.name}`, s.status]));
  // The repository's own approval does not count before you trust the folder.
  assert.deepEqual(status(untrusted), {
    "project:docs": "pending",
    "project:db": "pending",
    "user:docs": "shadowed",
  });

  f.json("home/.claude.json", {
    mcpServers: { docs: { command: "my-docs" } },
    projects: { [f.at("app")]: { hasTrustDialogAccepted: true } },
  });
  const trusted = await scanDirectory(f.env, f.at("app"));
  assert.equal(status(trusted)["project:db"], "active");
});

test("project allow rules wait for the trust dialog; deny rules apply at once", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", {
    permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"] },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  const rules = view.permissions.filter((p) => p.kind === "rule");
  assert.deepEqual(
    rules.map((p) => [p.kind === "rule" ? p.rule : "", p.inEffect]),
    [
      ["Read(.env)", true],
      ["Bash(npm test)", false],
    ]
  );
  assert.equal(view.trust.trusted, false);
});

test("plugin subagents are named with their plugin and subfolder, so two of one name stay apart", async () => {
  const f = makeFixture();
  const install = (name: string) => [
    { scope: "user", installPath: f.at(`plugins/${name}`), version: "1.0.0" },
  ];
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "alpha@market": install("alpha"), "beta@market": install("beta") },
  });
  for (const name of ["alpha", "beta"]) {
    f.json(`plugins/${name}/.claude-plugin/plugin.json`, { name });
    f.write(
      `plugins/${name}/agents/review/security.md`,
      "---\nname: security\ndescription: s\n---\n"
    );
  }
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(view.inventory.agents.map((a) => a.id).sort(), [
    "alpha:review:security",
    "beta:review:security",
  ]);
});

test("a plugin without an enabledPlugins entry follows its own default", async () => {
  const f = makeFixture();
  const install = (name: string) => [
    { scope: "user", installPath: f.at(`plugins/${name}`), version: "1.0.0" },
  ];
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "on@market": install("on"), "off@market": install("off") },
  });
  f.json("plugins/on/.claude-plugin/plugin.json", { name: "on" });
  f.json("plugins/off/.claude-plugin/plugin.json", { name: "off", defaultEnabled: false });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.inventory.plugins.map((p) => [p.id, p.enabled]),
    [
      ["on@market", true],
      ["off@market", false],
    ]
  );
});

test("autoMemoryDirectory moves the store; from repository settings it waits for trust and is off while outside reads are blocked", async () => {
  const f = makeFixture();
  f.write("home/notes/memory/MEMORY.md", "- [a](a.md) — note\n");
  f.json("home/.claude/settings.json", { autoMemoryDirectory: "~/notes/memory" });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));
  assert.equal(view.memory?.dir, f.at("home/notes/memory"));
  assert.equal(view.memory?.loaded, true);
  assert.equal(view.memory?.custom, true);

  f.json("home/.claude/settings.json", {});
  f.json("app/.claude/settings.json", { autoMemoryDirectory: "~/notes/memory" });
  const untrusted = await scanDirectory(f.env, f.at("app"));
  assert.equal(untrusted.memory?.dir, memoryDirFor(f, f.at("app")));
  assert.match(untrusted.memory?.note ?? "", /trust/);

  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  const fromRepo = await scanDirectory(f.env, f.at("app"));
  assert.equal(fromRepo.memory?.dir, f.at("home/notes/memory"));
  assert.equal(fromRepo.memory?.loaded, true);

  f.json("home/.claude/settings.json", {
    permissions: { blockReadsOutsideWorkingDirectories: true },
  });
  const blocked = await scanDirectory(f.env, f.at("app"));
  assert.equal(blocked.memory?.loaded, false);
});

test("CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 keeps memory on even when settings turn it off", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { autoMemoryEnabled: false });
  f.write(`${memoryDirFor(f, f.at("app"))}/MEMORY.md`, "- [a](a.md) — note\n");

  const view = await scanDirectory({ ...f.env, disableAutoMemory: "0" }, f.at("app"));

  assert.equal(view.memory?.loaded, true);
});

test("a rules folder that links back to itself is read once, not forever", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/style.md", "Early returns.\n");
  f.link("app/.claude/rules/loop", f.at("app/.claude/rules"));

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.instructions.filter((i) => i.path.endsWith("style.md")).length, 1);
});

test("a broken .mcp.json is reported as a problem", async () => {
  const f = makeFixture();
  f.write("app/.mcp.json", "{ nope");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.problems.map((p) => p.path),
    [f.at("app/.mcp.json")]
  );
});

test("a project's disableAllHooks false overrides a user true", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    disableAllHooks: true,
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] },
  });
  f.json("app/.claude/settings.json", { disableAllHooks: false });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.inventory.hooks[0]?.active, true);
});

test("MCP policy: denied servers are blocked, an allowlist blocks the rest, managed-mcp.json takes over", async () => {
  const f = makeFixture();
  f.json("home/.claude.json", {
    mcpServers: {
      github: { type: "http", url: "https://api.github.example/mcp" },
      notes: { command: "notes-mcp" },
      shell: { command: "shell-mcp" },
    },
  });
  f.json("etc/claude-code/managed-settings.json", {
    allowedMcpServers: [{ serverUrl: "https://*.github.example/*" }, { serverName: "shell" }],
    deniedMcpServers: [{ serverName: "shell" }],
  });
  f.write("app/README.md", "x");
  const status = (view: View) =>
    Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.status]));

  assert.deepEqual(status(await scanDirectory(f.env, f.at("app"))), {
    github: "active",
    notes: "blocked",
    shell: "blocked",
  });

  f.json("etc/claude-code/managed-mcp.json", { mcpServers: { corp: { command: "corp-mcp" } } });
  const exclusive = status(await scanDirectory(f.env, f.at("app")));
  assert.equal(exclusive.corp, "active");
  assert.equal(exclusive.github, "blocked");
});

test("a rules folder linked from outside the project waits for the external-imports approval", async () => {
  const f = makeFixture();
  f.write("shared-rules/style.md", "Early returns.\n");
  f.write("shared-rules/api.md", '---\npaths: ["src/**"]\n---\nValidate.\n');
  f.link("app/.claude/rules/shared", f.at("shared-rules"));
  const status = (view: View) =>
    Object.fromEntries(
      view.instructions.filter((i) => i.kind === "rule").map((i) => [basename(i.path), i.status])
    );

  assert.deepEqual(status(await scanDirectory(f.env, f.at("app"))), {
    "api.md": "skipped",
    "style.md": "skipped",
  });

  f.json("home/.claude.json", {
    projects: { [f.at("app")]: { hasClaudeMdExternalIncludesApproved: true } },
  });
  // Once approved, only the linked rules without a paths field load.
  assert.deepEqual(status(await scanDirectory(f.env, f.at("app"))), {
    "api.md": "skipped",
    "style.md": "loaded",
  });
});

test("a worktree is trusted when you trusted the main checkout", async () => {
  const f = makeFixture();
  f.write("repo/README.md", "hi");
  f.git("repo", "init", "-q");
  f.git("repo", "add", ".");
  f.git("repo", "commit", "-qm", "init");
  f.git("repo", "worktree", "add", "-q", f.at("repo-feature"));
  f.json("home/.claude.json", { projects: { [f.at("repo")]: { hasTrustDialogAccepted: true } } });

  const view = await scanDirectory(f.env, f.at("repo-feature"));

  assert.equal(view.trust.trusted, true);
  assert.equal(view.trust.root, f.at("repo"));
});

test("managedMcpServers entries Claude Code would drop are shown as invalid", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", {
    managedMcpServers: {
      records: { type: "http", url: "https://records.example.com/mcp" },
      local: { type: "http", url: "http://localhost:8080/mcp" },
      runner: { type: "http", url: "https://x.example.com", command: "run-me" },
      variable: {
        type: "http",
        url: "https://v.example.com/mcp",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} reference is the case under test.
        headers: { Authorization: "Bearer ${TOKEN}" },
      },
      hidden: { type: "http", url: "https://h.example.com/mcp\u200b" },
    },
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.status])), {
    records: "active",
    local: "invalid",
    runner: "invalid",
    variable: "invalid",
    hidden: "invalid",
  });
});

test("an approval in settings.local.json waits until the folder is trusted", async () => {
  const f = makeFixture();
  f.json("app/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  f.json("app/.claude/settings.local.json", { enabledMcpjsonServers: ["docs"] });
  const status = async () =>
    (await scanDirectory(f.env, f.at("app"))).inventory.mcpServers.find((s) => s.name === "docs")
      ?.status;

  assert.equal(await status(), "pending");

  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  assert.equal(await status(), "active");
});
