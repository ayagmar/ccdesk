import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createCore, RefusedError, storeDirName } from "../src/core/index.ts";
import { type Fixture, makeFixture } from "./helpers/fixture.ts";

// What createCore promises a front end beside the web server: each core keeps its own queue and
// cache, and finds editors and claude the way its env's platform does, not the test machine's.

const addServer = (f: Fixture) => ({
  dir: f.env.home,
  scope: "user" as const,
  add: { name: "api", definition: { command: "api-mcp" } },
});

test("a change on one core does not wait for a change on another", {
  timeout: 10_000,
}, async () => {
  // Catches cores sharing one change queue: the second save would wait behind the first, which
  // waits for the second, until the time limit fails the test.
  const a = makeFixture();
  const b = makeFixture();
  let release = () => {
    // Replaced by the promise's resolve below.
  };
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = createCore(a.env, {
    runClaude: async () => {
      await released;
      return "";
    },
  });
  const second = createCore(b.env);

  const add = addServer(a);
  const slow = first.saveMcpEdit(add, (await first.previewMcpEdit(add)).revision);
  const file = b.write("app/.claude/settings.json", '{ "permissions": { "allow": ["Read"] } }\n');
  const edit = { dir: b.at("app"), file, add: { list: "deny" as const, rule: "Read" } };
  await second.savePermissionEdit(edit, (await second.previewPermissionEdit(edit)).revision);
  release();
  await slow;

  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).permissions.deny, ["Read"]);
});

/** One Bash call, as a transcript line. */
function transcriptOf(tool: string): string {
  const content = [{ type: "tool_use", id: "toolu_1", name: tool, input: { command: "ls" } }];
  return `${JSON.stringify({ type: "assistant", timestamp: "2026-10-01T00:00:00.000Z", message: { role: "assistant", content } })}\n`;
}

test("one core's usage counts do not evict another core's cache", async () => {
  // Catches cores sharing one transcript cache: the second core's small limit would drop the
  // first core's transcripts, which are then read again from disk.
  const a = makeFixture();
  const b = makeFixture();
  const first = createCore(a.env);
  const second = createCore(b.env);
  const app = a.at("app");
  const file = a.write(
    join(a.env.claudeDir, "projects", storeDirName(app), "one.jsonl"),
    transcriptOf("Bash")
  );
  b.write(
    join(b.env.claudeDir, "projects", storeDirName(b.at("app")), "one.jsonl"),
    transcriptOf("Bash")
  );
  assert.equal((await first.readUsage(app, [])).tools[0]?.tool, "Bash");
  await second.readUsage(b.at("app"), [], { maxCachedCalls: 1 });

  // Rewritten in place with the same size and time, which only a fresh read notices.
  const { atime, mtime } = statSync(file);
  writeFileSync(file, transcriptOf("Read"));
  utimesSync(file, atime, mtime);

  assert.equal((await first.readUsage(app, [])).tools[0]?.tool, "Bash");
});

test("a core's usage count answers for no file its caller names, only its store's memories", async () => {
  // Catches readUsage letting the caller's options decide which files to count, so any front end
  // built on the package could learn whether and when Claude read any file, such as a .env.
  const f = makeFixture();
  const app = f.at("app");
  const secret = f.write("app/.env", "TOKEN=fake\n");
  const content = [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: secret } }];
  f.write(
    join(f.env.claudeDir, "projects", storeDirName(app), "one.jsonl"),
    `${JSON.stringify({ type: "assistant", timestamp: "2026-10-01T00:00:00.000Z", cwd: app, message: { content } })}\n`
  );

  const usage = await createCore(f.env).readUsage(app, [], { memories: [secret] } as never);

  assert.deepEqual(usage.memories, {});
});

test("a core never opens the credentials file, whatever opener it is given", async () => {
  // Catches the credentials check living only in the web server's route, so a CLI or library
  // front end calling core.openFile would open the file ccdesk promises never to read.
  const f = makeFixture();
  const opened: string[] = [];
  const core = createCore(f.env, {
    openFile: async (path) => {
      opened.push(path);
      return "fake";
    },
  });
  const credentials = f.write(join(f.env.claudeDir, ".credentials.json"), "{}");

  await assert.rejects(core.openFile(credentials), (error) => {
    assert.ok(error instanceof RefusedError);
    assert.equal(error.message, "ccdesk does not open credentials.");
    return true;
  });
  assert.deepEqual(opened, []);
});

test("an editor that will not start is refused with how to set one, not a server error", async () => {
  // Catches the failure being a plain Error, which the web server answers as a 500 with no hint
  // that CCDESK_EDITOR fixes it.
  const f = makeFixture();
  const env = { ...f.env, processEnv: { PATH: f.at("bin"), CCDESK_EDITOR: "no-such-editor" } };
  const target = f.write("app/CLAUDE.md", "# Rules\n");

  await assert.rejects(createCore(env).openFile(target), (error) => {
    assert.ok(error instanceof RefusedError);
    assert.match(error.message, /^Could not open it \(no-such-editor: .*\)\. Set CCDESK_EDITOR/);
    return true;
  });
});

// The fake programs are shell scripts.
const notOnWindows = { skip: process.platform === "win32" };

/**
 * A program that writes the arguments it got, one per line, after `$MARKER`, to `out`, then
 * creates `out.done`.
 */
function fakeProgram(f: Fixture, path: string, out: string): void {
  chmodSync(
    f.write(path, `#!/bin/sh\nprintf '%s\\n' "$MARKER" "$@" > '${out}'\n: > '${out}.done'\n`),
    0o755
  );
}

/**
 * What a fake program wrote, once it has finished. An editor counts as opened once it has run for a
 * while, so on a busy machine the fake may not have written anything yet when openFile resolves.
 */
async function writtenBy(out: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(`${out}.done`)) {
    if (Date.now() > deadline) throw new Error(`${out} was never written`);
    await sleep(20);
  }
  return readFileSync(out, "utf8");
}

test("a core for a Windows machine opens a .cmd editor through cmd.exe", notOnWindows, async () => {
  // Catches opening files with the test machine's platform or environment instead of the env's:
  // on Linux, code would be started directly and not be found.
  const f = makeFixture();
  const out = f.at("opened.txt");
  fakeProgram(f, "bin/cmd.exe", out);
  const env = {
    ...f.env,
    platform: "win32" as const,
    processEnv: { PATH: f.at("bin"), VISUAL: "code", MARKER: "from env" },
  };
  const target = f.write("app/CLAUDE.md", "# Rules\n");

  assert.equal(await createCore(env).openFile(target), "code");
  assert.deepEqual((await writtenBy(out)).split("\n"), [
    "from env",
    "/d",
    "/s",
    "/c",
    `""code" "${target}""`,
    "",
  ]);
});

test(
  "a core for a Windows machine runs the claude.exe behind npm's claude.cmd",
  notOnWindows,
  async () => {
    // Catches running claude with the test machine's platform or environment instead of the env's:
    // on Linux it would look for a program named claude, which is not there.
    const f = makeFixture();
    const out = f.at("ran.txt");
    f.write("npm/claude.cmd", "");
    fakeProgram(f, "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe", out);
    const env = {
      ...f.env,
      platform: "win32" as const,
      processEnv: { PATH: f.at("npm"), MARKER: "from env" },
    };
    const core = createCore(env);
    const add = addServer(f);

    await core.saveMcpEdit(add, (await core.previewMcpEdit(add)).revision);
    assert.deepEqual(readFileSync(out, "utf8").split("\n"), [
      "from env",
      "mcp",
      "add-json",
      "--scope",
      "user",
      "--",
      "api",
      '{"command":"api-mcp"}',
      "",
    ]);
  }
);

test("on Windows, a claude.cmd that npm did not install is named as the reason claude did not start", async () => {
  // Scoop, Volta and pnpm put a claude.cmd on PATH; Node cannot run one without a shell.
  const f = makeFixture();
  f.write("scoop/shims/claude.cmd", "");
  const env = { ...f.env, platform: "win32" as const, processEnv: { PATH: f.at("scoop/shims") } };
  const core = createCore(env);
  const add = addServer(f);

  await assert.rejects(
    core.saveMcpEdit(add, (await core.previewMcpEdit(add)).revision),
    (error) =>
      error instanceof RefusedError &&
      /could not start it from PATH.*claude\.cmd or claude\.ps1/.test(error.message)
  );
});
