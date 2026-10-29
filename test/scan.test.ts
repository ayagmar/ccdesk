import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import { scanDirectory, scanOverview } from "../src/core/index.ts";
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
  f.json("app/.claude/settings.json", { modelPicker: { options: [{ model: "haiku" }] } });

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
  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
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

test("a server Claude Code cannot start is marked invalid, with what it lacks", async () => {
  const f = makeFixture();
  f.json("home/.claude.json", {
    mcpServers: {
      local: { type: "stdio" },
      remote: { url: "https://mcp.example/api" },
      fine: { command: "fine-mcp" },
      socket: {
        type: "ws",
        url: "wss://mcp.example/socket",
        headersHelper: "./token.sh",
        alwaysLoad: true,
      },
      oauth: { type: "streamable-http", url: "https://mcp.example", oauth: { callbackPort: 8080 } },
      flags: { command: "x-mcp", args: "--verbose", env: { PORT: 8080 } },
      unknown: { type: "websocket", url: "wss://mcp.example" },
      host: { type: "sdk" },
    },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  const notes = Object.fromEntries(
    view.inventory.mcpServers.map((s) => [s.name, [s.status, s.note ?? null]])
  );
  assert.deepEqual(notes.local, ["invalid", 'A stdio server needs a "command".']);
  assert.equal(notes.remote?.[0], "invalid");
  assert.deepEqual(notes.fine, ["active", null]);
  assert.deepEqual(notes.socket, ["active", null]);
  assert.deepEqual(notes.oauth, ["active", null]);
  assert.deepEqual(notes.flags, ["invalid", "args must be array"]);
  assert.match(
    notes.unknown?.[1] ?? "",
    /^type must be equal to one of the allowed values: stdio, http/
  );
  assert.match(notes.host?.[1] ?? "", /Only an SDK host application/);
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

test("answering the .mcp.json prompt with use all servers starts every server from it", async () => {
  const f = makeFixture();
  f.json("app/.mcp.json", {
    mcpServers: { docs: { command: "docs-mcp" }, db: { command: "db-mcp" } },
  });
  f.json("home/.claude.json", {
    projects: {
      [f.at("app")]: { hasTrustDialogAccepted: true, enableAllProjectMcpServers: true },
    },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.inventory.mcpServers.map((s) => s.status),
    ["active", "active"]
  );
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

test("CLAUDE_CODE_PLUGIN_CACHE_DIR moves the plugins root, and a marketplace entry's defaultEnabled beats the manifest's", async () => {
  const f = makeFixture();
  const env = { ...f.env, pluginsDir: f.at("plugin-root") };
  const install = (name: string) => [{ scope: "user", installPath: f.at(`plugins/${name}`) }];
  f.json("plugin-root/installed_plugins.json", {
    plugins: { "quiet@market": install("quiet"), "loud@market": install("loud") },
  });
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "stale@market": install("stale") },
  });
  f.json("plugin-root/known_marketplaces.json", {
    market: {
      source: { source: "directory", path: f.at("market") },
      installLocation: f.at("market"),
    },
  });
  f.json("market/.claude-plugin/marketplace.json", {
    name: "market",
    plugins: [
      { name: "quiet", source: "./quiet", defaultEnabled: false },
      { name: "loud", source: "./loud" },
    ],
  });
  f.json("plugins/quiet/.claude-plugin/plugin.json", { name: "quiet", defaultEnabled: true });
  f.json("plugins/loud/.claude-plugin/plugin.json", { name: "loud" });
  f.write("app/README.md", "x");

  const view = await scanDirectory(env, f.at("app"));

  assert.deepEqual(
    view.inventory.plugins.map((p) => [p.id, p.enabled]),
    [
      ["quiet@market", false],
      ["loud@market", true],
    ]
  );
});

test("a skill folder with a plugin manifest loads as <name>@skills-dir, a project one only once the folder is trusted", async () => {
  const f = makeFixture();
  const plugin = (dir: string, name: string, extra: Record<string, unknown> = {}) => {
    f.json(`${dir}/.claude-plugin/plugin.json`, { name, ...extra });
    f.write(`${dir}/SKILL.md`, `---\ndescription: ${name} skill\n---\n`);
    f.write(`${dir}/agents/helper.md`, "---\nname: helper\ndescription: h\n---\n");
  };
  plugin("home/.claude/skills/tools", "tools");
  plugin("home/.claude/skills/later", "later", { defaultEnabled: false });
  plugin("app/.claude/skills/shared", "shared");
  plugin("app/.claude/skills/tools-copy", "tools");
  f.json("app/.claude/skills/shared/.mcp.json", {
    mcpServers: { db: { command: "db-server" } },
  });
  f.json("home/.claude/settings.json", { enabledPlugins: { "later@skills-dir": true } });
  f.write("app/README.md", "x");

  const untrusted = await scanDirectory(f.env, f.at("app"));
  const plugins = (view: View) => view.inventory.plugins.map((p) => [p.id, p.scope, p.enabled]);
  assert.deepEqual(plugins(untrusted), [
    ["later@skills-dir", "user", true],
    ["tools@skills-dir", "user", true],
    ["shared@skills-dir", "project", false],
    ["tools@skills-dir", "project", false],
  ]);
  assert.deepEqual(untrusted.inventory.agents.map((a) => a.id).sort(), [
    "later:helper",
    "tools:helper",
  ]);
  // The root SKILL.md stays a skill of its folder, not a plugin skill.
  assert.deepEqual(untrusted.inventory.skills.map((s) => [s.name, s.scope]).sort(), [
    ["later", "user"],
    ["shared", "project"],
    ["tools", "user"],
    ["tools-copy", "project"],
  ]);

  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  const trusted = await scanDirectory(f.env, f.at("app"));
  assert.deepEqual(plugins(trusted).slice(2), [
    ["shared@skills-dir", "project", true],
    // The copy in your own skills folder keeps the name.
    ["tools@skills-dir", "project", false],
  ]);
  // Its servers wait for the same approval as the project's .mcp.json.
  assert.deepEqual(
    trusted.inventory.mcpServers.map((s) => [s.name, s.status]),
    [["plugin:shared:db", "pending"]]
  );
});

test("turning a skills-dir plugin off in settings also skips the SKILL.md in its folder", async () => {
  const f = makeFixture();
  f.json("home/.claude/skills/tools/.claude-plugin/plugin.json", { name: "tools" });
  f.write("home/.claude/skills/tools/SKILL.md", "---\ndescription: tool belt\n---\n");
  f.write("app/README.md", "x");
  const scan = async (enabled: boolean) => {
    f.json("home/.claude/settings.json", { enabledPlugins: { "tools@skills-dir": enabled } });
    const view = await scanDirectory(f.env, f.at("app"));
    return {
      plugin: view.inventory.plugins.find((p) => p.id === "tools@skills-dir")?.enabled,
      skill: view.inventory.skills.find((s) => s.name === "tools")?.skipped !== undefined,
      listed: /tool belt/.test(view.context.find((b) => b.kind === "skills")?.text ?? ""),
    };
  };

  assert.deepEqual(await scan(false), { plugin: false, skill: true, listed: false });
  assert.deepEqual(await scan(true), { plugin: true, skill: false, listed: true });
});

test("an installed plugin, a plugin-only lock or a marketplace allowlist keeps a skills-dir plugin from loading", async () => {
  const f = makeFixture();
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "tools@market": [{ scope: "user", installPath: f.at("plugins/tools") }] },
  });
  f.json("plugins/tools/.claude-plugin/plugin.json", { name: "tools" });
  f.json("home/.claude/skills/tools/.claude-plugin/plugin.json", { name: "tools" });
  f.json("home/.claude/skills/extra/.claude-plugin/plugin.json", { name: "extra" });
  f.write("app/README.md", "x");
  const loaded = async () =>
    (await scanDirectory(f.env, f.at("app"))).inventory.plugins.map((p) => [p.id, p.enabled]);

  assert.deepEqual(await loaded(), [
    ["tools@market", true],
    ["extra@skills-dir", true],
    ["tools@skills-dir", false],
  ]);
  for (const managed of [
    { strictPluginOnlyCustomization: ["hooks"] },
    { strictKnownMarketplaces: [] },
    { blockedMarketplaces: [{ source: "skills-dir" }] },
  ]) {
    f.json("etc/claude-code/managed-settings.json", managed);
    assert.deepEqual((await loaded()).slice(1), [
      ["extra@skills-dir", false],
      ["tools@skills-dir", false],
    ]);
  }
  f.json("etc/claude-code/managed-settings.json", {
    strictKnownMarketplaces: [{ source: "skills-dir" }],
  });
  assert.deepEqual((await loaded())[1], ["extra@skills-dir", true]);
});

test("env values in a plugin command's inline content are hidden, as in a command file", async () => {
  const f = makeFixture();
  const content = (secret: string) => JSON.stringify({ env: { API_KEY: secret } });
  f.json("home/.claude/skills/kit/.claude-plugin/plugin.json", {
    name: "kit",
    commands: {
      inline: { content: content("fake-inline-secret"), description: "Inline" },
      file: { source: "./file.md", description: "From a file" },
    },
  });
  f.write("home/.claude/skills/kit/file.md", content("fake-file-secret"));
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  const commands = view.inventory.commands.filter((c) => c.plugin === "kit@skills-dir");
  assert.deepEqual(commands.map((c) => c.id).sort(), ["kit:file", "kit:inline"]);
  for (const command of commands) assert.match(command.text, /API_KEY/);
  const shown = JSON.stringify(view);
  for (const secret of ["fake-inline-secret", "fake-file-secret"])
    assert.ok(!shown.includes(secret));
});

test("a manifest's commands map replaces the default commands folder, as a path does", async () => {
  const f = makeFixture();
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "kit@market": [{ scope: "user", installPath: f.at("plugins/kit") }] },
  });
  f.json("plugins/kit/.claude-plugin/plugin.json", {
    name: "kit",
    commands: { about: { content: "Explain the kit.", description: "About kit" } },
  });
  f.write("plugins/kit/commands/extra.md", "---\ndescription: not loaded\n---\n");
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.inventory.commands.map((c) => c.id),
    ["kit:about"]
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

test("a rules folder that links to a network location is reported and not followed", {
  // A link to /net is a local path on Windows, where network locations are UNC paths.
  skip: process.platform === "win32",
}, async () => {
  const f = makeFixture();
  f.link("app/.claude/rules", "/net/ccdesk-fixture-host/rules");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.problems.map((p) => [f.rel(p.path), p.error]),
    [
      [
        "app/.claude/rules",
        "links to a network location, which Claude Code does not follow, so ccdesk does not read it either",
      ],
    ]
  );
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

test("a broken ~/.claude.json is reported with what it hides, not shown as an untrusted folder", async () => {
  const f = makeFixture();
  f.write("home/.claude.json", "{ nope");
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.problems.map((p) => [p.path, p.error]),
    [
      [
        f.env.claudeJson,
        "not valid JSON (line 1, column 3), so ccdesk cannot show your trust answers or your user and local MCP servers",
      ],
    ]
  );
});

test("a broken managed-mcp.json is reported, not taken for no organisation lockdown", async () => {
  const f = makeFixture();
  f.write("etc/claude-code/managed-mcp.json", "[]");
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.problems.map((p) => [p.path, p.error]),
    [[f.at("etc/claude-code/managed-mcp.json"), "not a JSON object"]]
  );
});

test("a plugin's broken plugin.json, .mcp.json and hooks.json are each reported", async () => {
  const f = makeFixture();
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "kit@market": [{ scope: "user", installPath: f.at("plugins/kit") }] },
  });
  const broken = [
    f.write("plugins/kit/.claude-plugin/plugin.json", "{ nope"),
    f.write("plugins/kit/.mcp.json", "{ nope"),
    f.write("plugins/kit/hooks/hooks.json", "{ nope"),
  ];
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(view.problems.map((p) => p.path).sort(), broken.sort());
});

test("a plugin's hooks file without a top-level hooks object loads no hooks and is reported; an inline map needs none", async () => {
  const f = makeFixture();
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "kit@market": [{ scope: "user", installPath: f.at("plugins/kit") }] },
  });
  const group = (command: string) => [{ hooks: [{ type: "command", command }] }];
  f.json("plugins/kit/.claude-plugin/plugin.json", {
    name: "kit",
    hooks: ["./config/bare.json", "./config/wrapped.json", { Stop: group("inline") }],
  });
  // docs: plugins-reference#hooks, a file holding only the event map fails to load.
  f.json("plugins/kit/config/bare.json", { PreToolUse: group("bare") });
  f.json("plugins/kit/config/wrapped.json", { hooks: { PostToolUse: group("wrapped") } });
  f.json("plugins/kit/hooks/hooks.json", { SessionStart: group("default-bare") });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(view.inventory.hooks.map((h) => h.command).sort(), ["inline", "wrapped"]);
  assert.deepEqual(view.problems.map((p) => f.rel(p.path)).sort(), [
    "plugins/kit/config/bare.json",
    "plugins/kit/hooks/hooks.json",
  ]);
});

test("a project's disableAllHooks false overrides a user true", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    disableAllHooks: true,
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] },
  });
  f.json("app/.claude/settings.json", { disableAllHooks: false });
  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.inventory.hooks[0]?.active, true);
});

test("an interactive session holds back every settings file's hooks until the folder or a parent is trusted", async () => {
  const f = makeFixture();
  const bashHook = (command: string) => ({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] },
  });
  f.json("etc/claude-code/managed-settings.json", bashHook("audit"));
  f.json("home/.claude/settings.json", bashHook("mine"));
  f.json("work/app/.claude/settings.json", bashHook("theirs"));
  const bashHooks = (view: View) => view.tools.find((t) => t.name === "Bash")?.hooks;

  const untrusted = await scanDirectory(f.env, f.at("work/app"));
  assert.deepEqual(
    untrusted.inventory.hooks.map((h) => [h.command, h.active]),
    [
      ["audit", false],
      ["theirs", false],
      ["mine", false],
    ]
  );
  assert.match(untrusted.inventory.hooks[2]?.note ?? "", /trust dialog/);
  assert.equal(bashHooks(untrusted), 0);

  f.json("home/.claude.json", { projects: { [f.at("work")]: { hasTrustDialogAccepted: true } } });
  const underTrustedParent = await scanDirectory(f.env, f.at("work/app"));
  assert.ok(underTrustedParent.inventory.hooks.every((h) => h.active));
  assert.equal(bashHooks(underTrustedParent), 3);
});

test("in a subdirectory of a repository, local servers come from the repository root's entry only", async () => {
  const f = makeFixture();
  f.write("repo/apps/web/README.md", "x");
  f.git("repo", "init", "-q");
  const local = (name: string) => ({ mcpServers: { [name]: { command: name } } });
  const localNames = async () =>
    (await scanDirectory(f.env, f.at("repo/apps/web"))).inventory.mcpServers
      .filter((s) => s.scope === "local")
      .map((s) => s.name);

  f.json("home/.claude.json", { projects: { [f.at("repo/apps/web")]: local("web-db") } });
  assert.deepEqual(await localNames(), []);

  f.json("home/.claude.json", {
    projects: { [f.at("repo")]: local("root-db"), [f.at("repo/apps/web")]: local("web-db") },
  });
  assert.deepEqual(await localNames(), ["root-db"]);
});

test("~/.claude.json entries keyed as Claude Code writes them give the folder's trust and local servers", async () => {
  const f = makeFixture();
  const env = { ...f.env, platform: process.platform };
  // Claude Code keys a folder with forward slashes on Windows, and as it is elsewhere.
  const key = (path: string) => (env.platform === "win32" ? path.replaceAll("\\", "/") : path);
  f.write("app/README.md", "x");
  f.json("home/.claude.json", {
    projects: {
      [key(f.at("app"))]: {
        hasTrustDialogAccepted: true,
        mcpServers: { db: { command: "db-server" } },
      },
    },
  });

  const view = await scanDirectory(env, f.at("app"));
  assert.equal(view.trust.trusted, true);
  assert.deepEqual(
    view.inventory.mcpServers.filter((s) => s.scope === "local").map((s) => [s.name, s.status]),
    [["db", "active"]]
  );
  const overview = await scanOverview(env, f.at("app"));
  assert.deepEqual(
    overview.projects.filter((p) => basename(p.path) === "app").map((p) => p.path),
    [f.at("app")]
  );
});

test("claude -p treats an untrusted folder as trusted for hooks and .mcp.json, not for repository grants", async () => {
  const f = makeFixture();
  const hook = { hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] } };
  f.json("home/.claude/settings.json", hook);
  f.json("app/.claude/settings.json", {
    permissions: { allow: ["Bash(npm test)"] },
    disabledMcpjsonServers: ["old"],
  });
  f.json("app/.claude/settings.local.json", { permissions: { allow: ["Bash(make)"] } });
  f.json("app/.mcp.json", {
    mcpServers: { docs: { command: "docs-mcp" }, old: { command: "old-mcp" } },
  });
  const verdicts = (view: View) => ({
    hook: view.inventory.hooks[0]?.active,
    rules: Object.fromEntries(
      view.permissions.flatMap((p) => (p.kind === "rule" ? [[p.rule, p.inEffect]] : []))
    ),
    servers: Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.status])),
  });

  assert.deepEqual(verdicts(await scanDirectory(f.env, f.at("app"))), {
    hook: false,
    rules: { "Bash(make)": false, "Bash(npm test)": false },
    servers: { docs: "pending", old: "rejected" },
  });
  const print = await scanDirectory(f.env, f.at("app"), "print");
  assert.equal(print.profile, "print");
  // An untracked local file applies once git has checked it, which -p does; project grants never do.
  assert.deepEqual(verdicts(print), {
    hook: true,
    rules: { "Bash(make)": true, "Bash(npm test)": false },
    servers: { docs: "active", old: "rejected" },
  });
});

test("each .mcp.json server says which setting or saved answer approved, rejected or holds it", async () => {
  const f = makeFixture();
  f.json("app/.mcp.json", {
    mcpServers: {
      mine: { command: "a" },
      theirs: { command: "b" },
      refused: { command: "c" },
      unknown: { command: "d" },
    },
  });
  f.json("home/.claude/settings.json", { enabledMcpjsonServers: ["mine"] });
  f.json("app/.claude/settings.json", { enabledMcpjsonServers: ["theirs"] });
  f.json("home/.claude.json", {
    projects: { [f.at("app")]: { disabledMcpjsonServers: ["refused"] } },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  const server = (name: string) => view.inventory.mcpServers.find((s) => s.name === name);
  assert.equal(server("mine")?.status, "active");
  assert.deepEqual(server("mine")?.approvals, [
    {
      key: "enabledMcpjsonServers",
      source: "user",
      path: f.at("home/.claude/settings.json"),
      counts: true,
    },
  ]);
  assert.equal(server("theirs")?.status, "pending");
  assert.match(
    server("theirs")?.note ?? "",
    /enabledMcpjsonServers in project settings counts once you trust/
  );
  assert.equal(server("refused")?.status, "rejected");
  assert.match(server("refused")?.note ?? "", /your answer in ~\/\.claude\.json/);
  assert.equal(server("unknown")?.approvals, undefined);
  assert.match(server("unknown")?.note ?? "", /answer its prompt/);
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

test("MCP policy entries never show the secrets they match on, and still match", async () => {
  const f = makeFixture();
  // A command policy is an exact match of the whole command, so it repeats the server's token.
  const token = "tok-policy-secret-1";
  f.json("home/.claude.json", {
    mcpServers: {
      db: { command: "node", args: ["db.js", "--token", token] },
      api: { type: "http", url: "https://api.example/mcp" },
    },
  });
  f.json("home/.claude/settings.json", {
    deniedMcpServers: [
      { serverCommand: ["node", "db.js", "--token", token] },
      { serverUrl: "https://user:pass-secret-2@other.example/mcp?key=q-secret-3" },
    ],
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));
  const status = Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.status]));
  assert.deepEqual(status, { api: "active", db: "blocked" });
  const shown = JSON.stringify(view);
  for (const secret of [token, "pass-secret-2", "q-secret-3"]) assert.ok(!shown.includes(secret));
});

test("an allowlist entry holding a server's token keeps that server allowed", async () => {
  const f = makeFixture();
  const token = "tok-allow-secret-4";
  f.json("home/.claude.json", {
    mcpServers: {
      db: { command: "node", args: ["db.js", "--token", token] },
      other: { command: "other-mcp" },
    },
  });
  f.json("etc/claude-code/managed-settings.json", {
    allowedMcpServers: [{ serverCommand: ["node", "db.js", "--token", token] }],
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));
  const status = Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.status]));
  assert.deepEqual(status, { db: "active", other: "blocked" });
  assert.ok(!JSON.stringify(view).includes(token));
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

test("in claude -p, a local approval counts until git tracks the file, and again once you trust the repository", async () => {
  const f = makeFixture();
  f.json("app/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  f.git("app", "init", "-q");
  const local = f.json("app/.claude/settings.local.json", { enabledMcpjsonServers: ["docs"] });
  const docs = async () =>
    (await scanDirectory(f.env, f.at("app"), "print")).inventory.mcpServers.find(
      (s) => s.name === "docs"
    );
  const approval = (counts: boolean) => [
    { key: "enabledMcpjsonServers", source: "local", path: local, counts },
  ];

  const untracked = await docs();
  assert.deepEqual(untracked?.approvals, approval(true));
  assert.equal(untracked?.note, undefined);

  f.git("app", "add", ".claude/settings.local.json");
  const tracked = await docs();
  assert.deepEqual(tracked?.approvals, approval(false));
  assert.equal(tracked?.status, "active");
  assert.match(tracked?.note ?? "", /claude -p connects/);

  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  assert.deepEqual((await docs())?.approvals, approval(true));
});

test("a linked worktree reads the main checkout's skills, agents and commands for each folder it lacks, and its project plugins", async () => {
  const f = makeFixture();
  const entry = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n`;
  f.write("repo/.gitignore", ".claude/\n");
  f.write("repo/.claude/skills/release/SKILL.md", entry("release", "main skill"));
  f.write("repo/.claude/agents/main-agent.md", entry("main-agent", "main agent"));
  f.write("repo/.claude/commands/ship.md", "---\ndescription: main command\n---\n");
  f.git("repo", "init", "-q");
  f.git("repo", "add", ".");
  f.git("repo", "commit", "-qm", "init");
  f.git("repo", "worktree", "add", "-q", f.at("wt"));
  // The worktree has agents of its own, so only those load.
  f.write("wt/.claude/agents/own.md", entry("own", "worktree agent"));
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: {
      "kit@market": [
        { scope: "project", projectPath: f.at("repo"), installPath: f.at("plugins/kit") },
      ],
    },
  });
  f.json("plugins/kit/.claude-plugin/plugin.json", { name: "kit" });

  const view = await scanDirectory(f.env, f.at("wt"));
  const { skills, agents, commands, plugins } = view.inventory;

  assert.deepEqual(
    [skills, agents, commands].map((list) => list.map((e) => f.rel(e.path))),
    [
      ["repo/.claude/skills/release/SKILL.md"],
      ["wt/.claude/agents/own.md"],
      ["repo/.claude/commands/ship.md"],
    ]
  );
  assert.deepEqual(
    plugins.map((p) => p.id),
    ["kit@market"]
  );
});

test("in a linked worktree, the main checkout's tracked local file is held like repository settings", async () => {
  const f = makeFixture();
  f.json("repo/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  const local = f.json("repo/.claude/settings.local.json", { enabledMcpjsonServers: ["docs"] });
  f.git("repo", "init", "-q");
  f.git("repo", "add", ".");
  f.git("repo", "commit", "-qm", "init");
  f.git("repo", "worktree", "add", "-q", "-b", "feature", f.at("repo-feature"));
  // The branch drops the file, so only the main checkout's copy is read.
  f.git("repo-feature", "rm", "-q", ".claude/settings.local.json");
  f.git("repo-feature", "commit", "-qm", "drop local settings");
  const docs = async () =>
    (await scanDirectory(f.env, f.at("repo-feature"), "print")).inventory.mcpServers.find(
      (s) => s.name === "docs"
    );

  const held = await docs();
  assert.deepEqual(held?.approvals, [
    { key: "enabledMcpjsonServers", source: "local", path: local, counts: false },
  ]);
  assert.match(held?.note ?? "", /claude -p connects/);

  f.json("home/.claude.json", { projects: { [f.at("repo")]: { hasTrustDialogAccepted: true } } });
  assert.equal((await docs())?.approvals?.[0]?.counts, true);
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

test("an untracked settings.local.json approval counts under a trusted parent folder and in claude -p; the project file's does not", async () => {
  const f = makeFixture();
  f.json("work/app/.mcp.json", {
    mcpServers: { docs: { command: "docs-mcp" }, lib: { command: "lib-mcp" } },
  });
  f.json("work/app/.claude/settings.local.json", { enabledMcpjsonServers: ["docs"] });
  f.json("work/app/.claude/settings.json", { enabledMcpjsonServers: ["lib"] });
  const servers = async (profile: "interactive" | "print") =>
    Object.fromEntries(
      (await scanDirectory(f.env, f.at("work/app"), profile)).inventory.mcpServers.map((s) => [
        s.name,
        s.note ?? s.status,
      ])
    );

  // claude -p counts as accepted, so it checks git and the untracked local file's approval counts.
  const print = await servers("print");
  assert.equal(print.docs, "active");
  assert.match(print.lib ?? "", /claude -p connects/);

  f.json("home/.claude.json", { projects: { [f.at("work")]: { hasTrustDialogAccepted: true } } });
  const underParent = await servers("interactive");
  assert.equal(underParent.docs, "active");
  assert.match(underParent.lib ?? "", /counts once you trust this folder/);
});

test("under a trusted parent folder, a local file in a linked .claude still cannot approve MCP servers", {
  skip: process.platform === "win32",
}, async () => {
  const f = makeFixture();
  f.json("home/.claude.json", { projects: { [f.at("work")]: { hasTrustDialogAccepted: true } } });
  f.json("work/app/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  f.json("shared/.claude/settings.local.json", { enabledMcpjsonServers: ["docs"] });
  f.link("work/app/.claude", f.at("shared/.claude"));

  const view = await scanDirectory(f.env, f.at("work/app"));

  assert.equal(view.inventory.mcpServers.find((s) => s.name === "docs")?.status, "pending");
});

test("a project agent file Claude Code skips does not hide your agent of the same name", async () => {
  const f = makeFixture();
  f.write(
    "home/.claude/agents/reviewer.md",
    "---\nname: reviewer\ndescription: Reviews a diff\n---\nReview.\n"
  );
  f.write("work/app/.claude/agents/reviewer.md", "---\nname: reviewer\n---\nNo description.\n");
  f.write("work/app/.claude/agents/README.md", "Notes about these agents.\n");

  const view = await scanDirectory(f.env, f.at("work/app"));

  const agents = view.inventory.agents.map((a) => [a.scope, a.name, a.skipped ?? null]);
  assert.deepEqual(agents, [
    ["project", "README", "The frontmatter needs a name."],
    [
      "project",
      "reviewer",
      "The frontmatter needs a description: when Claude should use this agent.",
    ],
    ["user", "reviewer", null],
  ]);
  assert.equal(view.inventory.agents.find((a) => a.scope === "user")?.shadowedBy, undefined);
  const listing = view.context.find((b) => b.kind === "agents");
  assert.match(listing?.text ?? "", /- reviewer: Reviews a diff/);
  assert.doesNotMatch(listing?.text ?? "", /README/);
});

test("header and env values in an agent's inline MCP servers never reach the page", async () => {
  const f = makeFixture();
  f.write(
    "work/app/.claude/agents/api.md",
    [
      "---",
      "name: api",
      "description: Calls the API",
      "mcpServers:",
      "  - api:",
      "      type: http",
      "      url: https://api.example/mcp",
      "      headers:",
      "        Authorization: Bearer yaml-header-secret",
      "---",
      "Use the api tools.",
      "",
    ].join("\n")
  );

  const view = await scanDirectory(f.env, f.at("work/app"));

  const agent = view.inventory.agents.find((a) => a.name === "api");
  assert.ok(agent);
  assert.doesNotMatch(JSON.stringify(view), /yaml-header-secret/);
  assert.match(agent.text, /Authorization: •••/);
  assert.match(agent.text, /Use the api tools\./);
});

test("frontmatter with an unquoted colon is read the way Claude Code reads it, by quoting the value and parsing again", async () => {
  const f = makeFixture();
  f.write(
    "work/app/.claude/agents/reviewer.md",
    "---\nname: reviewer\ndescription: Reviews code. Use when: the user asks for a review\n---\nReview.\n"
  );
  f.write(
    "work/app/.claude/agents/broken.md",
    "---\nname: broken\ndescription: ok\nmetadata:\n  note: a: b\n---\nx\n"
  );
  f.write(
    "work/app/.claude/skills/deploy/SKILL.md",
    "---\ndescription: Deploys. Use when: shipping\n---\nbody\n"
  );

  const view = await scanDirectory(f.env, f.at("work/app"));

  const agents = view.inventory.agents.map((a) => [a.name, a.description, a.skipped ?? null]);
  assert.deepEqual(agents, [
    ["broken", "", "The frontmatter needs a name."],
    ["reviewer", "Reviews code. Use when: the user asks for a review", null],
  ]);
  assert.equal(
    view.inventory.skills.find((s) => s.name === "deploy")?.description,
    "Deploys. Use when: shipping"
  );
});

test("a header value in frontmatter that parses only once quoted still never reaches the page", async () => {
  const f = makeFixture();
  f.write(
    "work/app/.claude/agents/api.md",
    [
      "---",
      "name: api",
      "description: Calls the API. Use when: the user asks",
      "mcpServers:",
      "  - api:",
      "      type: http",
      "      url: https://api.example/mcp",
      "      headers:",
      "        Authorization: Bearer quoted-header-secret",
      "---",
      "Use the api tools.",
      "",
    ].join("\n")
  );

  const view = await scanDirectory(f.env, f.at("work/app"));

  assert.equal(view.inventory.agents.find((a) => a.name === "api")?.skipped, undefined);
  assert.doesNotMatch(JSON.stringify(view), /quoted-header-secret/);
});

test("a managed settings file that is not JSON stops Claude Code from starting; an empty one is {}", async () => {
  const f = makeFixture();
  f.write("etc/claude-code/managed-settings.json", "");
  f.json("home/.claude/settings.json", { model: "sonnet" });

  const empty = await scanDirectory(f.env, f.at("app"));
  assert.deepEqual(empty.problems, []);

  f.write("etc/claude-code/managed-settings.d/10-model.json", '{"model":');
  const broken = await scanDirectory(f.env, f.at("app"));
  assert.equal(broken.problems.length, 1);
  assert.equal(broken.problems[0]?.blocksStart, true);
});

test("a managed settings file that fails to read stops Claude Code from starting, unless a higher source supplies a policy", async () => {
  const f = makeFixture();
  // Reading a folder fails with EISDIR, a failure other than the system denying the read.
  mkdirSync(f.at("etc/claude-code/managed-settings.json"), { recursive: true });
  f.write("app/README.md", "x");

  const alone = await scanDirectory(f.env, f.at("app"));
  assert.equal(alone.problems.length, 1);
  assert.equal(alone.problems[0]?.blocksStart, true);

  f.json("home/.claude/remote-settings.json", { model: "opus" });
  const withServer = await scanDirectory(f.env, f.at("app"));
  assert.equal(withServer.problems[0]?.blocksStart, undefined);
});

test("a JSON file that starts with a byte order mark is read, as Claude Code reads it", async () => {
  // Windows PowerShell 5.1's Set-Content -Encoding UTF8 writes one.
  const f = makeFixture();
  f.write("etc/claude-code/managed-settings.json", '\uFEFF{"model":"opus"}');
  f.write("app/.claude/settings.json", '\uFEFF{"theme":"dark"}');
  f.write("app/CLAUDE.md", "@notes.json\n");
  f.write("app/notes.json", '\uFEFF{"env":{"API_KEY":"sk-bom-secret"}}');

  const view = await scanDirectory(f.env, f.at("app"));
  assert.deepEqual(view.problems, []);
  assert.deepEqual(setting(view, "model")?.from, ["managed"]);
  assert.deepEqual(setting(view, "theme")?.from, ["project"]);
  assert.doesNotMatch(JSON.stringify(view), /sk-bom-secret/);
});

test("an MCP rule with parentheses in a settings file is listed as skipped", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", {
    permissions: { deny: ["mcp__db__query(table:users)", "mcp__db__drop"] },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  const rules = Object.fromEntries(
    view.permissions.flatMap((p) => (p.kind === "rule" ? [[p.rule, p.inEffect]] : []))
  );
  assert.deepEqual(rules, { "mcp__db__query(table:users)": false, mcp__db__drop: true });
});

test("an allow rule that globs the tool name outside mcp__<server>__ is listed as skipped", async () => {
  const f = makeFixture();
  f.write("app/README.md", "x");
  f.json("home/.claude/settings.json", {
    permissions: {
      allow: ["mcp__*", "Web*", "mcp__git*__get_issue", "mcp__github__*", "Bash(npm *)"],
      deny: ["mcp__*"],
    },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  // docs: permissions#tool-name-wildcards
  const rules = Object.fromEntries(
    view.permissions.flatMap((p) =>
      p.kind === "rule" ? [[`${p.list} ${p.rule}`, p.inEffect]] : []
    )
  );
  assert.deepEqual(rules, {
    "allow mcp__*": false,
    "allow Web*": false,
    "allow mcp__git*__get_issue": false,
    "allow mcp__github__*": true,
    "allow Bash(npm *)": true,
    "deny mcp__*": true,
  });
});

test("in the folder whose .claude is CLAUDE_CONFIG_DIR, local MCP approvals apply without the trust step", async () => {
  const f = makeFixture();
  const env = {
    ...f.env,
    claudeDir: f.at("cfg/.claude"),
    claudeJson: f.at("cfg/.claude/.claude.json"),
  };
  f.json("cfg/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  f.json("cfg/.claude/settings.local.json", { enableAllProjectMcpServers: true });

  const view = await scanDirectory(env, f.at("cfg"));

  assert.equal(view.inventory.mcpServers.find((s) => s.name === "docs")?.status, "active");
});

test("your skill wins over a project skill of the same name, and a command is named by its file", async () => {
  const f = makeFixture();
  f.write("home/.claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: mine\n---\n");
  f.write("app/.claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: theirs\n---\n");
  f.write("app/.claude/commands/ship.md", "---\nname: not-the-command\ndescription: s\n---\n");

  const view = await scanDirectory(f.env, f.at("app"));

  const project = view.inventory.skills.find((s) => s.scope === "project");
  assert.equal(project?.shadowedBy, f.at("home/.claude/skills/deploy/SKILL.md"));
  const listing = view.context.find((b) => b.kind === "skills")?.text ?? "";
  assert.match(listing, /mine/);
  assert.doesNotMatch(listing, /theirs/);
  assert.deepEqual(
    view.inventory.commands.map((c) => c.name),
    ["ship"]
  );
});

test("commands come from the managed folder, yours and every project folder up to the repository root, and the first of a name runs", async () => {
  const f = makeFixture();
  const command = (description: string) => `---\ndescription: ${description}\n---\n`;
  f.write("etc/claude-code/.claude/commands/audit.md", command("managed audit"));
  f.write("home/.claude/commands/audit.md", command("my audit"));
  f.write("home/.claude/commands/deploy.md", command("my deploy"));
  f.write("repo/.claude/commands/deploy.md", command("root deploy"));
  f.write("repo/.claude/commands/lint.md", command("root lint"));
  f.write("repo/pkg/.claude/commands/lint.md", command("pkg lint"));
  f.write("outside/.claude/commands/stray.md", command("not here"));
  f.git("repo", "init", "-q");

  const view = await scanDirectory(f.env, f.at("repo/pkg"));

  // docs: skills#resolve-skills-that-share-a-name, managed over yours over the project; within the
  // project the folder closest to the start directory comes first (observed in v2.1.296).
  assert.deepEqual(
    view.inventory.commands.map((c) => [
      c.name,
      f.rel(c.path),
      c.shadowedBy ? f.rel(c.shadowedBy) : null,
    ]),
    [
      ["audit", "etc/claude-code/.claude/commands/audit.md", null],
      ["audit", "home/.claude/commands/audit.md", "etc/claude-code/.claude/commands/audit.md"],
      ["deploy", "home/.claude/commands/deploy.md", null],
      ["lint", "repo/pkg/.claude/commands/lint.md", null],
      ["deploy", "repo/.claude/commands/deploy.md", "home/.claude/commands/deploy.md"],
      ["lint", "repo/.claude/commands/lint.md", "repo/pkg/.claude/commands/lint.md"],
    ]
  );
  const listing = view.context.find((b) => b.kind === "skills")?.text ?? "";
  assert.match(listing, /managed audit/);
  assert.doesNotMatch(listing, /my audit|root deploy|root lint|not here/);
});

test("under a trusted parent, a local file in a .claude that is a link waits for its own trust", {
  skip: process.platform === "win32",
}, async () => {
  const f = makeFixture();
  f.json("home/.claude.json", { projects: { [f.at("work")]: { hasTrustDialogAccepted: true } } });
  f.json("work/own/.claude/settings.local.json", { permissions: { allow: ["Bash"] } });
  f.json("shared/.claude/settings.local.json", { permissions: { allow: ["Bash"] } });
  f.link("work/linked/.claude", f.at("shared/.claude"));

  const allowed = async (dir: string) => {
    const view = await scanDirectory(f.env, f.at(dir));
    return view.permissions.find((p) => p.kind === "rule" && p.rule === "Bash")?.inEffect;
  };

  assert.equal(await allowed("work/own"), true);
  assert.equal(await allowed("work/linked"), false);
});

test("with CLAUDE_CONFIG_DIR inside a repository, the root's local file waits for trust; the config home's own does not", async () => {
  const f = makeFixture();
  const env = {
    ...f.env,
    claudeDir: f.at("app/profile/.claude"),
    claudeJson: f.at("app/profile/.claude/.claude.json"),
  };
  f.write("app/README.md", "x");
  f.git("app", "init", "-q");
  f.json("app/.claude/settings.local.json", { permissions: { allow: ["Bash"] } });
  f.json("app/profile/.claude/settings.local.json", { permissions: { allow: ["Read"] } });

  const view = await scanDirectory(env, f.at("app/profile"));

  const allowed = (rule: string) =>
    view.permissions.find((p) => p.kind === "rule" && p.rule === rule)?.inEffect;
  assert.equal(allowed("Bash"), false);
  assert.equal(allowed("Read"), true);
});

test("started below a configuration home, its local file waits for trust like any other", async () => {
  const f = makeFixture();
  const env = {
    ...f.env,
    claudeDir: f.at("app/.claude"),
    claudeJson: f.at("app/.claude/.claude.json"),
  };
  f.write("app/sub/README.md", "x");
  f.git("app", "init", "-q");
  f.json("app/.claude/settings.local.json", { permissions: { allow: ["Bash"] } });

  const view = await scanDirectory(env, f.at("app/sub"));

  assert.equal(
    view.permissions.find((p) => p.kind === "rule" && p.rule === "Bash")?.inEffect,
    false
  );
});

test("with CLAUDE_CONFIG_DIR inside a repository, the root's local file cannot approve MCP servers before trust", async () => {
  const f = makeFixture();
  const env = {
    ...f.env,
    claudeDir: f.at("app/profile/.claude"),
    claudeJson: f.at("app/profile/.claude/.claude.json"),
  };
  f.write("app/README.md", "x");
  f.git("app", "init", "-q");
  f.json("app/.claude/settings.local.json", { enableAllProjectMcpServers: true });
  f.json("app/profile/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });

  const view = await scanDirectory(env, f.at("app/profile"));

  assert.notEqual(view.inventory.mcpServers.find((s) => s.name === "docs")?.status, "active");
});

test("a project autoMemoryDirectory applies under a trusted parent folder, as hooks do", async () => {
  const f = makeFixture();
  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  f.json("app/sub/.claude/settings.json", { autoMemoryDirectory: f.at("custom-memory") });

  const view = await scanDirectory(f.env, f.at("app/sub"));

  assert.equal(view.trust.inheritedFrom, f.at("app"));
  assert.equal(view.memory.dir, f.at("custom-memory"));
  assert.equal(view.memory.custom, true);
});

test("a plugin's MCP server goes by its registered name plugin:<plugin>:<key> in policy and /mcp", async () => {
  const f = makeFixture();
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "kit@market": [{ scope: "user", installPath: f.at("plugins/kit") }] },
  });
  f.json("plugins/kit/.claude-plugin/plugin.json", { name: "kit-tools" });
  f.json("plugins/kit/.mcp.json", {
    mcpServers: { db: { command: "db-mcp" }, cache: { command: "cache-mcp" } },
  });
  f.json("home/.claude/settings.json", {
    deniedMcpServers: [{ serverName: "plugin:kit-tools:db" }],
  });
  f.json("home/.claude.json", {
    mcpServers: { db: { command: "my-db-mcp" } },
    projects: { [f.at("app")]: { disabledMcpServers: ["plugin:kit-tools:cache"] } },
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.inventory.mcpServers.map((s) => [s.name, s.status]),
    [
      ["db", "active"],
      ["plugin:kit-tools:db", "blocked"],
      ["plugin:kit-tools:cache", "disabled"],
    ]
  );
});

test("MCP policy entries and server values match after variable expansion, each from its own environment", async () => {
  const f = makeFixture();
  // A ${NAME} reference, written without tripping the lint on template-like strings.
  const ref = (name: string) => `\${${name}}`;
  const env = {
    ...f.env,
    processEnv: { TOOLS: "/fake/tools", MCP_HOST: "evil.example", API_TOKEN: "fake-token-5" },
  };
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "kit@market": [{ scope: "user", installPath: f.at("plugins/kit") }] },
  });
  f.json("plugins/kit/.mcp.json", {
    mcpServers: {
      srv: { command: `${ref("CLAUDE_PLUGIN_ROOT")}/srv` },
      // A plugin's server gets the project root without a default.
      local: { command: `${ref("CLAUDE_PROJECT_DIR")}/bin/local` },
    },
  });
  f.json("home/.claude.json", {
    mcpServers: {
      expanded: { command: `${ref("TOOLS")}/bin/a`, args: ["--token", ref("API_TOKEN")] },
      literal: { command: "/fake/tools/bin/b" },
      filled: { command: "/fake/filled/c" },
      kept: { command: `${ref("TOOLS")}/bin/kept` },
      wide: { type: "http", url: "https://evil.example/mcp" },
      docs: { type: "http", url: "https://docs.example/mcp" },
      stray: { command: "/fake/stray" },
    },
  });
  // A deny entry's variable with no startup value fills from your settings.
  f.json("home/.claude/settings.json", {
    env: { FILL_DIR: "/fake/filled" },
    deniedMcpServers: [
      { serverCommand: ["/fake/tools/bin/a", "--token", "fake-token-5"] },
      { serverCommand: [`${ref("TOOLS")}/bin/b`] },
      { serverCommand: [`${ref("FILL_DIR")}/c`] },
      { serverCommand: [`${f.at("plugins/kit")}/srv`] },
      { serverCommand: [`${f.at("app")}/bin/local`] },
    ],
  });
  // An allow entry whose expansion changes its host is ignored.
  f.json("etc/claude-code/managed-settings.json", {
    allowedMcpServers: [
      { serverUrl: `https://${ref("MCP_HOST")}/*` },
      { serverUrl: "https://docs.example/*" },
      ...["expanded", "literal", "filled", "kept"].map((serverName) => ({ serverName })),
    ],
  });
  f.write("app/README.md", "x");

  const view = await scanDirectory(env, f.at("app"));

  assert.deepEqual(
    Object.fromEntries(view.inventory.mcpServers.map((s) => [s.name, s.note ?? s.status])),
    {
      expanded: "Blocked by deniedMcpServers",
      literal: "Blocked by deniedMcpServers",
      filled: "Blocked by deniedMcpServers",
      kept: "active",
      wide: "Not in allowedMcpServers; an allowedMcpServers entry was ignored because expanding its variables changes its scheme, host or path",
      docs: "active",
      // The ignored entry is a URL one, so it could never have admitted a command.
      stray: "Not in allowedMcpServers",
      "plugin:kit:srv": "Blocked by deniedMcpServers",
      "plugin:kit:local": "Blocked by deniedMcpServers",
    }
  );
  // The page shows each value as written, never expanded.
  assert.ok(!JSON.stringify(view).includes("/fake/tools/bin/kept"));
  assert.ok(!JSON.stringify(view).includes("fake-token-5"));
  assert.match(
    view.inventory.mcpServers.find((s) => s.name === "expanded")?.target ?? "",
    /^\$\{TOOLS\}\/bin\/a /
  );
});

test("an MCP variable set to an empty string expands to it, not to its default", async () => {
  const f = makeFixture();
  const env = { ...f.env, processEnv: { TOOLS: "" } };
  f.json("home/.claude.json", {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} reference is the case under test.
    mcpServers: { srv: { command: "${TOOLS:-/fake/tools}/bin/srv" } },
  });
  f.json("home/.claude/settings.json", { deniedMcpServers: [{ serverCommand: ["/bin/srv"] }] });
  f.write("app/README.md", "x");

  const view = await scanDirectory(env, f.at("app"));

  assert.equal(view.inventory.mcpServers.find((s) => s.name === "srv")?.status, "blocked");
});

test("managed strictPluginOnlyCustomization withholds your and the project's skills, commands, agents, hooks and MCP servers", async () => {
  const f = makeFixture();
  const skill = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n`;
  f.json("etc/claude-code/managed-settings.json", {
    strictPluginOnlyCustomization: true,
    hooks: { Stop: [{ hooks: [{ type: "command", command: "audit" }] }] },
  });
  f.write("etc/claude-code/.claude/skills/policy/SKILL.md", skill("policy", "managed skill"));
  f.write("home/.claude/skills/mine/SKILL.md", skill("mine", "your skill"));
  f.write("app/.claude/skills/theirs/SKILL.md", skill("theirs", "project skill"));
  f.write("home/.claude/commands/ship.md", "---\ndescription: ship it\n---\n");
  f.write("app/.claude/agents/review.md", skill("review", "project agent"));
  f.json("home/.claude/settings.json", {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] },
  });
  f.json("home/.claude.json", { mcpServers: { db: { command: "db-mcp" } } });

  const view = await scanDirectory(f.env, f.at("app"), "print");
  const { skills, commands, agents, hooks, mcpServers } = view.inventory;

  assert.deepEqual(
    skills.map((s) => [s.name, s.skipped !== undefined]),
    [
      ["policy", false],
      ["mine", true],
      ["theirs", true],
    ]
  );
  assert.ok(commands[0]?.skipped);
  assert.ok(agents[0]?.skipped);
  assert.deepEqual(
    hooks.map((h) => [h.command, h.active]),
    [
      ["audit", true],
      ["notify", false],
    ]
  );
  assert.equal(mcpServers[0]?.status, "blocked");
  const listing = view.context.find((b) => b.kind === "skills")?.text ?? "";
  assert.match(listing, /managed skill/);
  assert.doesNotMatch(listing, /your skill|project skill|ship it/);

  // A list locks only the surfaces it names.
  f.json("etc/claude-code/managed-settings.json", { strictPluginOnlyCustomization: ["hooks"] });
  const hooksOnly = await scanDirectory(f.env, f.at("app"), "print");
  assert.ok(hooksOnly.inventory.skills.every((s) => s.skipped === undefined));
  assert.equal(hooksOnly.inventory.hooks[0]?.active, false);
});

test("skill folders named synced in any case, and skills and commands named anthropic-skills, are skipped outside plugins", async () => {
  const f = makeFixture();
  const skill = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n`;
  f.write("app/.claude/skills/synced/SKILL.md", skill("synced", "project synced"));
  f.write("home/.claude/skills/Synced/SKILL.md", skill("mine", "personal Synced"));
  f.write("app/.claude/skills/anthropic-skills/SKILL.md", skill("helper", "reserved folder"));
  f.write("app/.claude/skills/pdf/SKILL.md", skill("anthropic-skills:pdf", "reserved name"));
  f.write("app/.claude/skills/deploy/SKILL.md", skill("deploy", "kept"));
  // Claude Code compares without case, and drops trailing dots and spaces from a folder name.
  f.write("home/.claude/skills/Synced./SKILL.md", skill("dotted", "personal Synced."));
  f.json("home/.claude/skills/Synced./.claude-plugin/plugin.json", { name: "dotted" });
  f.write("home/.claude/skills/synced /SKILL.md", skill("spaced", "personal synced space"));
  f.write("app/.claude/skills/tool/SKILL.md", skill("Anthropic-Skills:Tool", "reserved name"));
  f.write("app/.claude/commands/Anthropic-Skills.md", "---\ndescription: reserved command\n---\n");
  f.write("app/.claude/commands/anthropic-skills.md", "---\ndescription: reserved command\n---\n");
  f.write("app/.claude/commands/anthropic-skills/x.md", "---\ndescription: reserved folder\n---\n");
  f.write("app/.claude/commands/ship.md", "---\ndescription: ship it\n---\n");
  // A plugin may use the name (docs: skills#names-reserved-for-synced-skills).
  f.json("home/.claude/plugins/installed_plugins.json", {
    plugins: { "anthropic-skills@market": [{ scope: "user", installPath: f.at("plugins/as") }] },
  });
  f.write("plugins/as/skills/anthropic-skills/SKILL.md", skill("anthropic-skills", "plugin skill"));

  const view = await scanDirectory(f.env, f.at("app"));

  const loaded = (entries: typeof view.inventory.skills) =>
    entries.filter((e) => !e.skipped).map((e) => e.id ?? e.name);
  assert.deepEqual(loaded(view.inventory.skills).sort(), [
    "anthropic-skills:anthropic-skills",
    "deploy",
  ]);
  assert.equal(view.inventory.skills.filter((s) => s.skipped).length, 7);
  assert.deepEqual(loaded(view.inventory.commands), ["ship"]);
  assert.deepEqual(
    view.inventory.plugins.map((p) => p.id),
    ["anthropic-skills@market"]
  );
  const listing = view.context.find((b) => b.kind === "skills")?.text ?? "";
  assert.doesNotMatch(listing, /synced|Synced|reserved/);
});

/** A claude.ai account in ~/.claude.json and the folder Claude Code syncs its skills into. */
function syncedAccount(f: ReturnType<typeof makeFixture>) {
  const org = "0000000A-0000-4000-8000-000000000001";
  const account = "0000000B-0000-4000-8000-000000000002";
  f.json("home/.claude.json", { oauthAccount: { organizationUuid: org, accountUuid: account } });
  return `home/.claude/skills/synced/${org.toLowerCase()}_${account.toLowerCase()}`;
}

test("a synced skill never takes a name from your skills or commands; it runs as anthropic-skills:<name> instead", async () => {
  const f = makeFixture();
  const bucket = syncedAccount(f);
  const skill = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n`;
  f.write("app/.claude/skills/deploy/SKILL.md", skill("deploy", "project deploy"));
  f.write("home/.claude/commands/commit.md", "---\ndescription: my commit\n---\n");
  f.write(`${bucket}/deploy/SKILL.md`, skill("deploy", "synced deploy"));
  // Names compare ignoring case and compatibility forms (docs: skills#when-a-synced-skill-name-matches-another-command).
  f.write(`${bucket}/Commit/SKILL.md`, skill("Ｃommit", "synced commit"));
  f.write(`${bucket}/pdf/SKILL.md`, skill("pdf", "synced pdf"));
  // A renamed skill is still invoked by its folder's name (docs: skills#how-a-skill-gets-its-command-name).
  f.write("home/.claude/skills/ship/SKILL.md", skill("release", "my release"));
  f.write(`${bucket}/ship/SKILL.md`, skill("ship", "synced ship"));

  const view = await scanDirectory(f.env, f.at("app"));

  const project = view.inventory.skills.find((s) => s.scope === "project");
  assert.equal(project?.shadowedBy, undefined);
  assert.equal(view.inventory.commands[0]?.shadowedBy, undefined);
  assert.deepEqual(
    view.inventory.skills
      .filter((s) => s.synced)
      .map((s) => [s.id ?? s.name, s.shadowedBy ?? null]),
    [
      ["anthropic-skills:Ｃommit", null],
      ["anthropic-skills:deploy", null],
      ["pdf", null],
      ["anthropic-skills:ship", null],
    ]
  );
  const listing = view.context.find((b) => b.kind === "skills")?.text ?? "";
  assert.match(listing, /- deploy: project deploy/);
  assert.match(listing, /- anthropic-skills:deploy: synced deploy/);
});

test("synced skills load only for the signed-in claude.ai account, and not after syncClaudeAiSkills: false", async () => {
  const f = makeFixture();
  const bucket = syncedAccount(f);
  const skill = "---\nname: pdf\ndescription: synced pdf\n---\n";
  f.write(`${bucket}/pdf/SKILL.md`, skill);
  f.write(
    "home/.claude/skills/synced/0000000c-0000-4000-8000-000000000003_0000000d-0000-4000-8000-000000000004/xlsx/SKILL.md",
    "---\nname: xlsx\ndescription: other account\n---\n"
  );
  f.write("app/README.md", "x");

  const loaded = async () =>
    (await scanDirectory(f.env, f.at("app"))).inventory.skills.map((s) => [s.name, !s.skipped]);

  assert.deepEqual(await loaded(), [
    ["pdf", true],
    ["xlsx", false],
  ]);
  f.json("home/.claude/settings.json", { syncClaudeAiSkills: false });
  assert.deepEqual(await loaded(), [
    ["pdf", false],
    ["xlsx", false],
  ]);
  // Not signed in with a claude.ai account: no synced skill loads.
  f.json("home/.claude/settings.json", {});
  f.json("home/.claude.json", {});
  assert.deepEqual(await loaded(), [
    ["pdf", false],
    ["xlsx", false],
  ]);
});

test("a directory known only from ~/.claude.json is listed while its folder exists, not after", async () => {
  const f = makeFixture();
  const kept = f.at("kept");
  const gone = f.at("gone");
  mkdirSync(kept, { recursive: true });
  f.json("home/.claude.json", { projects: { [kept]: {}, [gone]: {} } });

  const before = (await scanOverview(f.env, f.at("home"))).projects.map((p) => p.path);
  renameSync(kept, f.at("moved"));
  const after = (await scanOverview(f.env, f.at("home"))).projects.map((p) => p.path);

  assert.deepEqual(
    [before.includes(kept), before.includes(gone), after.includes(kept)],
    [true, false, false]
  );
});

test("the launch directory is listed even when its folder is gone", async () => {
  const f = makeFixture();
  const launch = f.at("gone");

  assert.ok((await scanOverview(f.env, launch)).projects.some((p) => p.path === launch));
});
