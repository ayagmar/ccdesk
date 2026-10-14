#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Core, createCore, openBrowser, scanEnvFromProcess } from "../core/index.ts";
import { type Command, HELP, parse, UsageError } from "./args.ts";
import { checkDirectory, explainText, scanJson } from "./commands.ts";

const DEV_TOKEN = "dev";

function isFolder(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

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

  const { configDir } = command;
  if (configDir !== undefined && !isFolder(configDir)) {
    console.error(`ccdesk: --config-dir ${configDir} is not a folder`);
    process.exitCode = 2;
    return;
  }
  const core = createCore(scanEnvFromProcess(configDir));
  if (command.command === "serve") return serve(core, command);

  const dir = resolve(command.dir ?? ".");
  if (!isFolder(dir)) {
    console.error(`ccdesk: ${command.dir} is not a folder`);
    process.exitCode = 2;
    return;
  }
  if (command.command === "check") {
    const { output, exitCode } = await checkDirectory(core, dir, command);
    if (exitCode === 2) console.error(output);
    else console.log(output);
    process.exitCode = exitCode;
    return;
  }
  console.log(
    command.command === "scan"
      ? await scanJson(core, dir)
      : await explainText(core, dir, resolve(command.file))
  );
}

async function serve(core: Core, { dev, port, open }: Extract<Command, { command: "serve" }>) {
  // Loaded here so that the subcommands, which only read, never load the HTTP server.
  const { startServer } = await import("./start.ts");
  let server: Awaited<ReturnType<typeof startServer>>;
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
  if (open && (await openBrowser(server.url, core.env)) !== null)
    console.log("Could not open a browser; open the URL above.");
}

await main();
