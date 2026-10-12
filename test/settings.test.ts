import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDirectory } from "../src/server/scan/index.ts";
import { effectiveSettings } from "../src/server/scan/settings.ts";
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
