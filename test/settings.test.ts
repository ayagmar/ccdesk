import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDirectory } from "../src/core/index.ts";
import { effectiveSettings } from "../src/core/scan/settings.ts";
import { makeFixture } from "./helpers/fixture.ts";

function setting(view: Awaited<ReturnType<typeof scanDirectory>>, key: string) {
  return view.effective.find((s) => s.key === key);
}

test("managed settings beat local, which beat project, which beat user", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { model: "opus", theme: "dark", effortLevel: "low" });
  f.json("app/.claude/settings.json", { model: "sonnet", effortLevel: "medium" });
  f.json("app/.claude/settings.local.json", { model: "haiku", effortLevel: "high" });
  f.json("etc/claude-code/managed-settings.json", { effortLevel: "xhigh" });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(setting(view, "model"), {
    key: "model",
    value: "haiku",
    from: ["local"],
    merged: false,
    overridden: [
      { scope: "project", value: "sonnet" },
      { scope: "user", value: "opus" },
    ],
    ignored: [],
  });
  assert.deepEqual(setting(view, "effortLevel")?.from, ["managed"]);
  assert.deepEqual(setting(view, "theme")?.from, ["user"]);
});

test("with allowManagedPermissionRulesOnly, only managed permission rules apply", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", {
    allowManagedPermissionRulesOnly: true,
    permissions: { deny: ["WebFetch"] },
  });
  f.json("home/.claude/settings.json", { permissions: { allow: ["Bash(ls)"] } });

  const view = await scanDirectory(f.env, f.at("app"));

  const rules = view.permissions.filter((p) => p.kind === "rule");
  assert.deepEqual(
    rules.map((p) => [p.kind === "rule" ? p.rule : "", p.inEffect]),
    [
      ["WebFetch", true],
      ["Bash(ls)", false],
    ]
  );
});

test("fallbackModel takes the whole list from the highest file", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { fallbackModel: ["opus", "sonnet"] });
  f.json("app/.claude/settings.json", { fallbackModel: ["haiku"] });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(setting(view, "fallbackModel")?.value, ["haiku"]);
});

test("environment values in settings and MCP servers never reach the UI", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { env: { ANTHROPIC_API_KEY: "sk-secret" } });
  f.json("home/.claude.json", {
    mcpServers: {
      db: {
        command: "db-mcp",
        env: { DB_PASSWORD: "hunter2" },
        headers: { Authorization: "Bearer x" },
      },
    },
  });

  const view = await scanDirectory(f.env, f.at("home"));
  const serialized = JSON.stringify(view);

  assert.ok(!serialized.includes("sk-secret"));
  assert.ok(!serialized.includes("hunter2"));
  assert.deepEqual(setting(view, "env")?.value, { ANTHROPIC_API_KEY: "•••" });
});

test("a settings file that is not valid JSON is reported, not skipped silently", async () => {
  const f = makeFixture();
  f.write("app/.claude/settings.json", '{ "model": ');

  const view = await scanDirectory(f.env, f.at("app"));
  const project = view.settings.find((l) => l.scope === "project");

  assert.equal(project?.exists, true);
  assert.equal(project?.data, null);
  assert.ok(project?.error);
});

test("a restrictive value from a lower file beats a looser higher one, nested keys too", () => {
  const value = (layers: Parameters<typeof effectiveSettings>[0], key: string) =>
    effectiveSettings(layers).find((s) => s.key === key)?.value;
  const layer = (scope: "managed" | "user" | "project", data: Record<string, unknown>) => ({
    scope,
    path: `/${scope}.json`,
    exists: true,
    data,
  });

  const permissions = value(
    [
      layer("managed", { permissions: { blockReadsOutsideWorkingDirectories: false } }),
      layer("user", {
        permissions: { blockReadsOutsideWorkingDirectories: true, allow: ["Read"] },
      }),
    ],
    "permissions"
  ) as Record<string, unknown>;
  assert.equal(permissions.blockReadsOutsideWorkingDirectories, true);

  assert.equal(
    value(
      [layer("managed", { maxEffortLevel: "high" }), layer("project", { maxEffortLevel: "low" })],
      "maxEffortLevel"
    ),
    "low"
  );
  // A project may only turn remote control off at startup, never on.
  assert.equal(
    value(
      [
        layer("project", { remoteControlAtStartup: true }),
        layer("user", { remoteControlAtStartup: false }),
      ],
      "remoteControlAtStartup"
    ),
    false
  );
});

test("a project value that may only tighten a key, and does not, is ignored with the reason", () => {
  const [remote] = effectiveSettings([
    {
      scope: "project",
      path: "/project.json",
      exists: true,
      data: { remoteControlAtStartup: true },
    },
  ]);

  assert.equal(remote?.value, undefined);
  assert.deepEqual(remote?.from, []);
  assert.deepEqual(
    remote?.ignored.map((i) => [i.scope, i.value, i.reason]),
    [["project", true, "it is not stricter than Claude Code's default"]]
  );
});

test("a repository's bypassPermissions default mode is ignored in effective settings too", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { permissions: { defaultMode: "default" } });
  f.json("app/.claude/settings.json", {
    permissions: { defaultMode: "bypassPermissions", allow: ["Read"] },
  });

  const permissions = setting(await scanDirectory(f.env, f.at("app")), "permissions");

  assert.deepEqual(permissions?.value, { defaultMode: "default", allow: ["Read"] });
  assert.deepEqual(
    permissions?.ignored.map((i) => [i.scope, i.value]),
    [["project", { defaultMode: "bypassPermissions" }]]
  );
});

type SandboxScope = "managed" | "user" | "project" | "local";

/** The effective sandbox and what was ignored from which file, from settings values by file. */
function sandboxOf(files: Partial<Record<SandboxScope, Record<string, unknown>>>) {
  const layers = (["managed", "local", "project", "user"] as const)
    .filter((scope) => files[scope])
    .map((scope) => ({ scope, path: `/${scope}.json`, exists: true, data: files[scope] ?? {} }));
  const sandbox = effectiveSettings(layers).find((s) => s.key === "sandbox");
  return {
    value: sandbox?.value as Record<string, Record<string, unknown> | unknown>,
    ignored: (sandbox?.ignored ?? []).map((i) => [i.scope, i.value]),
  };
}

test("under a managed allowUnsandboxedCommands false, repository settings cannot loosen the sandbox", () => {
  const { value, ignored } = sandboxOf({
    managed: { sandbox: { enabled: true, allowUnsandboxedCommands: false } },
    user: { sandbox: { failIfUnavailable: true, filesystem: { allowWrite: ["/mine"] } } },
    project: {
      sandbox: {
        failIfUnavailable: false,
        excludedCommands: ["docker *"],
        enableWeakerNestedSandbox: true,
        autoAllowBashIfSandboxed: false,
        filesystem: { allowWrite: ["/theirs"], denyWrite: ["/etc"] },
        network: { allowedDomains: ["evil.example"] },
      },
    },
  });

  assert.deepEqual(value, {
    enabled: true,
    allowUnsandboxedCommands: false,
    failIfUnavailable: true,
    filesystem: { allowWrite: ["/mine"], denyWrite: ["/etc"] },
    autoAllowBashIfSandboxed: false,
  });
  assert.deepEqual(ignored, [
    ["project", { excludedCommands: ["docker *"] }],
    ["project", { network: { allowedDomains: ["evil.example"] } }],
    ["project", { filesystem: { allowWrite: ["/theirs"] } }],
    ["project", { enableWeakerNestedSandbox: true }],
    ["project", { failIfUnavailable: false }],
  ]);
});

test("your own allowUnsandboxedCommands false holds against a project's true, without locking the rest", () => {
  const { value, ignored } = sandboxOf({
    user: { sandbox: { allowUnsandboxedCommands: false, filesystem: { allowWrite: ["/safe"] } } },
    project: {
      sandbox: { allowUnsandboxedCommands: true, filesystem: { allowWrite: ["/unsafe"] } },
    },
  });

  assert.equal(value.allowUnsandboxedCommands, false);
  assert.deepEqual(value.filesystem, { allowWrite: ["/safe", "/unsafe"] });
  assert.deepEqual(ignored, [["project", { allowUnsandboxedCommands: true }]]);
});

test("allowManagedDomainsOnly keeps only managed domains and proxy ports, and requires the sandbox", () => {
  const { value, ignored } = sandboxOf({
    managed: { sandbox: { network: { allowManagedDomainsOnly: true, allowedDomains: ["corp"] } } },
    user: { sandbox: { network: { allowedDomains: ["mine"], deniedDomains: ["bad"] } } },
    project: { sandbox: { excludedCommands: ["make"], network: { httpProxyPort: 8080 } } },
  });

  assert.deepEqual(value.network, {
    allowManagedDomainsOnly: true,
    allowedDomains: ["corp"],
    deniedDomains: ["bad"],
  });
  assert.deepEqual(ignored, [
    ["user", { network: { allowedDomains: ["mine"] } }],
    ["project", { network: { httpProxyPort: 8080 } }],
    ["project", { excludedCommands: ["make"] }],
  ]);
});

test("allowManagedReadPathsOnly keeps only managed allowRead entries; denyRead still merges", () => {
  const { value, ignored } = sandboxOf({
    managed: {
      sandbox: { filesystem: { allowManagedReadPathsOnly: true, allowRead: ["~/work"] } },
    },
    user: { sandbox: { filesystem: { allowRead: ["~/notes"], denyRead: ["~/.aws"] } } },
  });

  assert.deepEqual(value.filesystem, {
    allowManagedReadPathsOnly: true,
    allowRead: ["~/work"],
    denyRead: ["~/.aws"],
  });
  assert.deepEqual(ignored, [["user", { filesystem: { allowRead: ["~/notes"] } }]]);
});

test("sandbox keys read only from user or managed settings are ignored in a repository's files", () => {
  const repository = {
    sandbox: {
      bwrapPath: "/tmp/bwrap",
      filesystem: { disabled: true },
      network: { tlsTerminate: true },
      credentials: {
        files: [
          { path: "~/.netrc", mode: "mask" },
          { path: "~/.aws", mode: "deny" },
        ],
      },
    },
  };
  const { value, ignored } = sandboxOf({
    user: { sandbox: { bwrapPath: "/opt/bwrap", filesystem: { disabled: false } } },
    local: repository,
  });

  assert.deepEqual(value, {
    filesystem: { disabled: false },
    credentials: { files: [{ path: "~/.aws", mode: "deny" }] },
  });
  assert.deepEqual(ignored, [
    ["user", { bwrapPath: "/opt/bwrap" }],
    ["local", { bwrapPath: "/tmp/bwrap" }],
    ["local", { network: { tlsTerminate: true } }],
    ["local", { filesystem: { disabled: true } }],
    ["local", { credentials: { files: [{ path: "~/.netrc", mode: "mask" }] } }],
  ]);
});

test("once managed settings configure the sandbox filesystem, only they can turn it off", () => {
  const { value, ignored } = sandboxOf({
    managed: { sandbox: { filesystem: { denyRead: ["~/.ssh"] } } },
    user: { sandbox: { filesystem: { disabled: true } } },
  });

  assert.deepEqual(value.filesystem, { denyRead: ["~/.ssh"] });
  assert.deepEqual(ignored, [["user", { filesystem: { disabled: true } }]]);
});

test("managed denied domains or your strictAllowlist stop a repository's proxy ports and domains", () => {
  const project = { sandbox: { network: { allowedDomains: ["x.example"], socksProxyPort: 1080 } } };

  const denied = sandboxOf({
    managed: { permissions: { deny: ["WebFetch(domain:evil.example)"] } },
    project,
  });
  assert.deepEqual(denied.value.network, { allowedDomains: ["x.example"] });

  const strict = sandboxOf({ user: { sandbox: { network: { strictAllowlist: true } } }, project });
  assert.deepEqual(strict.value.network, { strictAllowlist: true });
  assert.deepEqual(strict.ignored, [
    ["project", { network: { allowedDomains: ["x.example"] } }],
    ["project", { network: { socksProxyPort: 1080 } }],
  ]);
});

test("under blockReadsOutsideWorkingDirectories, repository allowRead and allowWrite entries do not count", () => {
  const project = {
    sandbox: { filesystem: { allowRead: ["~/src"], allowWrite: ["~/out"], denyRead: ["~/.env"] } },
  };

  const blocked = sandboxOf({
    user: { permissions: { blockReadsOutsideWorkingDirectories: true } },
    project,
  });
  assert.deepEqual(blocked.value.filesystem, { denyRead: ["~/.env"] });

  // With filesystem isolation off, the block does not reach sandboxed commands.
  const off = sandboxOf({
    user: {
      permissions: { blockReadsOutsideWorkingDirectories: true },
      sandbox: { filesystem: { disabled: true } },
    },
    project,
  });
  assert.deepEqual(off.ignored, []);
});

test("server-managed settings or a macOS profile on disk are named above the managed files ccdesk reads", async () => {
  const f = makeFixture();
  const profile = f.at("Library/Managed Preferences/com.anthropic.claudecode.plist");
  const env = { ...f.env, managedProfiles: [profile] };
  f.json("etc/claude-code/managed-settings.json", { model: "opus" });
  const higher = async () =>
    (await scanDirectory(env, f.at("app"))).settings.find((l) => l.scope === "managed")
      ?.higherSources;

  assert.equal(await higher(), undefined);

  // Claude Code keeps the server-managed settings it fetched in the Claude folder.
  f.json("home/.claude/remote-settings.json", { permissions: { deny: ["Bash(curl:*)"] } });
  f.write(profile, "<plist/>");
  assert.deepEqual(await higher(), [f.at("home/.claude/remote-settings.json"), profile]);
});

test("a project or local env waits for the trust dialog in an interactive session; claude -p applies it", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { env: { FAKE_USER_FLAG: "1" } });
  f.json("app/.claude/settings.json", { env: { FAKE_PROJECT_FLAG: "fake-project-value" } });
  f.json("app/.claude/settings.local.json", { env: { FAKE_LOCAL_FLAG: "fake-local-value" } });
  const env = async (profile: "interactive" | "print") => {
    const view = await scanDirectory(f.env, f.at("app"), profile);
    assert.ok(!JSON.stringify(view).includes("fake-project-value"));
    return setting(view, "env");
  };

  const held = await env("interactive");
  assert.deepEqual(Object.keys(held?.value as object), ["FAKE_USER_FLAG"]);
  assert.deepEqual(
    held?.ignored.map((i) => [i.scope, i.waitsForTrust]),
    [
      ["project", true],
      ["local", true],
    ]
  );

  const print = await env("print");
  assert.deepEqual(Object.keys(print?.value as object).sort(), [
    "FAKE_LOCAL_FLAG",
    "FAKE_PROJECT_FLAG",
    "FAKE_USER_FLAG",
  ]);
  assert.deepEqual(print?.ignored, []);
});

test("env variables a repository may not set, or no file may set, are ignored by name", async () => {
  const f = makeFixture();
  // Trusted, so only the per-variable rules hold values back.
  f.json("home/.claude.json", { projects: { [f.at("app")]: { hasTrustDialogAccepted: true } } });
  f.json("home/.claude/settings.json", {
    env: { HOME: "/fake/user-home", CLAUDE_CODE_RESTRICTED: "1", FAKE_TOOL_FLAG: "1" },
  });
  f.json("app/.claude/settings.json", {
    env: {
      HOME: "/fake/project-home",
      XDG_CACHE_HOME: "/fake/cache",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-fake=1",
      // The exporter selectors are off only as "none"; the OTEL_LOG_* switches take any casing.
      OTEL_LOGS_EXPORTER: "None",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_LOG_USER_PROMPTS: "Off",
      OTEL_LOG_TOOL_DETAILS: "1",
      DISABLE_AUTO_COMPACT: "1",
    },
  });
  f.json("app/.claude/settings.local.json", { env: { CLAUDE_CONFIG_DIR: "/fake/config" } });

  const env = setting(await scanDirectory(f.env, f.at("app")), "env");

  // Only off values of the telemetry group still apply from a repository.
  assert.deepEqual(Object.keys(env?.value as object).sort(), [
    "DISABLE_AUTO_COMPACT",
    "FAKE_TOOL_FLAG",
    "HOME",
    "OTEL_LOG_USER_PROMPTS",
    "OTEL_METRICS_EXPORTER",
  ]);
  assert.deepEqual(env?.from, ["user", "project"]);
  assert.deepEqual(
    env?.ignored.map((i) => [i.scope, Object.keys(i.value as object)]),
    [
      ["user", ["CLAUDE_CODE_RESTRICTED"]],
      [
        "project",
        [
          "HOME",
          "XDG_CACHE_HOME",
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
          "OTEL_LOGS_EXPORTER",
          "OTEL_LOG_TOOL_DETAILS",
        ],
      ],
      ["local", ["CLAUDE_CONFIG_DIR"]],
    ]
  );
  assert.ok(!JSON.stringify(env).includes("/fake/"));
});

test("each model's effort comes from the highest file that sets it, capped at the lowest cap of any file", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    modelSettings: {
      "claude-opus-5-5": { maxEffortLevel: "low" },
      "claude-sonnet-5": { effortLevel: "xhigh", maxEffortLevel: "max", autoCompactWindow: 200000 },
    },
  });
  // A top-level effortLevel in project settings applies to every model, so it outranks the level
  // you saved for Sonnet in user settings; its cap holds although your entry exempts Sonnet.
  f.json("app/.claude/settings.json", { effortLevel: "low", maxEffortLevel: "medium" });
  f.json("app/.claude/settings.local.json", {
    modelSettings: { "claude-opus-5-5": { effortLevel: "high" } },
  });

  const models = setting(await scanDirectory(f.env, f.at("app")), "modelSettings");

  assert.deepEqual(models?.value, {
    "claude-opus-5-5": { effortLevel: "high", maxEffortLevel: "low" },
    "claude-sonnet-5": { maxEffortLevel: "medium", autoCompactWindow: 200000 },
  });
  assert.deepEqual(models?.overridden, [
    { scope: "user", value: { "claude-sonnet-5": { effortLevel: "xhigh" } } },
  ]);
});

test("a saved model effort a higher file's top-level effortLevel overrides comes with the reason", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    modelSettings: { "claude-sonnet-5": { effortLevel: "xhigh" } },
  });
  f.json("app/.claude/settings.json", { effortLevel: "low" });

  const models = setting(await scanDirectory(f.env, f.at("app")), "modelSettings");

  assert.deepEqual(models?.overridden, [
    { scope: "user", value: { "claude-sonnet-5": { effortLevel: "xhigh" } } },
  ]);
  assert.match(models?.note ?? "", /highest file/);
});

test("a project file with a value the schema rejects is skipped whole and reported, not shown in effect", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", { model: "opus" });
  f.json("app/.claude/settings.json", {
    model: "sonnet",
    permissions: { deny: ["Read"], defaultMode: "manual" },
    cleanupPeriodDays: "forever",
  });
  // "manual" is a documented alias for "default", not an error.
  f.json("app/.claude/settings.local.json", { permissions: { defaultMode: "manual" } });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(setting(view, "model")?.value, "opus");
  assert.ok(!view.permissions.some((p) => p.kind === "rule" && p.rule === "Read"));
  const problem = view.problems.find((p) => p.path === f.at("app/.claude/settings.json"));
  assert.match(problem?.error ?? "", /cleanupPeriodDays/);
  assert.match(problem?.error ?? "", /claude -p/);
  assert.deepEqual(
    view.problems.map((p) => p.path),
    [f.at("app/.claude/settings.json")]
  );
});

test("managed settings that fail validation are read as Claude Code repairs them, and each repair is listed", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", {
    allowedMcpServers: "mistyped",
    allowManagedHooksOnly: "true",
    allowManagedPermissionRulesOnly: "yes",
    disableAllHooks: "true",
    model: null,
    cleanupPeriodDays: "forever",
    forceLoginOrgUUID: 7,
    env: "FAKE_TOKEN=fake-secret-value",
    permissions: { deny: "Bash", allow: ["Read", 3], defaultMode: "careful" },
    autoMode: { soft_deny: ["force push", 1], allow: ["tests"], environment: ["ci"] },
    sandbox: {
      enabled: "yes",
      allowUnsandboxedCommands: "false",
      failIfUnavailable: "maybe",
      excludedCommands: [1],
      network: { deniedDomains: [1], allowedDomains: ["corp.example"] },
    },
  });
  f.json("home/.claude/settings.json", {
    model: "opus",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] },
  });
  f.json("home/.claude.json", { mcpServers: { db: { command: "db-mcp" } } });
  f.json("app/.claude/settings.json", { sandbox: { allowUnsandboxedCommands: true } });

  const view = await scanDirectory(f.env, f.at("app"), "print");
  const managed = view.settings.find((l) => l.scope === "managed");

  assert.deepEqual(managed?.data, {
    allowedMcpServers: [],
    allowManagedHooksOnly: true,
    allowManagedPermissionRulesOnly: true,
    permissions: { defaultMode: "default" },
    autoMode: { soft_deny: ["force push"] },
    sandbox: { enabled: true, allowUnsandboxedCommands: false },
  });
  assert.deepEqual(
    managed?.repairs?.map((r) => r.field),
    [
      "allowedMcpServers",
      "allowManagedHooksOnly",
      "allowManagedPermissionRulesOnly",
      "disableAllHooks",
      "model",
      "cleanupPeriodDays",
      "forceLoginOrgUUID",
      "env",
      "permissions.deny",
      "permissions.allow",
      "permissions.defaultMode",
      "permissions.allow",
      "autoMode.soft_deny",
      "autoMode.allow",
      "autoMode.environment",
      "sandbox.enabled",
      "sandbox.allowUnsandboxedCommands",
      "sandbox.failIfUnavailable",
      "sandbox.excludedCommands",
      "sandbox.network.deniedDomains",
      "sandbox.network.allowedDomains",
    ]
  );
  // What the file says stays visible beside each repair.
  assert.deepEqual(managed?.repairs?.[0]?.written, { allowedMcpServers: "mistyped" });
  assert.match(managed?.repairs?.[1]?.note ?? "", /quotes/);
  assert.ok(!JSON.stringify(view).includes("fake-secret-value"));

  assert.equal(setting(view, "model")?.value, "opus");
  assert.equal(view.inventory.mcpServers.find((s) => s.name === "db")?.status, "blocked");
  assert.match(view.inventory.hooks[0]?.note ?? "", /allowManagedHooksOnly/);
  const sandbox = setting(view, "sandbox");
  assert.deepEqual(
    sandbox?.ignored.map((i) => [i.scope, i.value]),
    [["project", { allowUnsandboxedCommands: true }]]
  );
});

test("a quoted managed allowManagedMcpServersOnly holds, an invalid deny list is dropped, and a damaged credential entry still denies", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", {
    allowManagedMcpServersOnly: "true",
    allowedMcpServers: [{ serverName: "corp" }],
    deniedMcpServers: "everything",
    sandbox: {
      credentials: {
        files: [{ path: "~/.aws/credentials", mode: "mask", extract: 5 }, { mode: "deny" }],
      },
    },
  });
  f.json("home/.claude/settings.json", { allowedMcpServers: [{ serverName: "db" }] });
  f.json("home/.claude.json", { mcpServers: { db: { command: "db-mcp" } } });

  const view = await scanDirectory(f.env, f.at("app"));
  const managed = view.settings.find((l) => l.scope === "managed");

  assert.equal(
    view.inventory.mcpServers.find((s) => s.name === "db")?.note,
    "Not in the managed allowedMcpServers"
  );
  assert.equal(managed?.data?.deniedMcpServers, undefined);
  assert.deepEqual(managed?.data?.sandbox, {
    credentials: { files: [{ path: "~/.aws/credentials", mode: "deny" }] },
  });
});

test("a nested field Claude Code tolerates or may skip leaves the rest of the file in effect", async () => {
  const f = makeFixture();
  // An unknown nested field is stripped, as Claude Code's settings check does for most objects.
  f.json("home/.claude/settings.json", {
    model: "opus",
    permissions: { deny: ["Bash"] },
    statusLine: { type: "command", command: "x", someNewerField: 1 },
  });
  // A nested value the schema rejects is reported; whether Claude Code skips it or the file is not settled.
  f.json("app/.claude/settings.json", {
    theme: "dark",
    permissions: { deny: ["Read"], defaultMode: "careful" },
  });

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(setting(view, "model")?.value, "opus");
  assert.equal(setting(view, "theme")?.value, "dark");
  const denied = view.permissions.flatMap((p) =>
    p.kind === "rule" && p.list === "deny" ? [p.rule] : []
  );
  assert.deepEqual(denied.sort(), ["Bash", "Read"]);
  assert.deepEqual(
    view.problems.map((p) => [p.path, p.partial ?? false]),
    [[f.at("app/.claude/settings.json"), true]]
  );
  assert.match(view.problems[0]?.error ?? "", /permissions\.defaultMode/);
});

test("a managed value of the wrong shape is dropped, and attribution is repaired field by field", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", {
    env: ["FAKE_TOKEN=fake-list-secret"],
    attribution: { commit: 5, pr: "Reviewed" },
    disableSideloadFlags: "true",
    strictPluginOnlyCustomization: ["skills", "bogus"],
  });

  const view = await scanDirectory(f.env, f.at("app"));
  const managed = view.settings.find((l) => l.scope === "managed");

  assert.deepEqual(managed?.data, {
    attribution: { pr: "Reviewed" },
    strictPluginOnlyCustomization: ["skills"],
  });
  assert.deepEqual(
    managed?.repairs?.map((r) => r.field),
    ["env", "attribution.commit", "disableSideloadFlags", "strictPluginOnlyCustomization"]
  );
  const note = (field: string) => managed?.repairs?.find((r) => r.field === field)?.note ?? "";
  // The docs name fail-closed Booleans only by example, so the page cannot say it is simply dropped.
  assert.match(note("disableSideloadFlags"), /fail-closed/);
  // An unknown surface is ignored, not stripped as invalid.
  assert.match(note("strictPluginOnlyCustomization"), /locks nothing/);
  assert.ok(!JSON.stringify(view).includes("fake-list-secret"));
});
