import { parseArgs } from "node:util";

export const HELP = `ccdesk: see and change what Claude Code loads on this machine

Usage:
  npx ccdesk [options]                     Open the page in your browser
  npx ccdesk scan [dir] --json             Print what Claude Code loads in dir, as JSON
  npx ccdesk explain <file> [--dir <dir>]  Print what loads once Claude reads or edits file
  npx ccdesk check [dir] [--json]          Exit 1 when a session started in dir reads a file
                                           Claude Code cannot read or parse

Options:
  --port <n>            Port to listen on (default: a free port)
  --no-open             Print the URL instead of opening a browser
  --config-dir <path>   Claude folder to read, as CLAUDE_CONFIG_DIR sets it for Claude Code
                        (wins over $CLAUDE_CONFIG_DIR)
  --dir <dir>           For explain: the folder the session starts in (default: the current one)
  --strict              For check: also fail on entries Claude Code may skip in a file it reads
  --all                 For check: also count ~/.claude, ~/.claude.json, managed settings and
                        files outside dir's repository
  -h, --help            Show this help

ccdesk reads ~/.claude (or --config-dir, or $CLAUDE_CONFIG_DIR). The page opens on the directory
you run ccdesk from and listens on 127.0.0.1 only. dir and file are relative to that directory.
scan, explain and check write nothing and print no value the page hides. A command exits 2 when
its arguments are wrong, its folder does not exist, or it cannot run.`;

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
  | { command: "explain"; file: string; dir: string | undefined; configDir: string | undefined }
  /** Report the files in `dir`'s repository that Claude Code cannot read or parse; exit 1 if any. */
  | {
      command: "check";
      dir: string | undefined;
      configDir: string | undefined;
      json: boolean;
      /** Also fail on files Claude Code reads with some entries skipped. */
      strict: boolean;
      /** Also count files outside the repository: ~/.claude, ~/.claude.json, managed settings. */
      all: boolean;
    };

/** Arguments ccdesk cannot run with; the message is what to print. */
export class UsageError extends Error {}

type Flag = keyof ReturnType<typeof options>["values"];

/** The flags each command takes; --help goes with any. */
const FLAGS: Record<"serve" | "scan" | "explain" | "check", Flag[]> = {
  serve: ["port", "open", "dev", "config-dir"],
  scan: ["json", "config-dir"],
  explain: ["dir", "config-dir"],
  check: ["json", "strict", "all", "config-dir"],
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
  const name = commandOf(first);
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
  if (name === "check") {
    if (rest.length > 1) throw usage("check takes one dir");
    const { json = false, strict = false, all = false } = values;
    return { command: "check", dir: rest[0], configDir, json, strict, all };
  }

  return {
    command: "serve",
    port: portOf(values),
    configDir,
    open: values.open ?? true,
    dev: values.dev ?? false,
  };
}

/** The command the first word names; without one, the page. */
function commandOf(first: string | undefined): keyof typeof FLAGS {
  if (first === undefined) return "serve";
  if (first === "scan" || first === "explain" || first === "check") return first;
  throw usage(`unknown command ${first}`);
}

/** The port to serve on: --port, the dev server's with --dev, or else any free one. */
function portOf(values: ReturnType<typeof options>["values"]): number {
  if (!values.port) return values.dev ? DEV_PORT : 0;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw usage(`invalid --port ${values.port}`);
  return port;
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
      strict: { type: "boolean" },
      all: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    allowNegative: true,
  });
}
