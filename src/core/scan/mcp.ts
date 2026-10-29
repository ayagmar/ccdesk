import { join } from "node:path";
import { Compile } from "typebox/compile";
import serverSchema from "../../shared/mcp-server.schema.json" with { type: "json" };
import {
  type McpApproval,
  type McpServer,
  type Problem,
  type Scope,
  type SessionProfile,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { schemaErrors } from "../schema.ts";
import { redactSecrets, shownUrl } from "../secrets.ts";
import { isRecord } from "./data.ts";
import { type ScanEnv } from "./env.ts";
import { readJsonOrReport, stringField, stringsIn, wildcard } from "./files.ts";
import { claudeJsonKey } from "./git.ts";
import { hooksWait } from "./permissions.ts";
import {
  fromRepository,
  type LoadedPlugin,
  manifestConfigs,
  pluginNamespace,
  pluginOnlyNote,
  pluginOnlySurfaces,
  pluginsRoot,
} from "./plugins.ts";
import { unredactedData } from "./settings.ts";
import { envFilter } from "./settings-env.ts";

const validateServer = Compile(serverSchema);

/**
 * What makes a server definition one Claude Code cannot start: a missing command or url, a type it
 * does not know, or a field the docs define holding the wrong kind of value (docs: mcp). It checks
 * the rest when it starts the server.
 */
export function serverProblems(definition: unknown): string[] {
  if (!isRecord(definition)) return ["A server must be a JSON object."];
  const type = typeof definition.type === "string" ? definition.type : "";
  if (type === "sdk")
    return ['Only an SDK host application can register a "sdk" server; Claude Code skips it here.'];
  const problems: string[] = [];
  if (type === "" || type === "stdio") {
    if (typeof definition.command !== "string" || definition.command.trim() === "")
      problems.push(
        typeof definition.url === "string"
          ? 'A server with a url needs a "type", such as "http"; without one it is read as a stdio server.'
          : 'A stdio server needs a "command".'
      );
  } else if (typeof definition.url !== "string" || definition.url === "")
    problems.push(`A ${type} server needs a "url".`);
  return [...problems, ...schemaErrors(validateServer, definition, "")];
}

/** A server definition with what policy matching needs, which the UI does not. */
interface Defined {
  server: McpServer;
  command: string[] | null;
  url: string | null;
  /** From managed-mcp.json or managedMcpServers, which skip the allowlist. */
  organisation: boolean;
  /** A plugin server's path placeholders, such as CLAUDE_PLUGIN_ROOT. */
  placeholders?: Record<string, string>;
}

/** What the page shows a server connects to: its URL, or its command line with values hidden. */
function targetOf(
  url: string | null,
  command: string[] | null,
  definition: Record<string, unknown>
): string {
  if (url) return shownUrl(url);
  if (!command) return "";
  return [command[0], ...stringsIn(definition.args)].join(" ");
}

function define(
  servers: unknown,
  scope: McpServer["scope"],
  sourcePath: string,
  organisation = false
): Defined[] {
  if (!isRecord(servers)) return [];
  return Object.entries(servers).flatMap(([name, c]) => {
    if (!isRecord(c)) return [];
    const type = stringField(c, "type");
    const url = stringField(c, "url") || null;
    const command = stringField(c, "command")
      ? [stringField(c, "command"), ...stringsIn(c.args)]
      : null;
    const definition = redactSecrets(c);
    const server: McpServer = {
      name,
      scope,
      // An entry without a type is read as stdio, even one with a url (docs: mcp).
      transport: type || "stdio",
      target: targetOf(url, command, definition),
      sourcePath,
      status: "active",
      definition,
    };
    const [problem] = serverProblems(c);
    if (problem) {
      server.status = "invalid";
      server.note = problem;
    }
    // A ${VAR} in an organisation entry means it still has to pass the allowlist.
    const usesVariables = JSON.stringify(c).includes("${");
    return [
      {
        server,
        command: type && type !== "stdio" ? null : command,
        url: type ? url : null,
        organisation: organisation && !usesVariables,
      },
    ];
  });
}

/** Control and invisible formatting characters, such as zero-width spaces and bidi overrides. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/** Every key and string value in a JSON value, the entry's name included by the caller. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...textsIn(inner)]);
}

/**
 * Why Claude Code drops a managedMcpServers entry, or null when it loads it
 * (docs: managed-mcp#what-an-entry-can-contain). `config` is the entry as written, headers included.
 */
function managedEntryProblem(name: string, config: unknown): string | null {
  if (!isRecord(config)) return "Not an object";
  const type = stringField(config, "type");
  if (!["http", "sse", "streamable-http"].includes(type))
    return "managedMcpServers entries must be http or sse servers";
  if (!stringField(config, "url").startsWith("https://"))
    return "managedMcpServers entries need an https:// URL";
  const member = ["command", "args", "env", "headersHelper"].find((key) => key in config);
  if (member) return `managedMcpServers entries may not have "${member}"`;
  if (JSON.stringify(config).includes("${"))
    return "managedMcpServers entries may not use environment variable references";
  if (!/^[\w-]+$/.test(name))
    return "A managedMcpServers name may hold only letters, numbers, hyphens and underscores";
  if (textsIn(config).some((text) => INVISIBLE.test(text)))
    return "managedMcpServers entries may not contain control or invisible characters";
  return null;
}

/** managedMcpServers from managed settings, with entries Claude Code drops marked invalid. */
function defineManaged(servers: unknown, sourcePath: string): Defined[] {
  if (!isRecord(servers)) return [];
  const defined = define(servers, "managed", sourcePath, true);
  for (const d of defined) {
    const problem = managedEntryProblem(d.server.name, servers[d.server.name]);
    if (problem) {
      d.server.status = "invalid";
      d.server.note = problem;
    }
  }
  return defined;
}

/** Two URLs are one endpoint when they differ only in scheme or host case, a default port or a trailing slash. */
function endpoint(d: Defined): string {
  if (d.command) return `command:${JSON.stringify(d.command)}`;
  if (!d.url) return `none:${d.server.name}`;
  try {
    const u = new URL(d.url);
    const path = u.pathname.replace(/\/$/, "");
    const user = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
    return `url:${u.protocol}//${user}${u.host}${path}${u.search}`;
  } catch {
    return `url:${d.url}`;
  }
}

type PolicyEntry = { serverName: string } | { serverCommand: string[] } | { serverUrl: string };

function policyEntries(value: unknown): PolicyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is PolicyEntry =>
      isRecord(e) &&
      (typeof e.serverName === "string" ||
        (Array.isArray(e.serverCommand) && e.serverCommand.every((p) => typeof p === "string")) ||
        typeof e.serverUrl === "string")
  );
}

/** A `serverUrl` pattern (docs: managed-mcp#how-serverurl-entries-match). */
const DEFAULT_PORTS = new Map([
  ["https", "443"],
  ["http", "80"],
]);

function urlMatches(pattern: string, url: string): boolean {
  const p = /^([^:/]+):\/\/([^/:]+)(?::([^/]*))?(\/.*)?$/.exec(pattern);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!p) return false;
  const [, scheme = "", host = "", port, path] = p;
  const scheme_ = u.protocol.slice(0, -1);
  if (!wildcard(scheme).test(scheme_)) return false;
  if (!wildcard(host.replace(/\.$/, ""), "i").test(u.hostname.replace(/\.$/, ""))) return false;
  const actualPort = u.port || (DEFAULT_PORTS.get(scheme_) ?? "");
  // No port: a full hostname means the default port only, a wildcard hostname any port.
  if (port !== undefined) {
    if (!wildcard(port).test(actualPort)) return false;
  } else if (!host.includes("*") && u.port !== "") return false;
  return path === undefined || wildcard(path).test(u.pathname + u.search);
}

function matches(entry: PolicyEntry, d: Defined): boolean {
  if ("serverName" in entry) return entry.serverName === d.server.name;
  if ("serverCommand" in entry)
    return d.command !== null && JSON.stringify(entry.serverCommand) === JSON.stringify(d.command);
  return d.url !== null && urlMatches(entry.serverUrl, d.url);
}

/** The allowlist check by server type (docs: managed-mcp#how-a-server-is-evaluated). */
function allowed(list: PolicyEntry[], d: Defined): boolean {
  const kind = d.url ? "serverUrl" : "serverCommand";
  const byKind = list.filter((e) => kind in e);
  if (byKind.some((e) => matches(e, d))) return true;
  return byKind.length === 0 && list.some((e) => "serverName" in e && matches(e, d));
}

interface Input {
  env: ScanEnv;
  projectDir: string;
  layers: SettingsLayer[];
  /** Managed settings as written, nothing hidden. */
  managed: Record<string, unknown> | null;
  claudeJson: Record<string, unknown> | null;
  trust: Trust;
  profile: SessionProfile;
  /** Whether a project or local file's grants wait for the trust dialog (see trustWaits). */
  waitsForTrust: (scope: Scope, path: string) => boolean;
  /** Receives MCP files that are there but do not parse. */
  problems: Problem[];
}

/**
 * Every MCP server definition, each marked with whether Claude Code would start it here
 * (docs: mcp#scope-hierarchy-and-precedence, managed-mcp). ccdesk never connects, so an active
 * server is one that is configured and allowed, not one that is known to work.
 */
export async function readMcpServers(input: Input, plugins: LoadedPlugin[]): Promise<McpServer[]> {
  const { env, layers, claudeJson, trust, profile, problems } = input;
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {};
  // Local servers live in the entry under the trust key, even from a subdirectory: claude mcp add
  // --scope local writes there and claude mcp list reads only that entry, ignoring one for the
  // subdirectory (observed with v2.1.296; the docs do not say).
  const entry = projects[claudeJsonKey(env, trust.root)];
  const project: Record<string, unknown> = isRecord(entry) ? entry : {};

  const managedFile = join(env.managedDir, "managed-mcp.json");
  const managedJson = await readJsonOrReport(env, managedFile, problems);
  const defined = [
    ...(await configuredServers(input, project, managedFile, managedJson)),
    ...(await pluginServers(env, input.projectDir, plugins, problems)),
  ];
  // A managed-mcp.json that does not parse is reported; ccdesk cannot tell which servers it lists,
  // so it does not show it taking control.
  const exclusive = managedJson !== null;
  const locked = pluginOnlySurfaces(input.managed).has("mcp");
  const environments = environmentsOf(input);
  expandServers(defined, environments);
  const policy = policyOf(layers, environments);
  const disabledHere = stringsIn(project.disabledMcpServers);
  const answersFor = approvalAnswers(input, project);
  const repository = new Set(
    plugins.filter((p) => fromRepository(p.plugin)).map((p) => p.plugin.id)
  );

  const byName = new Map<string, Defined>();
  const enabledEndpoints = new Map<string, Defined>();
  for (const d of defined) {
    const { server } = d;
    if (server.status === "invalid") continue;
    const controlled = managedControl(d, exclusive, locked);
    if (controlled) {
      set(server, "blocked", controlled);
      continue;
    }
    // Scopes dedupe by name; plugins by endpoint against the enabled servers above them.
    const earlier =
      server.scope === "plugin" ? enabledEndpoints.get(endpoint(d)) : byName.get(server.name);
    if (earlier) {
      set(
        server,
        "shadowed",
        `The ${earlier.server.scope} definition of ${earlier.server.name} is used instead`
      );
      continue;
    }
    if (server.scope !== "plugin") byName.set(server.name, d);
    const blocked = policy.blocks(d);
    if (blocked) set(server, "blocked", blocked);
    else if (disabledHere.includes(server.name))
      set(server, "disabled", "Turned off for this project in /mcp");
    else if (server.scope === "project" || repository.has(server.plugin ?? ""))
      approve(server, answersFor(server.name), profile);
    if (server.status === "active" || server.status === "pending")
      enabledEndpoints.set(endpoint(d), d);
  }
  return defined.map((d) => d.server);
}

/**
 * Why your organisation keeps a server from loading at all: a managed-mcp.json, which takes
 * exclusive control, or managed settings that keep MCP servers to plugins and managed settings.
 */
function managedControl(d: Defined, exclusive: boolean, locked: boolean): string | null {
  const { scope } = d.server;
  if (exclusive && !d.organisation && scope !== "managed")
    return "managed-mcp.json takes exclusive control of MCP servers";
  if (locked && scope !== "managed" && scope !== "plugin") return pluginOnlyNote("mcp");
  return null;
}

function set(server: McpServer, status: McpServer["status"], note: string): void {
  server.status = status;
  server.note = note;
}

/** The servers your settings, ~/.claude.json and the project define, in precedence order. */
async function configuredServers(
  input: Input,
  project: Record<string, unknown>,
  managedFile: string,
  managedJson: Record<string, unknown> | null
): Promise<Defined[]> {
  const { env, projectDir, layers, claudeJson, problems } = input;
  const managed = layers.find((l) => l.scope === "managed");
  const mcpJson = join(projectDir, ".mcp.json");
  const shared = await readJsonOrReport(env, mcpJson, problems);
  return [
    ...(managedJson ? define(managedJson.mcpServers, "managed", managedFile, true) : []),
    // Checked as written: the layer has header values hidden, which would hide a ${VAR} in one.
    ...defineManaged(input.managed?.managedMcpServers, managed?.path ?? ""),
    ...define(project.mcpServers, "local", env.claudeJson),
    ...(shared ? define(shared.mcpServers, "project", mcpJson) : []),
    ...define(claudeJson?.mcpServers, "user", env.claudeJson),
  ];
}

/** The servers each enabled plugin brings, from its .mcp.json and its manifest, by registered name. */
async function pluginServers(
  env: ScanEnv,
  projectDir: string,
  plugins: LoadedPlugin[],
  problems: Problem[]
): Promise<Defined[]> {
  const defined: Defined[] = [];
  for (const loaded of plugins) {
    const { plugin } = loaded;
    const path = join(plugin.installPath, ".mcp.json");
    const file = await readJsonOrReport(env, path, problems);
    // A server name declared later in the same plugin replaces an earlier one.
    const own = new Map<string, Defined>();
    const add = (list: Defined[]) => {
      for (const d of list) own.set(d.server.name, d);
    };
    if (file) add(define(file.mcpServers ?? file, "plugin", path));
    for (const part of await manifestConfigs(env, loaded, "mcpServers", problems))
      add(define(part.value, "plugin", part.path));
    // The path placeholders a plugin's servers may use (docs: plugins-reference#environment-variables,
    // mcp#plugin-provided-mcp-servers).
    const placeholders = {
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_PLUGIN_ROOT: plugin.installPath,
      CLAUDE_PLUGIN_DATA: join(pluginsRoot(env), "data", plugin.id.replace(/[^\w-]/g, "-")),
    };
    // Claude Code registers each under plugin:<plugin>:<key>, the name policy entries and /mcp use
    // (docs: mcp#plugin-provided-mcp-servers).
    for (const [key, d] of own) {
      d.server.name = `plugin:${pluginNamespace(loaded)}:${key}`;
      d.server.plugin = plugin.id;
      d.placeholders = placeholders;
    }
    defined.push(...own.values());
  }
  return defined;
}

type Vars = (name: string) => string | undefined;

/** Expands the ${VAR} references in each server's command and URL for matching; the page keeps them as written. */
function expandServers(defined: Defined[], environments: Environments): void {
  for (const d of defined) {
    const vars = (name: string) => d.placeholders?.[name] ?? environments.live(name);
    d.command = d.command?.map((part) => expand(part, vars)) ?? null;
    d.url = d.url === null ? null : expand(d.url, vars);
  }
}

/**
 * `text` with each ${VAR} and ${VAR:-default} expanded from `vars`; a variable set to an empty
 * string counts as set. `fill` gives a value for a reference with neither a value nor a default.
 * One with none of them stays as written (docs: mcp#environment-variable-expansion-in-mcp-json,
 * mcp#unset-variables-without-a-default, mcp#variables-set-to-an-empty-string).
 */
function expand(text: string, vars: Vars, fill?: Vars): string {
  return text.replace(
    /\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}/g,
    (reference, name: string, fallback: string | undefined) => {
      const value = vars(name);
      if (value !== undefined) return value;
      return fallback ?? fill?.(name) ?? reference;
    }
  );
}

/** The environments ${VAR} references expand from, each a lookup by name. */
interface Environments {
  /** A server's own values: the environment Claude Code runs in, settings env included. */
  live: Vars;
  /** allowedMcpServers entries: the environment Claude Code started with, plus managed env. */
  pinned: Vars;
  /** What fills a deniedMcpServers reference that has no value and no default: user and managed env. */
  denyFill: Vars;
}

/**
 * The environment ccdesk runs in stands for the one Claude Code starts with. Each file's env is
 * applied as Claude Code applies it: without the variables it ignores from that file, and from a
 * repository's files under the trust rule for hooks (docs: settings-reference#when-claude-code-applies-env-values,
 * permissions#what-runs-before-you-trust-a-folder, managed-mcp#environment-variables-in-servercommand-and-serverurl-entries).
 */
function environmentsOf({ env, layers, trust, profile }: Input): Environments {
  const envOf = (layer: SettingsLayer): Record<string, unknown> => {
    const raw = unredactedData(layer)?.env;
    const kept = envFilter(layer.scope, raw, raw).value;
    return isRecord(kept) ? kept : {};
  };
  const repositoryHeld = hooksWait(trust, profile);
  // Lowest precedence first, so a higher file's value wins.
  const lowestFirst = [...layers].reverse();
  const settingsEnv = Object.assign(
    {},
    ...lowestFirst
      .filter((l) => !(l.scope === "project" || l.scope === "local") || !repositoryHeld)
      .map(envOf)
  );
  const managedEnv = Object.assign({}, ...layers.filter((l) => l.scope === "managed").map(envOf));
  const userAndManaged = Object.assign(
    {},
    ...lowestFirst.filter((l) => l.scope === "user" || l.scope === "managed").map(envOf)
  );
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const pinned: Vars = (name) => text(managedEnv[name]) ?? env.processEnv[name];
  return {
    live: (name) => text(settingsEnv[name]) ?? env.processEnv[name],
    pinned,
    denyFill: (name) =>
      env.processEnv[name] === undefined ? text(userAndManaged[name]) : undefined,
  };
}

/**
 * A serverUrl pattern's scheme, host and path, which an allow entry's expansion may not change.
 * A user and password before the host are not part of it.
 */
function urlScope(pattern: string): string {
  const p = /^([^:/]+):\/\/(?:[^@/]*@)?([^/:]+)(?::[^/]*)?(\/.*)?$/.exec(pattern);
  return p ? JSON.stringify([p[1], p[2], p[3]]) : pattern;
}

/** A policy entry with its serverCommand or serverUrl expanded, or null when Claude Code ignores it. */
function expandEntry(
  entry: PolicyEntry,
  list: "allow" | "deny",
  envs: Environments
): PolicyEntry | null {
  const fill = list === "deny" ? envs.denyFill : undefined;
  if ("serverCommand" in entry)
    return { serverCommand: entry.serverCommand.map((part) => expand(part, envs.pinned, fill)) };
  if (!("serverUrl" in entry)) return entry;
  const serverUrl = expand(entry.serverUrl, envs.pinned, fill);
  // An allow entry whose expansion would change its scheme, host or path is ignored; a deny entry
  // still matches.
  if (list === "allow" && urlScope(serverUrl) !== urlScope(entry.serverUrl)) return null;
  return { serverUrl };
}

/**
 * deniedMcpServers and allowedMcpServers across the settings: why a server is blocked, if it is.
 * Entries are read unredacted, since they match a server's command or URL secrets and all, and
 * matched with their ${VAR} references expanded.
 */
function policyOf(
  layers: SettingsLayer[],
  envs: Environments
): { blocks: (d: Defined) => string | null } {
  // Each entry expanded, or null where Claude Code ignores it.
  const entries = (list: "allow" | "deny", from: SettingsLayer[]) =>
    from.flatMap((l) =>
      policyEntries(
        unredactedData(l)?.[list === "allow" ? "allowedMcpServers" : "deniedMcpServers"]
      ).map((e) => expandEntry(e, list, envs))
    );
  const denied = entries("deny", layers).flatMap((e) => e ?? []);
  const managedOnly =
    layers.find((l) => l.scope === "managed")?.data?.allowManagedMcpServersOnly === true;
  const allowLayers = layers.filter((l) => !managedOnly || l.scope === "managed");
  const allowSet = allowLayers.some((l) => Array.isArray(l.data?.allowedMcpServers));
  const allowEntries = entries("allow", allowLayers);
  const allowList = allowEntries.flatMap((e) => e ?? []);
  // Without this, an entry plainly in the file would leave the block unexplained. Only URL entries
  // are ignored, so only a URL server could have been admitted.
  const ignoredNote = allowEntries.includes(null)
    ? "; an allowedMcpServers entry was ignored because expanding its variables changes its scheme, host or path"
    : "";
  return {
    blocks: (d) => {
      if (denied.some((e) => matches(e, d))) return "Blocked by deniedMcpServers";
      if (allowSet && !d.organisation && !allowed(allowList, d))
        return `${managedOnly ? "Not in the managed allowedMcpServers" : "Not in allowedMcpServers"}${d.url ? ignoredNote : ""}`;
      return null;
    },
  };
}

/**
 * The answers about a .mcp.json server, each with whether it counts here. A cloned repository
 * cannot approve its own servers: a project file's approvals count once the folder is trusted, and a
 * local file's under the rule for its allow rules, which also covers a trusted parent folder,
 * claude -p and your configuration home (docs: mcp#project-server-approvals-and-workspace-trust,
 * permissions#when-your-local-settings-file-needs-trust).
 * A disabledMcpjsonServers entry in any file rejects the server. Your answers to the .mcp.json
 * prompt sit in the project entry: claude mcp list counts an enableAllProjectMcpServers there, and
 * claude mcp reset-project-choices clears it (v2.1.296).
 */
function approvalAnswers(
  input: Input,
  project: Record<string, unknown>
): (name: string) => McpApproval[] {
  const { env, layers, waitsForTrust } = input;
  const sources: Array<{
    source: McpApproval["source"];
    path: string;
    data: Record<string, unknown>;
  }> = [
    ...layers.flatMap((l) => (l.data ? [{ source: l.scope, path: l.path, data: l.data }] : [])),
    { source: "claude-json", path: env.claudeJson, data: project },
  ];
  return (name) =>
    sources.flatMap(({ source, path, data }) => {
      const counts = source === "claude-json" || !waitsForTrust(source, path);
      const out: McpApproval[] = [];
      if (data.enableAllProjectMcpServers === true)
        out.push({ key: "enableAllProjectMcpServers", source, path, counts });
      if (stringsIn(data.enabledMcpjsonServers).includes(name))
        out.push({ key: "enabledMcpjsonServers", source, path, counts });
      if (stringsIn(data.disabledMcpjsonServers).includes(name))
        out.push({ key: "disabledMcpjsonServers", source, path, counts: true });
      return out;
    });
}

/** Where an approval answer was given, as the page names it. */
function answerSource(a: McpApproval): string {
  return a.source === "claude-json" ? "your answer in ~/.claude.json" : `${a.source} settings`;
}

/** Marks a .mcp.json server rejected, waiting for approval, or left active by its answers. */
function approve(server: McpServer, answers: McpApproval[], profile: SessionProfile): void {
  if (answers.length > 0) server.approvals = answers;
  const rejection = answers.find((a) => a.key === "disabledMcpjsonServers");
  const waiting = answers.find((a) => a.key !== "disabledMcpjsonServers" && !a.counts);
  const approved = answers.some((a) => a.key !== "disabledMcpjsonServers" && a.counts);
  if (rejection) {
    set(server, "rejected", `Rejected by disabledMcpjsonServers in ${answerSource(rejection)}`);
    return;
  }
  if (approved) return;
  // claude -p connects them without asking, approved or not (docs: permissions#what-runs-before-you-trust-a-folder).
  if (profile === "print") {
    server.note =
      "Not approved, but claude -p connects the repository's servers without asking; the SDK does when settingSources includes project";
    return;
  }
  set(
    server,
    "pending",
    waiting
      ? `Claude Code asks before starting it: ${waiting.key} in ${answerSource(waiting)} counts once you trust this folder`
      : "Claude Code asks before starting servers from the repository: answer its prompt, or list the server in enabledMcpjsonServers in your user settings"
  );
}
