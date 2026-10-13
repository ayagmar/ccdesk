import { join } from "node:path";
import { Compile } from "typebox/compile";
import {
  type McpApproval,
  type McpServer,
  type Problem,
  type Scope,
  type SessionProfile,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { redactSecrets, shownUrl } from "../secrets.ts";
import { isConfigHome, type ScanEnv } from "./env.ts";
import { readJsonOrReport, stringField, stringsIn, wildcard } from "./files.ts";
import { isRecord } from "./data.ts";
import { type LoadedPlugin, manifestConfigs } from "./plugins.ts";
import serverSchema from "../../shared/mcp-server.schema.json" with { type: "json" };
import { schemaErrors } from "../schema.ts";

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
      target: url
        ? shownUrl(url)
        : command
          ? [command[0], ...stringsIn(definition.args)].join(" ")
          : "",
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
  const actualPort = u.port || (scheme_ === "https" ? "443" : scheme_ === "http" ? "80" : "");
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
  /** Receives MCP files that are there but do not parse. */
  problems: Problem[];
}

/**
 * Every MCP server definition, each marked with whether Claude Code would start it here
 * (docs: mcp#scope-hierarchy-and-precedence, managed-mcp). ccdesk never connects, so an active
 * server is one that is configured and allowed, not one that is known to work.
 */
export async function readMcpServers(input: Input, plugins: LoadedPlugin[]): Promise<McpServer[]> {
  const { env, projectDir, layers, claudeJson, trust, profile, problems } = input;
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {};
  // Local servers live in the entry under the trust key, even from a subdirectory: claude mcp add
  // --scope local writes there and claude mcp list reads only that entry, ignoring one for the
  // subdirectory (observed with v2.1.296; the docs do not say).
  const entry = projects[trust.root];
  const project: Record<string, unknown> = isRecord(entry) ? entry : {};

  const managed = layers.find((l) => l.scope === "managed");
  // Checked as written: the layer has header values hidden, which would hide a ${VAR} in one.
  const managedServers = input.managed?.managedMcpServers;
  const managedFile = join(env.managedDir, "managed-mcp.json");
  const managedJson = await readJsonOrReport(env, managedFile, problems);
  const mcpJson = join(projectDir, ".mcp.json");
  const shared = await readJsonOrReport(env, mcpJson, problems);
  const defined: Defined[] = [
    ...(managedJson ? define(managedJson.mcpServers, "managed", managedFile, true) : []),
    ...defineManaged(managedServers, managed?.path ?? ""),
    ...define(project.mcpServers, "local", env.claudeJson),
    ...(shared ? define(shared.mcpServers, "project", mcpJson) : []),
    ...define(claudeJson?.mcpServers, "user", env.claudeJson),
  ];
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
    for (const d of own.values()) d.server.plugin = plugin.id;
    defined.push(...own.values());
  }

  // A managed-mcp.json that does not parse is reported; ccdesk cannot tell which servers it lists,
  // so it does not show it taking control.
  const exclusive = managedJson !== null;
  const denied = layers.flatMap((l) => policyEntries(l.data?.deniedMcpServers));
  const managedOnly = managed?.data?.allowManagedMcpServersOnly === true;
  const allowLayers = layers.filter((l) => !managedOnly || l.scope === "managed");
  const allowSet = allowLayers.some((l) => Array.isArray(l.data?.allowedMcpServers));
  const allowList = allowLayers.flatMap((l) => policyEntries(l.data?.allowedMcpServers));

  const disabledHere = stringsIn(project.disabledMcpServers);
  // A cloned repository cannot approve its own servers: project and local approvals count once the
  // folder is trusted, local ones in your configuration home right away (docs: mcp#project-server-approvals-and-workspace-trust).
  // A disabledMcpjsonServers entry in any file rejects the server.
  const approvalCounts = (scope: Scope) =>
    (scope !== "project" && scope !== "local") ||
    trust.trusted ||
    (scope === "local" && isConfigHome(env, projectDir));
  // Your answers to the .mcp.json prompt sit in the project entry: claude mcp list counts an
  // enableAllProjectMcpServers there, and claude mcp reset-project-choices clears it (v2.1.296).
  const sources: Array<{
    source: McpApproval["source"];
    path: string;
    data: Record<string, unknown>;
  }> = [
    ...layers.flatMap((l) => (l.data ? [{ source: l.scope, path: l.path, data: l.data }] : [])),
    { source: "claude-json", path: env.claudeJson, data: project },
  ];
  const answersFor = (name: string): McpApproval[] =>
    sources.flatMap(({ source, path, data }) => {
      const counts = source === "claude-json" || approvalCounts(source);
      const out: McpApproval[] = [];
      if (data.enableAllProjectMcpServers === true)
        out.push({ key: "enableAllProjectMcpServers", source, path, counts });
      if (stringsIn(data.enabledMcpjsonServers).includes(name))
        out.push({ key: "enabledMcpjsonServers", source, path, counts });
      if (stringsIn(data.disabledMcpjsonServers).includes(name))
        out.push({ key: "disabledMcpjsonServers", source, path, counts: true });
      return out;
    });
  const from = (a: McpApproval) =>
    a.source === "claude-json" ? "your answer in ~/.claude.json" : `${a.source} settings`;

  const set = (server: McpServer, status: McpServer["status"], note: string) => {
    server.status = status;
    server.note = note;
  };
  const byName = new Map<string, Defined>();
  const enabledEndpoints = new Map<string, Defined>();
  for (const d of defined) {
    const { server } = d;
    if (server.status === "invalid") continue;
    if (exclusive && !d.organisation && server.scope !== "managed") {
      set(server, "blocked", "managed-mcp.json takes exclusive control of MCP servers");
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
    if (denied.some((e) => matches(e, d))) set(server, "blocked", "Blocked by deniedMcpServers");
    else if (allowSet && !d.organisation && !allowed(allowList, d))
      set(
        server,
        "blocked",
        managedOnly ? "Not in the managed allowedMcpServers" : "Not in allowedMcpServers"
      );
    else if (disabledHere.includes(server.name))
      set(server, "disabled", "Turned off for this project in /mcp");
    else if (server.scope === "project") {
      const answers = answersFor(server.name);
      if (answers.length > 0) server.approvals = answers;
      const rejection = answers.find((a) => a.key === "disabledMcpjsonServers");
      const waiting = answers.find((a) => a.key !== "disabledMcpjsonServers" && !a.counts);
      const approved = answers.some((a) => a.key !== "disabledMcpjsonServers" && a.counts);
      if (rejection)
        set(server, "rejected", `Rejected by disabledMcpjsonServers in ${from(rejection)}`);
      // claude -p connects them without asking, approved or not (docs: permissions#what-runs-before-you-trust-a-folder).
      else if (!approved && profile === "print")
        server.note =
          "Not approved, but claude -p connects .mcp.json servers without asking; the SDK does when settingSources includes project";
      else if (!approved)
        set(
          server,
          "pending",
          waiting
            ? `Claude Code asks before starting it: ${waiting.key} in ${from(waiting)} counts once you trust this folder`
            : "Claude Code asks before starting servers from .mcp.json: answer its prompt, or list the server in enabledMcpjsonServers in your user settings"
        );
    }
    if (server.status === "active" || server.status === "pending")
      enabledEndpoints.set(endpoint(d), d);
  }
  return defined.map((d) => d.server);
}
