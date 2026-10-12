#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCore } from "../core/core.ts";
import { type Command, HELP, parse, UsageError } from "./args.ts";
import { openBrowser } from "../core/open.ts";
import { scanEnvFromProcess } from "../core/scan/env.ts";
import { type RunningServer, startServer } from "./start.ts";

const DEV_TOKEN = "dev";

async function main() {
  let command: Command;
  try {
    command = parse(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  if (command.command === "help") {
    console.log(HELP);
    return;
  }

  const { configDir, dev, port } = command;
  if (configDir !== undefined && !statSync(configDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`ccdesk: --config-dir ${configDir} is not a folder`);
    process.exitCode = 2;
    return;
  }
  const core = createCore(scanEnvFromProcess(configDir));
  let server: RunningServer;
  try {
    server = await startServer({
      core,
      launchDir: process.cwd(),
      token: dev ? DEV_TOKEN : randomBytes(18).toString("base64url"),
      uiDir: dev ? null : fileURLToPath(new URL("../ui", import.meta.url)),
      port,
    });
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    console.error(
      code === "EADDRINUSE" ? `ccdesk: port ${port} is already in use` : `ccdesk: ${message}`
    );
    process.exitCode = 1;
    return;
  }

  const stop = () => server.close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (dev) {
    console.log(
      `ccdesk API on ${new URL(server.url).origin} (dev token "${DEV_TOKEN}"); run \`pnpm dev:ui\` for the UI`
    );
    return;
  }
  console.log(`ccdesk is running at ${server.url}\nPress Ctrl+C to stop.`);
  if (command.open && (await openBrowser(server.url, core.env)) !== null)
    console.log("Could not open a browser; open the URL above.");
}

await main();
