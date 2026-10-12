import assert from "node:assert/strict";
import { Agent, request } from "node:http";
import { test } from "node:test";
import { createCore } from "../src/core/index.ts";
import { DEV_PORT, HELP, parse, UsageError } from "../src/server/args.ts";
import { startServer } from "../src/server/start.ts";
import { makeFixture } from "./helpers/fixture.ts";

// What the `ccdesk` command promises: its flags and their errors, and a server another front end
// can start and stop. The bin itself only prints what these return.

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

test("a port that is not a whole number from 0 to 65535 is refused", () => {
  // Catches a typo such as --port 80800 or --port eighty being passed on to listen().
  for (const port of ["eighty", "80800", "-1", "1.5"])
    assert.throws(
      () => parse([`--port=${port}`]),
      (error) => error instanceof UsageError && error.message === `ccdesk: invalid --port ${port}`
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
