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
