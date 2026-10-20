import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createCore } from "../src/core/index.ts";
import { parse } from "../src/server/args.ts";
import { checkDirectory } from "../src/server/commands.ts";
import { changeHook, hookCommand, sessionCheck } from "../src/server/hook.ts";
import { type Fixture, makeFixture } from "./helpers/fixture.ts";

// The session check: a SessionStart hook that warns when what a new session loads has problems.
// What it prints must never reach Claude's context, and installing it must change only its own entry.

const input = (cwd: string) =>
  JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd });

function project(f: Fixture): string {
  f.write("home/app/README.md", "An app.\n");
  f.git("home/app", "init", "--quiet");
  return f.at("home/app");
}

const userSettings = (f: Fixture) =>
  JSON.parse(readFileSync(join(f.env.claudeDir, "settings.json"), "utf8")) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };

test("hook takes one of --install, --remove or --run, and --run takes nothing else", () => {
  // Catches a hook that installs when asked to run, or a --run that waits on a folder argument.
  assert.deepEqual(parse(["hook", "--install", "--project", "app", "-y"]), {
    command: "hook",
    action: "install",
    project: true,
    dir: "app",
    configDir: undefined,
    yes: true,
  });
  assert.equal((parse(["hook", "--run"]) as { action: string }).action, "run");
  for (const args of [["hook"], ["hook", "--install", "--remove"], ["hook", "--run", "--project"]])
    assert.throws(() => parse(args), /hook/, args.join(" "));
});

test("the session check prints nothing when what the session loads is fine", async () => {
  // Catches a hook that writes on every start: plain stdout would go into Claude's context.
  const f = makeFixture();
  const dir = project(f);
  f.json("home/app/.claude/settings.json", { model: "opus" });

  assert.equal(await sessionCheck(createCore(f.env), input(dir)), "");
});

test("the session check answers only with a systemMessage that names each problem and its file", async () => {
  // Catches text outside the JSON, which Claude Code would add to Claude's context, and a warning
  // that does not say which file to fix.
  const f = makeFixture();
  const dir = project(f);
  f.json("home/app/.claude/settings.local.json", { autoMode: { classifyAllShell: true } });
  f.write("home/app/.mcp.json", "{");

  const output = await sessionCheck(createCore(f.env), input(dir));
  const parsed = JSON.parse(output) as Record<string, string>;

  assert.deepEqual(Object.keys(parsed), ["systemMessage"]);
  const lines = (parsed.systemMessage ?? "").split("\n");
  assert.equal(lines[0], "ccdesk found 2 problems in what this session loads:");
  assert.ok(
    lines.some((l) => l.startsWith("  .mcp.json: ")),
    output
  );
  assert.ok(
    lines.includes(
      `  ${join(".claude", "settings.local.json")}: autoMode (Claude Code reads this key only from managed or user settings)`
    ),
    output
  );
  assert.equal(lines.at(-1), "Run npx ccdesk here to see and fix them.");
});

test("the hook command prints one JSON object or nothing at all on stdout", () => {
  // Catches a stray line from the command itself, which Claude Code would add to Claude's context.
  const f = makeFixture();
  const dir = project(f);
  const cli = fileURLToPath(new URL("../src/server/cli.ts", import.meta.url));
  const run = (cwd: string) =>
    spawnSync(process.execPath, [`--import=${import.meta.resolve("tsx")}`, cli, "hook", "--run"], {
      cwd: f.root,
      encoding: "utf8",
      input: input(cwd),
      env: { ...process.env, HOME: f.at("home") },
    });

  const clean = run(dir);
  assert.deepEqual([clean.status, clean.stdout], [0, ""]);

  f.json("home/app/.claude/settings.local.json", { autoMode: {} });
  const warned = run(dir);
  assert.equal(warned.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(warned.stdout)), ["systemMessage"]);
});

test("an ignored setting is blamed on the file that holds it, and env names never their values", async () => {
  // Catches a local file in the start folder reported as the repository's, which does not exist,
  // and an env value printed in a CI log or a session message.
  const f = makeFixture();
  project(f);
  f.json("home/app/sub/.claude/settings.local.json", {
    autoMode: {},
    env: { CLAUDE_CODE_PROJECT_DIR_NAME: "secret-value" },
  });

  const { output } = await checkDirectory(createCore(f.env), f.at("home/app/sub"), {
    json: true,
    strict: false,
    all: false,
  });
  const report = JSON.parse(output) as { problems: Array<{ path: string; setting?: string }> };

  assert.ok(!output.includes("secret-value"), output);
  assert.deepEqual(report.problems.map((p) => [p.setting, p.path]).sort(), [
    ["autoMode", f.at("home/app/sub/.claude/settings.local.json")],
    ["env CLAUDE_CODE_PROJECT_DIR_NAME", f.at("home/app/sub/.claude/settings.local.json")],
  ]);
});

test("a value that managed settings overrule is not a problem in the file it is in", async () => {
  // Catches a repository's availableModels failing the check, and nagging every session, on a
  // machine whose organisation sets its own list, where no edit to the repository would help.
  const f = makeFixture();
  const dir = project(f);
  f.json("etc/claude-code/managed-settings.json", { availableModels: ["opus"] });
  f.json("home/app/.claude/settings.json", { availableModels: ["sonnet"] });

  assert.equal(await sessionCheck(createCore(f.env), input(dir)), "");
});

test("the session check lists five problems and counts the rest", async () => {
  // Catches a warning that grows with every problem and pushes the session off the screen.
  const f = makeFixture();
  const dir = project(f);
  f.json("home/app/.claude/settings.local.json", {
    autoMode: {},
    autoContinueAtUsageLimit: true,
    bashEditDiffEnabled: true,
    desktopSessionCleanupPeriodDays: 7,
    dialogExpiry: "60s",
    skipAutoPermissionPrompt: true,
    askUserQuestionTimeout: "60s",
  });

  const message = (
    JSON.parse(await sessionCheck(createCore(f.env), input(dir))) as {
      systemMessage: string;
    }
  ).systemMessage;

  const listed = message.split("\n").filter((l) => l.startsWith("  "));
  assert.equal(listed.length, 6, message);
  assert.equal(listed.at(-1), "  and 2 more");
});

test("installing adds one startup hook to user settings, and installing again changes nothing", async () => {
  // Catches a second install adding a second hook, which would warn twice at every start.
  const f = makeFixture();
  const dir = project(f);
  const core = createCore(f.env);
  let asked = "";
  const yes = async (review: string) => {
    asked = review;
    return true;
  };

  const first = await changeHook(
    core,
    { dir, scope: "user", remove: false, version: "1.2.3" },
    yes
  );
  assert.equal(first.exitCode, 0, first.output);
  assert.match(asked, /\+ .*"command": "npx -y ccdesk@1\.2\.3 hook --run"/);
  const groups = userSettings(f).hooks?.SessionStart ?? [];
  assert.deepEqual(
    groups.map((g) => [g.matcher, g.hooks.map((h) => h.command)]),
    [["startup", [hookCommand("1.2.3")]]]
  );

  const again = await changeHook(
    core,
    { dir, scope: "user", remove: false, version: "1.2.3" },
    yes
  );
  assert.deepEqual(again, {
    output: `The session check is already in ${join("~", ".claude", "settings.json")}.`,
    exitCode: 0,
  });
});

test("installing a newer version replaces the old session check, and removing leaves other hooks", async () => {
  // Catches an upgrade that leaves the old pin running beside the new one, and a remove that takes
  // the user's own SessionStart hooks with it.
  const f = makeFixture();
  const dir = project(f);
  f.json("home/.claude/settings.json", {
    hooks: {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [
            { type: "command", command: "echo mine" },
            { type: "command", command: hookCommand("1.0.0") },
          ],
        },
      ],
    },
  });
  const core = createCore(f.env);
  const yes = async () => true;

  await changeHook(core, { dir, scope: "user", remove: false, version: "2.0.0" }, yes);
  const commands = () =>
    (userSettings(f).hooks?.SessionStart ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(commands(), ["echo mine", hookCommand("2.0.0")]);

  const removed = await changeHook(
    core,
    { dir, scope: "user", remove: true, version: "3.0.0" },
    yes
  );
  assert.equal(removed.exitCode, 0, removed.output);
  assert.deepEqual(commands(), ["echo mine"]);
});

test("installing takes out every older session check, whatever its matcher", async () => {
  // Catches an upgrade that replaces one old pin and leaves another, so every session warns twice.
  const f = makeFixture();
  const dir = project(f);
  const old = (matcher: string, version: string) => ({
    matcher,
    hooks: [{ type: "command", command: hookCommand(version) }],
  });
  f.json("home/.claude/settings.json", {
    hooks: { SessionStart: [old("resume", "0.1.0"), old("startup", "0.2.0")] },
  });

  const yes = async () => true;
  await changeHook(createCore(f.env), { dir, scope: "user", remove: false, version: "1.0.0" }, yes);

  const groups = userSettings(f).hooks?.SessionStart ?? [];
  assert.deepEqual(
    groups.flatMap((g) => g.hooks.map((h) => [g.matcher, h.command])),
    [["startup", hookCommand("1.0.0")]]
  );
});

test("--project installs in the repository's settings, and a no leaves the file alone", async () => {
  // Catches a project install landing in user settings, and a declined review that still writes.
  const f = makeFixture();
  const dir = project(f);
  const core = createCore(f.env);

  const declined = await changeHook(
    core,
    { dir, scope: "project", remove: false, version: "1.0.0" },
    async () => false
  );
  assert.equal(declined.exitCode, 1);
  assert.throws(() => readFileSync(f.at("home/app/.claude/settings.json")));

  await changeHook(
    core,
    { dir, scope: "project", remove: false, version: "1.0.0" },
    async () => true
  );
  const written = JSON.parse(readFileSync(f.at("home/app/.claude/settings.json"), "utf8"));
  assert.equal(written.hooks.SessionStart[0].hooks[0].command, hookCommand("1.0.0"));
});
