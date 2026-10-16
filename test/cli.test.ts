import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { Agent, request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createCore, type DirectoryView } from "../src/core/index.ts";
import { DEV_PORT, HELP, parse, UsageError } from "../src/server/args.ts";
import {
  checkDirectory,
  compareJson,
  compareText,
  explainText,
  forgetDirectories,
  scanJson,
} from "../src/server/commands.ts";
import { storeDirName } from "../src/shared/memory.ts";
import { startServer } from "../src/server/start.ts";
import { type Fixture, makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

// What the `ccdesk` command promises: its flags and their errors, what its subcommands print, and a
// server another front end can start and stop. The bin itself only prints what these return.

test("with no flags ccdesk serves on a free port and opens the browser", () => {
  // Catches a default flipping, such as a fixed port that clashes or a browser that never opens.
  assert.deepEqual(parse([]), {
    command: "serve",
    port: 0,
    configDir: undefined,
    open: true,
    dev: false,
  });
});

test("the flags set the port, the Claude folder and whether to open a browser", () => {
  assert.deepEqual(parse(["--port", "8080", "--no-open", "--config-dir", "/srv/claude"]), {
    command: "serve",
    port: 8080,
    configDir: "/srv/claude",
    open: false,
    dev: false,
  });
  assert.deepEqual(parse(["-h"]), { command: "help" });
  assert.deepEqual(parse(["--port", "1", "--help"]), { command: "help" });
});

test("--dev listens on the port the UI dev server proxies to, unless --port says otherwise", () => {
  // Catches `pnpm dev` picking a free port, which `pnpm dev:ui` could not find.
  assert.deepEqual(parse(["--dev"]), {
    command: "serve",
    port: DEV_PORT,
    configDir: undefined,
    open: true,
    dev: true,
  });
  assert.deepEqual(parse(["--dev", "--port", "5000"]), {
    command: "serve",
    port: 5000,
    configDir: undefined,
    open: true,
    dev: true,
  });
});

test("a port that is not a whole number from 0 to 65535 is refused with the help text", () => {
  // Catches a typo such as --port 80800 or --port eighty being passed on to listen().
  for (const port of ["eighty", "80800", "-1", "1.5"])
    assert.throws(
      () => parse([`--port=${port}`]),
      (error) =>
        error instanceof UsageError && error.message === `ccdesk: invalid --port ${port}\n\n${HELP}`
    );
});

test("an unknown flag or argument is refused with the help text", () => {
  // Catches a mistyped flag such as --no-browser being ignored, which would open a browser anyway.
  for (const argv of [["--no-browser"], ["serve"], ["--port"]])
    assert.throws(
      () => parse(argv),
      (error) =>
        error instanceof UsageError &&
        error.message.startsWith("ccdesk: ") &&
        error.message.endsWith(HELP)
    );
});

test("scan and explain take their folder, file and Claude folder from the arguments", () => {
  // Catches an argument dropped or swapped, such as explain reading the file as the start folder.
  assert.deepEqual(parse(["scan", "--json"]), {
    command: "scan",
    dir: undefined,
    configDir: undefined,
  });
  assert.deepEqual(parse(["scan", "../app", "--json", "--config-dir", "/srv/claude"]), {
    command: "scan",
    dir: "../app",
    configDir: "/srv/claude",
  });
  assert.deepEqual(parse(["explain", "src/a.ts", "--dir", "../app"]), {
    command: "explain",
    file: "src/a.ts",
    dir: "../app",
    configDir: undefined,
  });
  assert.deepEqual(parse(["explain", "--help"]), { command: "help" });
});

test("a flag of another command, or a missing or extra argument, is refused with the help text", () => {
  // Catches `ccdesk --json` starting the page instead of failing, and `ccdesk scan --port 80` or
  // `ccdesk scan` without --json quietly doing something other than what was typed.
  for (const argv of [
    ["--json"],
    ["--dir", "app"],
    ["scan"],
    ["scan", "a", "b", "--json"],
    ["scan", "--json", "--port", "80"],
    ["scan", "--json", "--no-open"],
    ["explain"],
    ["explain", "a", "b"],
    ["explain", "a", "--json"],
  ])
    assert.throws(
      () => parse(argv),
      (error) =>
        error instanceof UsageError &&
        error.message.startsWith("ccdesk: ") &&
        error.message.endsWith(HELP),
      argv.join(" ")
    );
});

test("scan --json prints the directory's view with the values the page hides still hidden", async () => {
  // Catches the command printing what it read before redaction, such as an API key under env.
  const f = makeFixture();
  f.json("home/app/.claude/settings.json", {
    model: "opus",
    env: { API_KEY: "sk-live-0123456789abcdef" },
  });

  const out = await scanJson(createCore(f.env), f.at("home/app"));

  assert.ok(!out.includes("sk-live-0123456789abcdef"));
  const view = JSON.parse(out) as DirectoryView;
  assert.equal(view.path, f.at("home/app"));
  assert.equal(view.effective.find((e) => e.key === "model")?.value, "opus");
});

test("explain lists what a file brings in, relative to the start folder, with the globs that matched", async () => {
  // Catches a match missing its glob or its kind, paths printed in full, or a skill shown by its
  // file instead of its name.
  const f = makeFixture();
  f.write("home/app/.claude/rules/api.md", '---\npaths: ["src/api/**/*.ts"]\n---\nValidate.\n');
  f.write("home/app/src/CLAUDE.md", "Source rules.\n");
  f.write(
    "home/app/.claude/skills/migrate/SKILL.md",
    "---\nname: migrate\ndescription: DB migrations\npaths: src/api/**\n---\n"
  );
  f.write("home/app/src/api/users.ts", "");

  const text = await explainText(
    createCore(f.env),
    f.at("home/app"),
    f.at("home/app/src/api/users.ts")
  );

  assert.equal(
    text,
    [
      `Once Claude reads or edits ${join("src", "api", "users.ts")} in ${join("~", "app")}, these load:`,
      `  project  path rule            ${join(".claude", "rules", "api.md")}  matches src/api/**/*.ts`,
      `  project  folder instructions  ${join("src", "CLAUDE.md")}`,
      "  project  skill                migrate               matches src/api/**",
    ].join("\n")
  );
});

test("explain says when nothing more loads, and when the file is outside the start folder", async () => {
  // Catches a file outside the folder reported as matching nothing, which reads as "no rules apply"
  // when the folder's rules were never checked against it.
  const f = makeFixture();
  f.write("home/app/.claude/rules/api.md", '---\npaths: ["src/api/**"]\n---\nValidate.\n');
  const core = createCore(f.env);

  assert.equal(
    await explainText(core, f.at("home/app"), f.at("home/app/README.md")),
    "Nothing more loads for README.md (the file does not exist yet; paths are checked anyway)."
  );
  assert.equal(
    await explainText(core, f.at("home/app"), f.at("home/other/src/api/a.ts")),
    `${join("~", "other", "src", "api", "a.ts")} is outside ${join("~", "app")}, so nothing there applies to it.`
  );
});

test("check takes one folder and its own flags", () => {
  // Catches --strict or --all dropped on the way, which would make CI pass what it was told to fail,
  // and a flag of another command accepted and ignored.
  assert.deepEqual(parse(["check"]), {
    command: "check",
    dir: undefined,
    configDir: undefined,
    json: false,
    strict: false,
    all: false,
  });
  assert.deepEqual(parse(["check", "app", "--json", "--strict", "--all"]), {
    command: "check",
    dir: "app",
    configDir: undefined,
    json: true,
    strict: true,
    all: true,
  });
  for (const argv of [
    ["check", "a", "b"],
    ["check", "--dir", "a"],
    ["--strict"],
    ["scan", "--all"],
  ])
    assert.throws(() => parse(argv), UsageError, argv.join(" "));
});

/** A git repository at home/app, as a CI checkout is. */
function repository(): Fixture {
  const f = makeFixture();
  f.write("home/app/README.md", "An app.\n");
  f.git("home/app", "init", "--quiet");
  return f;
}

const check = (f: Fixture, dir: string, flags: { strict?: boolean; all?: boolean } = {}) =>
  checkDirectory(createCore(f.env), dir, { json: false, strict: false, all: false, ...flags });

test("check passes a clean repository on a machine with no Claude folder, as a CI runner has", async () => {
  // Catches a missing ~/.claude or ~/.claude.json reported as a problem, which would fail every CI run.
  const f = repository();
  f.json("home/app/.claude/settings.json", { permissions: { allow: ["Bash(npm test)"] } });
  f.json("home/app/.mcp.json", { mcpServers: { docs: { command: "docs-server" } } });
  const env = { ...f.env, home: f.at("runner"), claudeDir: f.at("runner/.claude") };
  env.claudeJson = join(env.home, ".claude.json");

  const result = await checkDirectory(createCore(env), f.at("home/app"), {
    json: false,
    strict: false,
    all: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.output, `No problems in a session started in ${f.at("home/app")}.`);
});

test("check fails on a broken .claude/settings.json and .mcp.json and names each file", async () => {
  // Catches the check passing a file Claude Code cannot parse, and a CI log that does not say which
  // file to fix.
  const f = repository();
  f.write("home/app/.claude/settings.json", '{ "model": "opus", }');
  f.write("home/app/.mcp.json", '{ "mcpServers": ');

  const result = await check(f, f.at("home/app"));

  assert.equal(result.exitCode, 1);
  const lines = result.output.split("\n");
  assert.equal(lines[0], "Claude Code cannot read these files and may skip them:");
  assert.ok(
    lines.some((l) => l.startsWith(`  ${join(".claude", "settings.json")}: `)),
    result.output
  );
  assert.ok(
    lines.some((l) => l.startsWith("  .mcp.json: ")),
    result.output
  );
  assert.equal(lines.at(-1), `2 problems in a session started in ${join("~", "app")}.`);
});

test("check counts only the repository's files unless --all, and lists what stops Claude Code first", async () => {
  // Catches a broken file in the runner's home failing the repository's check, and a file that keeps
  // Claude Code from starting listed below ones it merely skips.
  const f = repository();
  f.write("home/.claude/settings.json", "{");
  f.write("home/.claude.json", "not json");
  f.json("etc/claude-code/managed-settings.json", ["not", "an", "object"]);

  const repoOnly = await check(f, f.at("home/app"));
  assert.equal(repoOnly.exitCode, 0);
  assert.ok(
    repoOnly.output
      .split("\n")
      .includes(
        "Not counted: problems in 3 files of the Claude folder, ~/.claude.json, managed settings or outside the repository; --all counts them."
      ),
    repoOnly.output
  );

  f.write("home/app/.mcp.json", "{");
  const all = await check(f, f.at("home/app"), { all: true });
  assert.equal(all.exitCode, 1);
  const lines = all.output.split("\n");
  const headings = lines.filter((l) => l.endsWith(":") && !l.startsWith(" "));
  assert.deepEqual(headings, [
    "Claude Code will not start until these are fixed:",
    "Claude Code cannot read these files and may skip them:",
  ]);
  assert.match(lines[1] ?? "", /managed-settings\.json: /);
  assert.equal(lines.at(-1), `4 problems in a session started in ${join("~", "app")}.`);
});

test("check never counts the Claude folder or ~/.claude.json without --all, even inside the repository", async () => {
  // Catches a dotfiles repository at ~, or a container whose HOME is the checkout, failing on the
  // runner's own Claude files because they happen to sit under the git root.
  const f = makeFixture();
  f.write("home/README.md", "Dotfiles.\n");
  f.git("home", "init", "--quiet");
  f.write("home/.claude/settings.json", "{");
  f.write("home/.claude.json", "not json");

  const first = await check(f, f.at("home"));
  assert.equal(first.exitCode, 0);
  assert.ok(
    first.output
      .split("\n")
      .includes(
        "Not counted: problems in 2 files of the Claude folder, ~/.claude.json, managed settings or outside the repository; --all counts them."
      ),
    first.output
  );
  f.write("home/.mcp.json", "{");
  assert.equal((await check(f, f.at("home"))).exitCode, 1);
});

test("check in a linked worktree counts the main checkout's files it reads through to", async () => {
  // Catches a broken agent in the main checkout, which a session in the worktree loads, reported as
  // outside the repository and passed.
  const f = repository();
  f.git("home/app", "add", ".");
  f.git("home/app", "commit", "-qm", "init");
  f.git("home/app", "worktree", "add", "-q", f.at("home/app-feature"));
  const loop = f.at("home/app/.claude/agents/review.md");
  f.link(loop, loop);

  const result = await check(f, f.at("home/app-feature"));

  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes("review.md: cannot be read (ELOOP)"), result.output);
});

test("check words a JSON file it cannot open as it words any other, without Node's message", async () => {
  // Catches "Error: ELOOP: too many symbolic links encountered, open '/abs/path'" in a CI log, where
  // a CLAUDE.md in the same state reads "cannot be read (ELOOP)".
  const f = repository();
  const loop = f.at("home/app/.mcp.json");
  f.link(loop, loop);

  const { output } = await check(f, f.at("home/app"));

  assert.ok(output.split("\n").includes("  .mcp.json: cannot be read (ELOOP)"), output);
});

test("check exits 2, not 1, when it cannot run", async () => {
  // Catches a scan that throws read as "problems found", which sends a CI user looking for a broken
  // file that is not there.
  const f = makeFixture();

  const result = await check(f, f.at("home/gone"));

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /^ccdesk: ENOENT/);
});

test("check reports skipped entries without failing, unless --strict", async () => {
  // Catches the default failing CI over an entry Claude Code only skips, and --strict not failing it.
  const f = repository();
  f.json("home/app/.claude/settings.json", { permissions: { defaultMode: "careful" } });

  const lenient = await check(f, f.at("home/app"));
  assert.equal(lenient.exitCode, 0);
  const lines = lenient.output.split("\n");
  assert.equal(
    lines[0],
    "Claude Code may skip entries in these files (not counted; --strict counts them):"
  );
  assert.equal(lines.at(-1), `No counted problems in a session started in ${join("~", "app")}.`);
  assert.equal((await check(f, f.at("home/app"), { strict: true })).exitCode, 1);
});

test("check counts the repository's files when it is reached through a symlink", async () => {
  // Catches git's real root not matching the linked path, which would put every repository file
  // outside the repository and pass a broken one.
  const f = repository();
  f.write("home/app/.mcp.json", "{");
  f.link("home/linked", f.at("home/app"));

  assert.equal((await check(f, f.at("home/linked"))).exitCode, 1);
});

test("check --json prints each problem with its path and whether it counts", async () => {
  // Catches JSON a CI step cannot parse, such as text mixed in, or one that hides why it failed.
  const f = repository();
  f.write("home/app/.mcp.json", "{");
  f.write("home/.claude/settings.json", "{");

  const { output, exitCode } = await checkDirectory(createCore(f.env), f.at("home/app"), {
    json: true,
    strict: false,
    all: false,
  });
  const report = JSON.parse(output) as {
    root: string;
    failed: boolean;
    problems: Array<{ path: string; file: string; counted: boolean }>;
  };

  assert.equal(exitCode, 1);
  assert.equal(report.failed, true);
  assert.equal(report.root, f.at("home/app"));
  assert.deepEqual(report.problems.map((p) => [p.path, p.file, p.counted]).sort(), [
    [f.at("home/.claude/settings.json"), join("~", ".claude", "settings.json"), false],
    [f.at("home/app/.mcp.json"), ".mcp.json", true],
  ]);
});

test("check on a folder that does not exist is a usage error, not a pass", () => {
  // Catches a mistyped folder in a CI step scanning nothing and exiting 0.
  const cli = fileURLToPath(new URL("../src/server/cli.ts", import.meta.url));
  const run = spawnSync(
    process.execPath,
    [`--import=${import.meta.resolve("tsx")}`, cli, "check", "no-such-folder"],
    {
      cwd: makeFixture().root,
      encoding: "utf8",
    }
  );

  assert.equal(run.status, 2);
  assert.equal(run.stderr.trim(), "ccdesk: no-such-folder is not a folder");
});

test("compare takes two folders, and forget one folder or --all-gone, each with its own flags", () => {
  // Catches `ccdesk forget` with no folder forgetting every gone directory, or a flag of another
  // command such as --strict being ignored.
  assert.deepEqual(parse(["compare", "a", "b", "--all"]), {
    command: "compare",
    a: "a",
    b: "b",
    configDir: undefined,
    json: false,
    all: true,
  });
  assert.deepEqual(parse(["forget", "gone", "-y"]), {
    command: "forget",
    dir: "gone",
    configDir: undefined,
    yes: true,
  });
  assert.deepEqual(parse(["forget", "--all-gone"]), {
    command: "forget",
    dir: null,
    configDir: undefined,
    yes: false,
  });
  for (const argv of [
    ["compare", "a"],
    ["compare", "a", "b", "c"],
    ["compare", "a", "b", "--strict"],
    ["forget"],
    ["forget", "a", "b"],
    ["forget", "a", "--all-gone"],
    ["forget", "a", "--json"],
    ["check", "--yes"],
  ])
    assert.throws(
      () => parse(argv),
      (error) => error instanceof UsageError && error.message.endsWith(HELP),
      argv.join(" ")
    );
});

test("compare lists the settings that differ with the file behind each side, and hides hidden values", async () => {
  // Catches the two sides swapped, a value shown without the file it comes from, or a key under
  // env printed as written.
  const f = makeFixture();
  f.json("home/.claude/settings.json", { alwaysThinkingEnabled: true });
  f.json("home/a/.claude/settings.json", { model: "opus", env: { API_KEY: "sk-live-aaaa1111" } });
  f.json("home/b/.claude/settings.local.json", {
    model: "sonnet",
    env: { API_KEY: "sk-live-bbbb2222" },
  });
  const core = createCore(f.env);
  const [a, b] = [f.at("home/a"), f.at("home/b")];
  const project = join(".claude", "settings.json");
  const local = join(".claude", "settings.local.json");
  const user = join("~", ".claude", "settings.json");
  const [nameA, nameB] = [join("~", "a"), join("~", "b")];

  const differ = [
    `Settings that differ between ${nameA} and ${nameB}:`,
    "  env  (the hidden values differ)",
    `    ${nameA}  { API_KEY: "•••" }  (project ${project})`,
    `    ${nameB}  { API_KEY: "•••" }  (local ${local})`,
    "  model",
    `    ${nameA}  opus    (project ${project})`,
    `    ${nameB}  sonnet  (local ${local})`,
    "",
  ];
  assert.equal(
    await compareText(core, a, b, false),
    [...differ, "Same in both: 1 setting; --all lists them."].join("\n")
  );
  assert.equal(
    await compareText(core, a, b, true),
    [
      ...differ,
      "Settings both share:",
      "  alwaysThinkingEnabled",
      `    ${nameA}  true  (user ${user})`,
      `    ${nameB}  true  (user ${user})`,
    ].join("\n")
  );
  assert.ok(!(await compareJson(core, a, b)).includes("sk-live-"));
});

/** A directory Claude Code was used in, with two sessions and a memory, whose folder is gone. */
function goneDirectory(f: Fixture, name: string): { dir: string; store: string } {
  const dir = f.at("work", name);
  const store = join(f.env.claudeDir, "projects", storeDirName(dir));
  for (const session of ["a", "b"])
    f.write(join(store, `${session}.jsonl`), `${JSON.stringify({ type: "user", cwd: dir })}\n`);
  f.write(`${memoryDirFor(f, dir)}/note.md`, memoryFile("note", "user", "d", "body"));
  return { dir, store };
}

test("forget shows what it would move before asking, and moves nothing when told no", async () => {
  // Catches the store moving before the question, or a "no" that still forgets.
  const f = makeFixture();
  const { dir, store } = goneDirectory(f, "deleted");
  const launch = f.at("home");
  let asked = "";

  const result = await forgetDirectories(
    createCore(f.env),
    [dir],
    launch,
    async (review, question) => {
      assert.ok(existsSync(store));
      asked = `${review}\n${question}`;
      return false;
    }
  );

  assert.match(asked, /2 sessions, 1 memory, [\d.]+ KB/);
  assert.ok(asked.endsWith(`Forget ${f.at("work", "deleted")}?`));
  assert.deepEqual(result, { output: "Nothing forgotten.", exitCode: 1 });
  assert.ok(existsSync(store));
});

test("forget --all-gone forgets every directory whose folder is gone, and leaves the others", async () => {
  // Catches a directory whose folder still exists being forgotten with the gone ones.
  const f = makeFixture();
  const gone = [goneDirectory(f, "one"), goneDirectory(f, "two")];
  const kept = goneDirectory(f, "kept");
  mkdirSync(kept.dir, { recursive: true });
  const core = createCore(f.env);
  let question = "";

  const result = await forgetDirectories(core, null, f.at("home"), async (_review, q) => {
    question = q;
    return true;
  });

  assert.equal(question, "Forget 2 directories?");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    gone.map(({ store }) => existsSync(store)),
    [false, false]
  );
  assert.ok(existsSync(kept.store));
  const listed = (await core.scanOverview(f.at("home"))).projects.map((p) => p.path);
  assert.deepEqual(
    [...gone, kept].map(({ dir }) => listed.includes(dir)),
    [false, false, true]
  );
});

test("forget refuses a folder that exists without asking, and says why", async () => {
  // Catches a typo'd path to a live project being offered for forgetting.
  const f = makeFixture();
  const { dir, store } = goneDirectory(f, "alive");
  mkdirSync(dir, { recursive: true });

  const result = await forgetDirectories(createCore(f.env), [dir], f.at("home"), () =>
    assert.fail("asked to forget a folder that exists")
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /exists; ccdesk forgets only a directory whose folder is gone/);
  assert.ok(existsSync(store));
});

test("forget without a terminal needs --yes rather than waiting for an answer", () => {
  // Catches a script hanging on a question nobody can answer.
  const cli = fileURLToPath(new URL("../src/server/cli.ts", import.meta.url));
  const run = spawnSync(
    process.execPath,
    [`--import=${import.meta.resolve("tsx")}`, cli, "forget", "--all-gone"],
    { cwd: makeFixture().root, encoding: "utf8", input: "y\n" }
  );

  assert.equal(run.status, 2);
  assert.match(run.stderr, /pass --yes/);
});

/** GET `path` on the server at `url` with the token from its fragment; resolves the status. */
function get(url: string, path: string, agent?: Agent): Promise<number> {
  const token = new URL(url).hash.replace("#token=", "");
  return new Promise((resolve, reject) => {
    request(new URL(path, url), { headers: { "x-ccdesk-token": token }, agent }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    })
      .on("error", reject)
      .end();
  });
}

test("startServer serves the core at the URL it returns and close stops it, open tabs included", async () => {
  // Catches a URL with the wrong port or token, and close() hanging while a browser tab keeps a
  // connection open, which would leave Ctrl+C waiting.
  const fixture = makeFixture();
  const server = await startServer({
    core: createCore(fixture.env),
    launchDir: fixture.at("home"),
    token: "secret",
    uiDir: null,
    port: 0,
  });
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/#token=secret$/);
  const tab = new Agent({ keepAlive: true });
  assert.equal(await get(server.url, "/api/overview", tab), 200);
  assert.equal(await get(server.url, "/", tab), 404, "with uiDir null, the UI is not served");

  await server.close();
  tab.destroy();
  await assert.rejects(get(server.url, "/api/overview"), { code: "ECONNREFUSED" });
});

test("startServer rejects when the port is taken, so the command can say so", async () => {
  // Catches a listen error left unhandled, which would crash instead of reporting the port.
  const fixture = makeFixture();
  const options = {
    core: createCore(fixture.env),
    launchDir: fixture.at("home"),
    token: "t",
    uiDir: null,
  };
  const first = await startServer({ ...options, port: 0 });
  const port = Number(new URL(first.url).port);
  await assert.rejects(startServer({ ...options, port }), { code: "EADDRINUSE" });
  await first.close();
});
