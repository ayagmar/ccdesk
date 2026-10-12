import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { claudeProgram, runClaude } from "../src/server/mcp-edit.ts";
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
          f.at()
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
      };
      await assert.rejects(
        runClaude(["mcp", "add-json", "--", "api", JSON.stringify(definition)], f.at()),
        (error: Error) => {
          assert.match(error.message, /invalid server/);
          assert.doesNotMatch(error.message, /hunter2|abc123|tok-999/);
          return true;
        }
      );
    } finally {
      process.env.PATH = path;
    }
  }
);

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
