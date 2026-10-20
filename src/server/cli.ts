#!/usr/bin/env node
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { type Core, createCore, openBrowser, scanEnvFromProcess } from "../core/index.ts";
import { type Command, HELP, parse, UsageError } from "./args.ts";
import {
  checkDirectory,
  compareJson,
  compareText,
  explainText,
  forgetDirectories,
  scanJson,
  suggestJson,
  suggestText,
} from "./commands.ts";
import { changeHook, sessionCheck, VERSION } from "./hook.ts";

const DEV_TOKEN = "dev";

function isFolder(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Asks on the terminal; only y or yes goes ahead. */
async function ask(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await terminal.question(`${question} [y/N] `)).trim());
  } finally {
    terminal.close();
  }
}

async function forget({ dir, yes }: Extract<Command, { command: "forget" }>, core: Core) {
  if (!yes && !process.stdin.isTTY) {
    console.error(
      "ccdesk: forget asks before it moves anything; pass --yes to run it without a terminal"
    );
    process.exitCode = 2;
    return;
  }
  const { output, exitCode } = await forgetDirectories(
    core,
    dir === null ? null : [resolve(dir)],
    process.cwd(),
    async (review, question) => {
      console.log(review);
      return yes || ask(question);
    }
  );
  console.log(output);
  process.exitCode = exitCode;
}

async function hook(command: Extract<Command, { command: "hook" }>, core: Core) {
  if (command.action === "run") {
    // Only the hook's JSON goes to stdout: Claude Code adds any other text to Claude's context.
    const output = await sessionCheck(core, await stdinText());
    if (output) console.log(output);
    return;
  }
  if (!command.yes && !process.stdin.isTTY) {
    console.error(
      "ccdesk: hook asks before it changes settings; pass --yes to run it without a terminal"
    );
    process.exitCode = 2;
    return;
  }
  const { output, exitCode } = await changeHook(
    core,
    {
      dir: resolve(command.dir ?? "."),
      scope: command.project ? "project" : "user",
      remove: command.action === "remove",
      version: VERSION,
    },
    async (review, question) => {
      console.log(review);
      return command.yes || ask(question);
    }
  );
  if (exitCode === 2) console.error(output);
  else console.log(output);
  process.exitCode = exitCode;
}

/** Everything on stdin, as a hook gets its input. */
async function stdinText(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
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
  // The folder of a directory to forget is gone, so it is not checked here.
  if (command.command === "forget") return forget(command, core);

  const given = command.command === "compare" ? [command.a, command.b] : [command.dir ?? "."];
  const missing = given.find((path) => !isFolder(resolve(path)));
  if (missing !== undefined) {
    console.error(`ccdesk: ${missing} is not a folder`);
    process.exitCode = 2;
    return;
  }
  if (command.command === "compare") {
    const [a, b] = [resolve(command.a), resolve(command.b)];
    console.log(
      command.json ? await compareJson(core, a, b) : await compareText(core, a, b, command.all)
    );
    return;
  }
  const dir = resolve(command.dir ?? ".");
  if (command.command === "rules") {
    console.log(command.json ? await suggestJson(core, dir) : await suggestText(core, dir));
    return;
  }
  if (command.command === "hook") return hook(command, core);
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
  const { startSavedServer } = await import("./address.ts");
  let server: Awaited<ReturnType<typeof startServer>>;
  let saved = true;
  try {
    const options = { core, launchDir: process.cwd(), port };
    if (dev) server = await startServer({ ...options, token: DEV_TOKEN, uiDir: null });
    else {
      const uiDir = fileURLToPath(new URL("../ui", import.meta.url));
      ({ server, saved } = await startSavedServer({ ...options, uiDir }, core.env.claudeDir));
    }
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
  if (!saved)
    console.error(
      "ccdesk: could not save this address, so a page left open will need the new link after a restart"
    );
  if (open && (await openBrowser(server.url, core.env)) !== null)
    console.log("Could not open a browser; open the URL above.");
}

await main();
