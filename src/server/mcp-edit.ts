import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { type Change, type McpEdit, type SettingsEditPreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import {
  gitRoot,
  isRecord,
  jsonSyntaxError,
  mainWorktreeRoot,
  redactSecrets,
  revisionOf,
  shownArgs,
  shownUrl,
} from "./scan/files.ts";
import { serverProblems } from "./scan/mcp.ts";
import {
  RefusedError,
  readIfExists,
  recordChange,
  recordClaudeMcpChange,
  serially,
  writeAtomic,
} from "./write.ts";

/**
 * Runs `claude` with these arguments in `cwd` and resolves with its output. Replaced in tests, so
 * nothing outside the test changes.
 */
export type RunClaude = (args: string[], cwd: string) => Promise<string>;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  );

/**
 * The program to run for `claude`. On Windows, npm installs Claude Code as a claude.cmd that starts
 * the package's claude.exe; Node cannot run a .cmd without a shell, which would read the server's
 * JSON as shell syntax, so ccdesk runs that claude.exe itself. A claude.exe earlier on PATH, as the
 * native installer puts there, comes first, as it would in a terminal.
 */
export async function claudeProgram(
  path = process.env.PATH ?? "",
  platform = process.platform
): Promise<string> {
  if (platform !== "win32") return "claude";
  // Windows reads a PATH entry in quotes as the folder inside them.
  for (const dir of path
    .split(delimiter)
    .map((d) => d.replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)) {
    if (await exists(join(dir, "claude.exe"))) return join(dir, "claude.exe");
    const fromNpm = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if ((await exists(join(dir, "claude.cmd"))) && (await exists(fromNpm))) return fromNpm;
  }
  return "claude";
}

/** The user name, password and query of a URL that ccdesk hides. */
function urlSecrets(text: string): string[] {
  if (shownUrl(text) === text) return [];
  const url = URL.parse(text);
  return [url?.username, url?.password, url?.search.slice(1)].filter((p): p is string => !!p);
}

/**
 * The env and header values, URL credentials and hidden args in a server definition passed to
 * claude.
 */
function secretsIn(args: string[]): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    if (!isRecord(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if ((key === "env" || key === "headers") && isRecord(inner))
        for (const v of Object.values(inner)) if (typeof v === "string" && v) found.push(v);
      if (key === "url" && typeof inner === "string") found.push(...urlSecrets(inner));
      if (key === "args" && "command" in value && Array.isArray(inner)) {
        const shown = shownArgs(inner);
        inner.forEach((arg, i) => {
          if (typeof arg !== "string" || shown[i] === arg) return;
          if (shown[i] === "•••") found.push(arg);
          else if (String(shown[i]).endsWith("=•••")) found.push(arg.slice(arg.indexOf("=") + 1));
          else found.push(...urlSecrets(arg));
        });
      }
      walk(inner);
    }
  };
  // add-json takes the definition as one JSON argument.
  for (const arg of args) {
    if (!arg.startsWith("{")) continue;
    try {
      walk(JSON.parse(arg));
    } catch {
      // Not JSON after all, so it holds no definition.
    }
  }
  // Longest first, so a value that contains another is hidden whole.
  return found.sort((a, b) => b.length - a.length);
}

export const runClaude: RunClaude = async (args, cwd) => {
  const program = await claudeProgram();
  return new Promise((done, fail) => {
    execFile(program, args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
        return fail(
          new RefusedError(
            "ccdesk changes your user and local MCP servers through the claude command, which is not on PATH."
          )
        );
      // Node's own message repeats the command, with the server's env and header values in it.
      if (error) {
        // claude's own message may quote the definition it was given.
        const said = secretsIn(args).reduce(
          (text, secret) => text.replaceAll(secret, "•••"),
          stderr
        );
        const reason =
          said.trim() ||
          (error.killed ? "it took longer than 30 seconds" : `it exited with code ${error.code}`);
        return fail(new RefusedError(`claude ${args[1]} failed: ${reason}`));
      }
      done(stdout);
    });
  });
};

/** Quotes a word for a POSIX shell, so a command shown to you can be pasted as it is. */
function quoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

function shown(value: unknown): string {
  return `${JSON.stringify(redactSecrets(value), null, 2)}\n`;
}

function hasHiddenValues(value: unknown): boolean {
  return JSON.stringify(redactSecrets(value)) !== JSON.stringify(value);
}

interface Planned {
  preview: SettingsEditPreview;
  save: () => Promise<Change | { target: string }>;
}

/**
 * Checks what an edit asks for against the servers as they are now: the one to remove must still
 * be as the scan showed it, and the one to add must not take another server's name.
 */
function checked(servers: Record<string, unknown>, edit: McpEdit): void {
  const { remove, add } = edit;
  if (remove) {
    const now = servers[remove.name];
    if (
      now === undefined ||
      JSON.stringify(redactSecrets(now)) !== JSON.stringify(remove.definition)
    )
      throw new RefusedError(`${remove.name} changed since ccdesk read it; review it again.`);
    // ccdesk never shows hidden values, so it cannot write them back either.
    if (add && hasHiddenValues(now))
      throw new RefusedError(
        `${remove.name} has values ccdesk does not show, in env, headers, its url or its args; edit it in the file, or remove it and add it again.`
      );
  }
  if (add) {
    if (add.name.trim() === "" || /[\p{Cc}\p{Cf}\s]/u.test(add.name))
      throw new RefusedError("A server name needs letters or digits and no spaces.");
    if (add.name !== remove?.name && Object.hasOwn(servers, add.name))
      throw new RefusedError(`There is already a server named ${add.name} here.`);
  }
}

/** The servers after the edit, with a replaced server kept in its place. */
function edited(servers: Record<string, unknown>, edit: McpEdit): Record<string, unknown> {
  const { remove, add } = edit;
  // Built with fromEntries: assigning a server named __proto__ would set the prototype instead.
  const next = Object.entries(servers).flatMap(([name, config]): Array<[string, unknown]> => {
    if (name !== remove?.name) return [[name, config]];
    return add ? [[add.name, add.definition]] : [];
  });
  if (add && !remove) next.push([add.name, add.definition]);
  return Object.fromEntries(next);
}

/** A project server: ccdesk changes .mcp.json itself, backed up and listed in Recent changes. */
async function planProject(env: ScanEnv, edit: McpEdit): Promise<Planned> {
  const dir = resolve(edit.dir);
  if (!(await stat(dir).catch(() => null))?.isDirectory())
    throw new RefusedError(`${dir} is not a directory on this machine.`);
  const path = join(dir, ".mcp.json");
  const raw = await readIfExists(env, path);
  let data: Record<string, unknown> = {};
  if (raw !== null && raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new RefusedError(`${path} is ${jsonSyntaxError(error)}; fix it by hand first.`);
    }
    if (!isRecord(parsed)) throw new RefusedError(`${path} does not hold a JSON object.`);
    data = parsed;
  }
  const servers = isRecord(data.mcpServers) ? data.mcpServers : {};
  checked(servers, edit);
  const next = { ...data, mcpServers: edited(servers, edit) };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const errors = edit.add ? serverProblems(edit.add.definition) : [];
  const before = raw === null ? null : shown(data);
  return {
    preview: {
      path,
      before,
      after: errors.length > 0 ? (before ?? "") : shown(next),
      revision: revisionOf(raw),
      reformats: raw !== null && raw.trim() !== "" && raw !== `${JSON.stringify(data, null, 2)}\n`,
      errors,
    },
    save: () =>
      recordChange(env, { kind: "mcp", target: path, before: raw }, async () => {
        await writeAtomic(env, path, text, revisionOf(raw));
        return { target: path, revision: revisionOf(text) };
      }),
  };
}

/**
 * A user or local server, which lives in ~/.claude.json: ccdesk runs Claude Code's own
 * `claude mcp` commands rather than write that file, which Claude Code rewrites all the time.
 */
async function planClaudeJson(env: ScanEnv, edit: McpEdit, run: RunClaude): Promise<Planned> {
  const dir = resolve(edit.dir);
  const raw = await readIfExists(env, env.claudeJson);
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (isRecord(parsed)) data = parsed;
  } catch (error) {
    throw new RefusedError(`${env.claudeJson} is ${jsonSyntaxError(error)}; fix it by hand first.`);
  }
  // Local servers are kept per project, under the same key the scan reads them from: the
  // repository root, or this folder. Claude Code files them under the folder it runs in.
  const projects = isRecord(data.projects) ? data.projects : {};
  const root = (await mainWorktreeRoot(dir)) ?? (await gitRoot(dir)) ?? dir;
  // User servers do not depend on the folder, so claude runs in your home directory for them.
  const cwd =
    edit.scope === "user" ? env.home : ([root, dir].find((k) => isRecord(projects[k])) ?? root);
  if (!(await stat(cwd).catch(() => null))?.isDirectory())
    throw new RefusedError(`${cwd} is not a directory on this machine.`);
  const holder = edit.scope === "user" ? data : projects[cwd];
  const servers = isRecord(holder) && isRecord(holder.mcpServers) ? holder.mcpServers : {};
  checked(servers, edit);
  const { remove, add } = edit;
  const errors = add ? serverProblems(add.definition) : [];
  // Names follow "--", so one such as --help is a name, not an option.
  const addArgs = (name: string, definition: unknown) => [
    "mcp",
    "add-json",
    "--scope",
    edit.scope,
    "--",
    name,
    JSON.stringify(definition),
  ];
  const addCommand = (name: string, definition: unknown) =>
    `claude mcp add-json --scope ${edit.scope} -- ${quoted(name)} ${quoted(JSON.stringify(definition))}`;
  const before = Object.keys(servers).length > 0 ? shown(servers) : null;
  // Recent changes lists the edit with the servers it touched, values hidden as the page shows
  // them, and the commands that put them back from the folder claude ran in.
  const record = () => {
    const names = [remove?.name, add?.name].filter((n) => n !== undefined);
    const touched = (all: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(all).filter(([name]) => names.includes(name)));
    const at = edit.scope === "local" ? `cd ${quoted(cwd)} && ` : "";
    return recordClaudeMcpChange(env, {
      target: env.claudeJson,
      shownBefore: shown(touched(servers)),
      shownAfter: shown(touched(edited(servers, edit))),
      undoCommands: [
        ...(add ? [`${at}claude mcp remove --scope ${edit.scope} -- ${quoted(add.name)}`] : []),
        ...(remove ? [`${at}${addCommand(remove.name, redactSecrets(servers[remove.name]))}`] : []),
      ],
    });
  };
  return {
    preview: {
      path: env.claudeJson,
      before,
      after: errors.length > 0 ? (before ?? "") : shown(edited(servers, edit)),
      // Of the servers as stored, so a changed hidden value, which the page never sees,
      // still makes a reviewed edit stale.
      revision: revisionOf(JSON.stringify(servers)),
      reformats: false,
      errors,
      // Shown with secrets hidden; the command that runs has the values you typed.
      commands: [
        ...(remove ? [`claude mcp remove --scope ${edit.scope} -- ${quoted(remove.name)}`] : []),
        ...(add ? [addCommand(add.name, redactSecrets(add.definition))] : []),
      ],
    },
    save: async () => {
      if (remove) await run(["mcp", "remove", "--scope", edit.scope, "--", remove.name], cwd);
      // The change is made by then; a record that cannot be written only leaves it unlisted.
      if (!add) {
        await record().catch(() => undefined);
        return { target: env.claudeJson };
      }
      try {
        await run(addArgs(add.name, add.definition), cwd);
      } catch (error) {
        if (!remove) throw error;
        // A replaced server goes back as it was, so a refused add does not lose it. When that
        // fails too, the error gives the command that puts it back, from the folder a local server
        // belongs to; a replaced server has no hidden values (see checked), so the command shows
        // nothing the page does not.
        const original = servers[remove.name];
        await run(addArgs(remove.name, original), cwd).catch(() => {
          throw new RefusedError(
            `ccdesk removed ${remove.name}, then could not add it back. In bash, zsh or Git Bash, put it back with: ${edit.scope === "local" ? `cd ${quoted(cwd)} && ` : ""}${addCommand(remove.name, original)} (${error instanceof Error ? error.message : String(error)})`
          );
        });
        throw error;
      }
      await record().catch(() => undefined);
      return { target: env.claudeJson };
    },
  };
}

function plan(env: ScanEnv, edit: McpEdit, run: RunClaude): Promise<Planned> {
  return edit.scope === "project" ? planProject(env, edit) : planClaudeJson(env, edit, run);
}

export async function previewMcpEdit(
  env: ScanEnv,
  edit: McpEdit,
  run: RunClaude
): Promise<SettingsEditPreview> {
  return (await plan(env, edit, run)).preview;
}

/** Makes a reviewed MCP edit, only while the servers are still as reviewed. */
export function saveMcpEdit(
  env: ScanEnv,
  edit: McpEdit,
  expectedRevision: string,
  run: RunClaude
): Promise<Change | { target: string }> {
  return serially(async () => {
    const planned = await plan(env, edit, run);
    if (planned.preview.errors.length > 0) throw new RefusedError(planned.preview.errors.join(" "));
    if (planned.preview.revision !== expectedRevision)
      throw new RefusedError("The servers changed since you reviewed this edit; review it again.");
    return planned.save();
  });
}
