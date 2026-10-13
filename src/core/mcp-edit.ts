import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { type Change, type McpEdit, type SettingsEditPreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { revisionOf } from "./scan/files.ts";
import { isRecord } from "./scan/data.ts";
import { claudeJsonKey, gitRoot, mainWorktreeRoot, trustKey } from "./scan/git.ts";
import { serverProblems } from "./scan/mcp.ts";
import { hasHiddenValues, jsonSyntaxError, redactSecrets, secretTexts, shown } from "./secrets.ts";
import {
  type Planned,
  RefusedError,
  readIfExists,
  readJsonObject,
  recordChange,
  recordClaudeMcpChange,
  type Serially,
  saveReviewed,
  serially,
  writeAtomic,
} from "./write.ts";

/**
 * Runs `claude` with these arguments in `cwd`, with the profile ccdesk reads so its edits land
 * where the page shows them, and resolves with its output. Replaced in tests, so nothing outside
 * the test changes.
 */
export type RunClaude = (
  args: string[],
  cwd: string,
  configDir: string | undefined
) => Promise<string>;

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
export async function claudeProgram(path: string, platform: NodeJS.Platform): Promise<string> {
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

/** The secret values in a server definition passed to claude, which add-json takes as one JSON argument. */
function secretsIn(args: string[]): string[] {
  return args.flatMap((arg) => {
    if (!arg.startsWith("{")) return [];
    try {
      return secretTexts(JSON.parse(arg));
    } catch {
      // Not JSON after all, so it holds no definition.
      return [];
    }
  });
}

/** Runs the claude on `host`'s PATH, with `host`'s environment. */
export function claudeRunner(host: Pick<ScanEnv, "platform" | "processEnv">): RunClaude {
  return async (args, cwd, configDir) => {
    const program = await claudeProgram(host.processEnv.PATH ?? "", host.platform);
    // Set only for a chosen profile: Claude Code also moves .claude.json into a CLAUDE_CONFIG_DIR.
    const env =
      configDir === undefined
        ? host.processEnv
        : { ...host.processEnv, CLAUDE_CONFIG_DIR: configDir };
    return new Promise((done, fail) => {
      execFile(program, args, { cwd, env, timeout: 30_000 }, (error, stdout, stderr) => {
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
}

/** claudeRunner for this process's PATH and environment, read on each run; use a core's instead. */
export const runClaude: RunClaude = (args, cwd, configDir) =>
  // biome-ignore lint/style/noProcessEnv: the documented default of the free runClaude; a core passes its own.
  claudeRunner({ platform: process.platform, processEnv: process.env })(args, cwd, configDir);

/** Quotes a word for a POSIX shell, so a command shown to you can be pasted as it is. */
function quoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

type Plan = Planned<SettingsEditPreview, Change | { target: string }>;

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
  const next = Object.entries(servers).flatMap(([name, config]): [string, unknown][] => {
    if (name !== remove?.name) return [[name, config]];
    return add ? [[add.name, add.definition]] : [];
  });
  if (add && !remove) next.push([add.name, add.definition]);
  return Object.fromEntries(next);
}

/** A project server: ccdesk changes .mcp.json itself, backed up and listed in Recent changes. */
async function planProject(env: ScanEnv, edit: McpEdit): Promise<Plan> {
  const dir = resolve(edit.dir);
  if (!(await stat(dir).catch(() => null))?.isDirectory())
    throw new RefusedError(`${dir} is not a directory on this machine.`);
  const path = join(dir, ".mcp.json");
  const { raw, data, reformats } = await readJsonObject(env, path);
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
      reformats,
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
 * The user or local servers an edit changes in ~/.claude.json, and the folder claude runs in for
 * them. Local servers are kept per project, under the key the scan reads them from; Claude Code
 * files them there from any folder below. User servers do not depend on the folder, so claude runs
 * in your home directory for them.
 */
async function claudeJsonServers(
  env: ScanEnv,
  edit: McpEdit
): Promise<{ cwd: string; servers: Record<string, unknown> }> {
  const raw = await readIfExists(env, env.claudeJson);
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (isRecord(parsed)) data = parsed;
  } catch (error) {
    throw new RefusedError(`${env.claudeJson} is ${jsonSyntaxError(error)}; fix it by hand first.`);
  }
  const dir = resolve(edit.dir);
  const cwd =
    edit.scope === "user"
      ? env.home
      : trustKey(dir, await mainWorktreeRoot(dir), await gitRoot(dir));
  if (!(await stat(cwd).catch(() => null))?.isDirectory())
    throw new RefusedError(`${cwd} is not a directory on this machine.`);
  const projects = isRecord(data.projects) ? data.projects : {};
  const holder = edit.scope === "user" ? data : projects[claudeJsonKey(env, cwd)];
  const servers = isRecord(holder) && isRecord(holder.mcpServers) ? holder.mcpServers : {};
  return { cwd, servers };
}

/** The `claude mcp` arguments for an edit; names follow "--", so one such as --help is a name. */
const claudeArgs = {
  remove: (edit: McpEdit, name: string) => ["mcp", "remove", "--scope", edit.scope, "--", name],
  add: (edit: McpEdit, name: string, definition: unknown) => [
    "mcp",
    "add-json",
    "--scope",
    edit.scope,
    "--",
    name,
    JSON.stringify(definition),
  ],
};

/**
 * `claude` with these arguments as you would type it in bash, zsh or Git Bash: the server's name
 * and definition after "--" are quoted, and the profile ccdesk reads is named, so pasting the line
 * changes the same servers. With `cwd`, it starts by going to the folder claude ran in.
 */
function commandLine(env: ScanEnv, args: string[], cwd?: string): string {
  const names = args.indexOf("--") + 1;
  const claude =
    env.configDir === undefined ? "claude" : `CLAUDE_CONFIG_DIR=${quoted(env.configDir)} claude`;
  const line = [claude, ...args.slice(0, names), ...args.slice(names).map(quoted)].join(" ");
  return cwd === undefined ? line : `cd ${quoted(cwd)} && ${line}`;
}

/**
 * A user or local server, which lives in ~/.claude.json: ccdesk runs Claude Code's own
 * `claude mcp` commands rather than write that file, which Claude Code rewrites all the time.
 */
async function planClaudeJson(env: ScanEnv, edit: McpEdit, run: RunClaude): Promise<Plan> {
  const { cwd, servers } = await claudeJsonServers(env, edit);
  checked(servers, edit);
  const { remove, add } = edit;
  const errors = add ? serverProblems(add.definition) : [];
  const before = Object.keys(servers).length > 0 ? shown(servers) : null;
  // A local server's commands to paste go to the folder it belongs to first.
  const from = edit.scope === "local" ? cwd : undefined;
  // Recent changes lists the edit with the servers it touched, values hidden as the page shows
  // them, and the commands that put them back.
  const record = () => {
    const names = [remove?.name, add?.name].filter((n) => n !== undefined);
    const touched = (all: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(all).filter(([name]) => names.includes(name)));
    return recordClaudeMcpChange(env, {
      target: env.claudeJson,
      shownBefore: shown(touched(servers)),
      shownAfter: shown(touched(edited(servers, edit))),
      undoCommands: [
        ...(add ? [commandLine(env, claudeArgs.remove(edit, add.name), from)] : []),
        ...(remove
          ? [
              commandLine(
                env,
                claudeArgs.add(edit, remove.name, redactSecrets(servers[remove.name])),
                from
              ),
            ]
          : []),
      ],
    });
  };
  const save = async () => {
    if (remove) await run(claudeArgs.remove(edit, remove.name), cwd, env.configDir);
    // The change is made by then; a record that cannot be written only leaves it unlisted.
    if (!add) {
      await record().catch(() => undefined);
      return { target: env.claudeJson };
    }
    try {
      await run(claudeArgs.add(edit, add.name, add.definition), cwd, env.configDir);
    } catch (error) {
      if (!remove) throw error;
      // A replaced server goes back as it was, so a refused add does not lose it. When that fails
      // too, the error gives the command that puts it back; a replaced server has no hidden values
      // (see checked), so the command shows nothing the page does not.
      const putBack = claudeArgs.add(edit, remove.name, servers[remove.name]);
      await run(putBack, cwd, env.configDir).catch(() => {
        throw new RefusedError(
          `ccdesk removed ${remove.name}, then could not add it back. In bash, zsh or Git Bash, put it back with: ${commandLine(env, putBack, from)} (${error instanceof Error ? error.message : String(error)})`
        );
      });
      throw error;
    }
    await record().catch(() => undefined);
    return { target: env.claudeJson };
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
        ...(remove ? [commandLine(env, claudeArgs.remove(edit, remove.name))] : []),
        ...(add
          ? [commandLine(env, claudeArgs.add(edit, add.name, redactSecrets(add.definition)))]
          : []),
      ],
    },
    save,
  };
}

function plan(env: ScanEnv, edit: McpEdit, run: RunClaude): Promise<Plan> {
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
  run: RunClaude,
  queue: Serially = serially
): Promise<Change | { target: string }> {
  return saveReviewed(
    queue,
    () => plan(env, edit, run),
    expectedRevision,
    "The servers changed since you reviewed this edit; review it again."
  );
}
