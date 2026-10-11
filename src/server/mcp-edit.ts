import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Change, type McpEdit, type SettingsEditPreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import {
  gitRoot,
  isRecord,
  jsonSyntaxError,
  mainWorktreeRoot,
  redactSecrets,
  revisionOf,
} from "./scan/files.ts";
import { RefusedError, readIfExists, recordChange, serially, writeAtomic } from "./write.ts";

/**
 * Runs `claude` with these arguments in `cwd` and resolves with its output. Replaced in tests, so
 * nothing outside the test changes.
 */
export type RunClaude = (args: string[], cwd: string) => Promise<string>;

export const runClaude: RunClaude = (args, cwd) =>
  new Promise((done, fail) => {
    execFile("claude", args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
        return fail(
          new RefusedError(
            "ccdesk changes your user and local MCP servers through the claude command, which is not on PATH."
          )
        );
      if (error)
        return fail(
          new RefusedError(`claude ${args[1]} failed: ${stderr.trim() || error.message}`)
        );
      done(stdout);
    });
  });

function shown(value: unknown): string {
  return `${JSON.stringify(redactSecrets(value), null, 2)}\n`;
}

function hasHiddenValues(value: unknown): boolean {
  return JSON.stringify(redactSecrets(value)) !== JSON.stringify(value);
}

/** What ccdesk checks itself; Claude Code checks the rest when it starts the server. */
function entryProblems(definition: unknown): string[] {
  if (!isRecord(definition)) return ["A server must be a JSON object."];
  const type = typeof definition.type === "string" ? definition.type : "";
  if (type === "" || type === "stdio")
    return typeof definition.command === "string" && definition.command.trim() !== ""
      ? []
      : [
          typeof definition.url === "string"
            ? 'A server with a url needs a "type", such as "http"; without one it is read as a stdio server.'
            : 'A stdio server needs a "command".',
        ];
  return typeof definition.url === "string" && definition.url !== ""
    ? []
    : [`A ${type} server needs a "url".`];
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
    // ccdesk never shows env or header values, so it cannot write them back either.
    if (add && hasHiddenValues(now))
      throw new RefusedError(
        `${remove.name} has env or header values ccdesk does not show; edit it in the file, or remove it and add it again.`
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
  const next: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(servers)) {
    if (name !== remove?.name) next[name] = config;
    else if (add) next[add.name] = add.definition;
  }
  if (add && !remove) next[add.name] = add.definition;
  return next;
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
  const errors = edit.add ? entryProblems(edit.add.definition) : [];
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
  const errors = add ? entryProblems(add.definition) : [];
  const addArgs = (name: string, definition: unknown) => [
    "mcp",
    "add-json",
    name,
    JSON.stringify(definition),
    "--scope",
    edit.scope,
  ];
  const before = Object.keys(servers).length > 0 ? shown(servers) : null;
  return {
    preview: {
      path: env.claudeJson,
      before,
      after: errors.length > 0 ? (before ?? "") : shown(edited(servers, edit)),
      revision: revisionOf(JSON.stringify(redactSecrets(servers))),
      reformats: false,
      errors,
      // Shown with secrets hidden; the command that runs has the values you typed.
      commands: [
        ...(remove ? [`claude mcp remove ${remove.name} --scope ${edit.scope}`] : []),
        ...(add
          ? [
              `claude mcp add-json ${add.name} '${JSON.stringify(redactSecrets(add.definition))}' --scope ${edit.scope}`,
            ]
          : []),
      ],
    },
    save: async () => {
      if (remove) await run(["mcp", "remove", remove.name, "--scope", edit.scope], cwd);
      if (!add) return { target: env.claudeJson };
      try {
        await run(addArgs(add.name, add.definition), cwd);
      } catch (error) {
        // A replaced server goes back as it was, so a refused add does not lose it.
        if (remove)
          await run(addArgs(remove.name, servers[remove.name]), cwd).catch(() => undefined);
        throw error;
      }
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
