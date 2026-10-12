import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listBackups, previewRestore } from "../src/server/backups.ts";
import { claudeProgram, previewMcpEdit, runClaude, saveMcpEdit } from "../src/server/mcp-edit.ts";
import { scanEnvFromProcess } from "../src/server/scan/env.ts";
import { makeFixture } from "./helpers/fixture.ts";

// The fake claude is a shell script.
const notOnWindows = { skip: process.platform === "win32" };

test(
  "a failed claude command reports why without repeating the server's secrets",
  notOnWindows,
  async () => {
    const f = makeFixture();
    chmodSync(f.write("bin/claude", "#!/bin/sh\nexit 3\n"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = f.at("bin");
    try {
      const definition = { command: "db-mcp", env: { DB_PASSWORD: "s3cret" } };
      await assert.rejects(
        runClaude(
          ["mcp", "add-json", "--scope", "user", "--", "db", JSON.stringify(definition)],
          f.at(),
          undefined
        ),
        (error: Error) => {
          assert.doesNotMatch(error.message, /s3cret/);
          assert.match(error.message, /exited with code 3/);
          return true;
        }
      );
    } finally {
      process.env.PATH = path;
    }
  }
);

test(
  "claude's own error message is passed on with the server's secrets hidden",
  notOnWindows,
  async () => {
    const f = makeFixture();
    chmodSync(f.write("bin/claude", '#!/bin/sh\necho "invalid server: $*" >&2\nexit 1\n'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = f.at("bin");
    try {
      const definition = {
        type: "http",
        url: "https://bot:hunter2@mcp.example.com/?key=abc123",
        headers: { Authorization: "Bearer tok-999" },
        command: "npx",
        args: ["--api-key", "arg-777", "--token=arg-888"],
      };
      await assert.rejects(
        runClaude(["mcp", "add-json", "--", "api", JSON.stringify(definition)], f.at(), undefined),
        (error: Error) => {
          assert.match(error.message, /invalid server/);
          assert.doesNotMatch(error.message, /hunter2|abc123|tok-999|arg-777|arg-888/);
          return true;
        }
      );
    } finally {
      process.env.PATH = path;
    }
  }
);

test(
  "claude changes the profile chosen with --config-dir, not the one the shell names",
  notOnWindows,
  async () => {
    const f = makeFixture();
    chmodSync(f.write("bin/claude", '#!/bin/sh\necho "profile=$CLAUDE_CONFIG_DIR"\n'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = f.at("bin");
    process.env.CLAUDE_CONFIG_DIR = f.at("shell-profile");
    try {
      const chosen = scanEnvFromProcess(f.at("work-profile")).configDir;
      assert.equal(
        (await runClaude(["mcp", "list"], f.at(), chosen)).trim(),
        `profile=${f.at("work-profile")}`
      );
      delete process.env.CLAUDE_CONFIG_DIR;
      // With no profile chosen, claude finds ~/.claude.json itself, as from a terminal.
      const none = scanEnvFromProcess().configDir;
      assert.equal((await runClaude(["mcp", "list"], f.at(), none)).trim(), "profile=");
    } finally {
      process.env.PATH = path;
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  }
);

test("with a chosen profile, the claude commands ccdesk shows and records name it", async () => {
  const f = makeFixture();
  const configDir = f.at("work profile");
  const env = {
    ...f.env,
    configDir,
    claudeDir: configDir,
    claudeJson: join(configDir, ".claude.json"),
  };
  f.write(env.claudeJson, JSON.stringify({ mcpServers: { api: { command: "api-mcp" } } }));
  const edit = {
    dir: f.env.home,
    scope: "user" as const,
    remove: { name: "api", definition: { command: "api-mcp" } },
  };
  const ran = async () => "";
  const profile = `CLAUDE_CONFIG_DIR='${configDir}' claude mcp`;

  const preview = await previewMcpEdit(env, edit, ran);
  assert.deepEqual(preview.commands, [`${profile} remove --scope user -- 'api'`]);
  await saveMcpEdit(env, edit, preview.revision, ran);
  const [change] = (await listBackups(env, { limit: 1 })).changes;
  assert.ok(change);
  assert.deepEqual((await previewRestore(env, change.id)).undoCommands, [
    `${profile} add-json --scope user -- 'api' '{"command":"api-mcp"}'`,
  ]);
});

test("on Windows, an npm install of Claude Code runs the claude.exe its claude.cmd starts", async () => {
  const f = makeFixture();
  const npm = f.at("npm");
  f.write("npm/claude.cmd", "");
  const exe = f.write("npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe", "");
  const native = f.at("native");
  f.write("native/claude.exe", "");
  const path = (...dirs: string[]) => dirs.join(process.platform === "win32" ? ";" : ":");

  assert.equal(await claudeProgram(path(f.at("empty"), npm), "win32"), exe);
  // Windows reads a quoted PATH entry as the folder inside the quotes.
  assert.equal(await claudeProgram(path(`"${npm}"`), "win32"), exe);
  // Whichever comes first on PATH wins, as in a terminal.
  assert.equal(await claudeProgram(path(native, npm), "win32"), join(native, "claude.exe"));
  assert.equal(await claudeProgram(path(npm), "linux"), "claude");
});
