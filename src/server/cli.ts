#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { scanEnvFromProcess } from "./scan/env.ts";
import { createCcdeskServer } from "./server.ts";

const HELP = `ccdesk: see and change what Claude Code loads on this machine

Usage: npx ccdesk [options]

Options:
  --port <n>            Port to listen on (default: a free port)
  --no-open             Print the URL instead of opening a browser
  --config-dir <path>   Claude folder to read, as CLAUDE_CONFIG_DIR sets it for Claude Code
                        (wins over $CLAUDE_CONFIG_DIR)
  -h, --help            Show this help

ccdesk reads ~/.claude (or --config-dir, or $CLAUDE_CONFIG_DIR) and opens on the directory you
run it from.
It listens on 127.0.0.1 only.`;

const DEV_PORT = 4319;
const DEV_TOKEN = "dev";

function options() {
  try {
    return parseArgs({
      options: {
        port: { type: "string" },
        "config-dir": { type: "string" },
        open: { type: "boolean", default: true },
        dev: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowNegative: true,
    }).values;
  } catch (error) {
    console.error(`ccdesk: ${(error as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
}

function main() {
  const values = options();
  if (values.help) {
    console.log(HELP);
    return;
  }

  const dev = values.dev;
  const port = values.port ? Number(values.port) : dev ? DEV_PORT : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`ccdesk: invalid --port ${values.port}`);
    process.exitCode = 2;
    return;
  }
  const configDir = values["config-dir"];
  if (configDir !== undefined && !statSync(configDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`ccdesk: --config-dir ${configDir} is not a folder`);
    process.exitCode = 2;
    return;
  }
  const token = dev ? DEV_TOKEN : randomBytes(18).toString("base64url");
  const server = createCcdeskServer({
    env: scanEnvFromProcess(configDir),
    launchDir: process.cwd(),
    token,
    uiDir: dev ? null : fileURLToPath(new URL("../ui", import.meta.url)),
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `ccdesk: port ${port} is already in use`
        : `ccdesk: ${error.message}`
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    if (dev) {
      console.log(
        `ccdesk API on http://127.0.0.1:${actual} (dev token "${DEV_TOKEN}"); run \`pnpm dev:ui\` for the UI`
      );
      return;
    }
    const url = `http://127.0.0.1:${actual}/#token=${token}`;
    console.log(`ccdesk is running at ${url}\nPress Ctrl+C to stop.`);
    if (values.open) openBrowser(url);
  });
  const stop = () => {
    // An open browser tab keeps a connection alive, which would hold close() open.
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log("Could not open a browser; open the URL above."));
  child.unref();
}

main();
