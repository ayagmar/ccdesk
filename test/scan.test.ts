import assert from "node:assert/strict";
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
