import { parseArgs } from "node:util";

export const HELP = `ccdesk: see and change what Claude Code loads on this machine

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

/** The port `--dev` listens on, which `pnpm dev:ui` proxies to. */
export const DEV_PORT = 4319;

/** What `ccdesk` was asked to do. */
export type Command =
  | { command: "help" }
  | {
      command: "serve";
      port: number;
      configDir: string | undefined;
      open: boolean;
      /** Serve the API only, on DEV_PORT with a fixed token, for the Vite dev server. */
      dev: boolean;
    };

/** Arguments ccdesk cannot run with; the message is what to print. */
export class UsageError extends Error {}

/** Reads the arguments after `ccdesk`, without touching the file system. */
export function parse(argv: string[]): Command {
  let values: ReturnType<typeof options>;
  try {
    values = options(argv);
  } catch (error) {
    throw new UsageError(`ccdesk: ${(error as Error).message}\n\n${HELP}`);
  }
  if (values.help) return { command: "help" };

  const port = values.port ? Number(values.port) : values.dev ? DEV_PORT : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError(`ccdesk: invalid --port ${values.port}`);
  return {
    command: "serve",
    port,
    configDir: values["config-dir"],
    open: values.open,
    dev: values.dev,
  };
}

function options(args: string[]) {
  return parseArgs({
    args,
    options: {
      port: { type: "string" },
      "config-dir": { type: "string" },
      open: { type: "boolean", default: true },
      dev: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowNegative: true,
  }).values;
}
