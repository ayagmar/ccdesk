import { parseArgs } from "node:util";

export const HELP = `ccdesk: see and change what Claude Code loads on this machine

Usage:
  npx ccdesk [options]                     Open the page in your browser
  npx ccdesk scan [dir] --json             Print what Claude Code loads in dir, as JSON
  npx ccdesk explain <file> [--dir <dir>]  Print what loads once Claude reads or edits file

Options:
  --port <n>            Port to listen on (default: a free port)
  --no-open             Print the URL instead of opening a browser
  --config-dir <path>   Claude folder to read, as CLAUDE_CONFIG_DIR sets it for Claude Code
                        (wins over $CLAUDE_CONFIG_DIR)
  --dir <dir>           For explain: the folder the session starts in (default: the current one)
  -h, --help            Show this help

ccdesk reads ~/.claude (or --config-dir, or $CLAUDE_CONFIG_DIR). The page opens on the directory
you run ccdesk from and listens on 127.0.0.1 only. dir and file are relative to that directory.
scan and explain write nothing and print no value the page hides.`;

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
    }
  /** Print the DirectoryView of `dir` (default: the current one) as JSON. */
  | { command: "scan"; dir: string | undefined; configDir: string | undefined }
  /** Print what loads once Claude touches `file` in a session started in `dir`. */
  | { command: "explain"; file: string; dir: string | undefined; configDir: string | undefined };

/** Arguments ccdesk cannot run with; the message is what to print. */
export class UsageError extends Error {}

type Flag = keyof ReturnType<typeof options>["values"];

/** The flags each command takes; --help goes with any. */
const FLAGS: Record<"serve" | "scan" | "explain", Flag[]> = {
  serve: ["port", "open", "dev", "config-dir"],
  scan: ["json", "config-dir"],
  explain: ["dir", "config-dir"],
};

/** Reads the arguments after `ccdesk`, without touching the file system. */
export function parse(argv: string[]): Command {
  let parsed: ReturnType<typeof options>;
  try {
    parsed = options(argv);
  } catch (error) {
    throw usage((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { command: "help" };

  const [first, ...rest] = positionals;
  const name =
    first === undefined ? "serve" : first === "scan" || first === "explain" ? first : null;
  if (name === null) throw usage(`unknown command ${first}`);
  for (const flag of Object.keys(values) as Flag[])
    if (!FLAGS[name].includes(flag))
      throw usage(`--${flag} does not go with ${name === "serve" ? "the page" : name}`);
  const configDir = values["config-dir"];

  if (name === "scan") {
    if (rest.length > 1) throw usage("scan takes one dir");
    if (!values.json) throw usage("scan prints JSON; pass --json");
    return { command: "scan", dir: rest[0], configDir };
  }
  if (name === "explain") {
    const [file, ...extra] = rest;
    if (file === undefined || extra.length > 0) throw usage("explain takes one file");
    return { command: "explain", file, dir: values.dir, configDir };
  }

  const port = values.port ? Number(values.port) : values.dev ? DEV_PORT : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError(`ccdesk: invalid --port ${values.port}`);
  return {
    command: "serve",
    port,
    configDir,
    open: values.open ?? true,
    dev: values.dev ?? false,
  };
}

function usage(message: string): UsageError {
  return new UsageError(`ccdesk: ${message}\n\n${HELP}`);
}

/** The flags as given: one left out is absent, so each command can refuse the others' flags. */
function options(args: string[]) {
  return parseArgs({
    args,
    options: {
      port: { type: "string" },
      "config-dir": { type: "string" },
      open: { type: "boolean" },
      dev: { type: "boolean" },
      json: { type: "boolean" },
      dir: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    allowNegative: true,
  });
}
