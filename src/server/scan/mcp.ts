import { join } from "node:path";
import { type McpServer, type Plugin, type SettingsLayer, type Trust } from "../../shared/types.ts";
import { isConfigHome, type ScanEnv } from "./env.ts";
import {
  isRecord,
  readJsonObject,
  redactSecrets,
  shownUrl,
  stringField,
  stringsIn,
  wildcard,
} from "./files.ts";
import { manifestConfigs } from "./plugins.ts";
import { readManagedSettings } from "./settings.ts";

/**
 * What makes a server definition one Claude Code cannot start; it checks the rest when it starts
 * the server (docs: mcp).
 */
export function serverProblems(definition: unknown): string[] {
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
  return Object.entries(servers)
    .filter(([, config]) => isRecord(config))
    .map(([name, config]) => {
      const c = config as Record<string, unknown>;
      const type = stringField(c, "type");
      const url = stringField(c, "url") || null;
      const command = stringField(c, "command")
        ? [stringField(c, "command"), ...stringsIn(c.args)]
        : null;
      const definition = redactSecrets(c) as Record<string, unknown>;
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
      return {
        server,
        command: type && type !== "stdio" ? null : command,
        url: type ? url : null,
        organisation: organisation && !usesVariables,
      };
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
  const defined = define(servers, "managed", sourcePath, true);
  for (const d of defined) {
    const problem = managedEntryProblem(
      d.server.name,
      (servers as Record<string, unknown>)[d.server.name]
    );
    if (problem) {
      d.server.status = "invalid";
      d.server.note = problem;
    }
  }
  return defined;
}

/** Two URLs are one endpoint when they differ only in scheme or host case, a default port or a trailing slash. */
export function endpoint(d: Defined): string {
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
  claudeJson: Record<string, unknown> | null;
  trust: Trust;
}

/**
 * Every MCP server definition, each marked with whether Claude Code would start it here
 * (docs: mcp#scope-hierarchy-and-precedence, managed-mcp). ccdesk never connects, so an active
 * server is one that is configured and allowed, not one that is known to work.
 */
export async function readMcpServers(input: Input, plugins: Plugin[]): Promise<McpServer[]> {
  const { env, projectDir, layers, claudeJson, trust } = input;
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {};
  const entry = [trust.root, projectDir].map((key) => projects[key]).find(isRecord);
  const project: Record<string, unknown> = entry ?? {};

  const managed = layers.find((l) => l.scope === "managed");
  // Checked as written: the layer has header values hidden, which would hide a ${VAR} in one.
  const managedServers = (await readManagedSettings(env)).data?.managedMcpServers;
  const managedFile = join(env.managedDir, "managed-mcp.json");
  const managedJson = await readJsonObject(env, managedFile);
  const mcpJson = join(projectDir, ".mcp.json");
  const shared = await readJsonObject(env, mcpJson);
  const defined: Defined[] = [
    ...(managedJson.ok ? define(managedJson.data.mcpServers, "managed", managedFile, true) : []),
    ...defineManaged(managedServers, managed?.path ?? ""),
    ...define(project.mcpServers, "local", env.claudeJson),
    ...(shared.ok ? define(shared.data.mcpServers, "project", mcpJson) : []),
    ...define(claudeJson?.mcpServers, "user", env.claudeJson),
  ];
  for (const plugin of plugins) {
    const path = join(plugin.installPath, ".mcp.json");
    const file = await readJsonObject(env, path);
    // A server name declared later in the same plugin replaces an earlier one.
    const own = new Map<string, Defined>();
    const add = (list: Defined[]) => {
      for (const d of list) own.set(d.server.name, d);
    };
    if (file.ok) add(define(file.data.mcpServers ?? file.data, "plugin", path));
    for (const part of await manifestConfigs(env, plugin, "mcpServers"))
      add(define(part.value, "plugin", part.path));
    for (const d of own.values()) d.server.plugin = plugin.id;
    defined.push(...own.values());
  }

  const exclusive = managedJson.ok;
  const denied = layers.flatMap((l) => policyEntries(l.data?.deniedMcpServers));
  const managedOnly = managed?.data?.allowManagedMcpServersOnly === true;
  const allowLayers = layers.filter((l) => !managedOnly || l.scope === "managed");
  const allowSet = allowLayers.some((l) => Array.isArray(l.data?.allowedMcpServers));
  const allowList = allowLayers.flatMap((l) => policyEntries(l.data?.allowedMcpServers));

  const disabledHere = stringsIn(project.disabledMcpServers);
  // A cloned repository cannot approve its own servers: project and local approvals count once the
  // folder is trusted, local ones in your configuration home right away (docs: mcp#project-server-approvals-and-workspace-trust).
  const approvalLayers = layers.filter(
    (l) =>
      (l.scope !== "project" && l.scope !== "local") ||
      trust.trusted ||
      (l.scope === "local" && isConfigHome(env, projectDir))
  );
  const approveAll = approvalLayers.some((l) => l.data?.enableAllProjectMcpServers === true);
  const approved = new Set([
    ...approvalLayers.flatMap((l) => stringsIn(l.data?.enabledMcpjsonServers)),
    ...stringsIn(project.enabledMcpjsonServers),
  ]);
  const rejected = new Set([
    ...layers.flatMap((l) => stringsIn(l.data?.disabledMcpjsonServers)),
    ...stringsIn(project.disabledMcpjsonServers),
  ]);

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
    else if (server.scope === "project" && rejected.has(server.name))
      set(server, "rejected", "Rejected by disabledMcpjsonServers");
    else if (server.scope === "project" && !approveAll && !approved.has(server.name))
      set(server, "pending", "Claude Code asks before starting servers from .mcp.json");
    if (server.status === "active" || server.status === "pending")
      enabledEndpoints.set(endpoint(d), d);
  }
  return defined.map((d) => d.server);
}
