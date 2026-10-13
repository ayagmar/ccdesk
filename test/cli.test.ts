import assert from "node:assert/strict";
import { Agent, request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { createCore, type DirectoryView } from "../src/core/index.ts";
import { DEV_PORT, HELP, parse, UsageError } from "../src/server/args.ts";
import { explainText, scanJson } from "../src/server/commands.ts";
import { startServer } from "../src/server/start.ts";
import { makeFixture } from "./helpers/fixture.ts";

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
