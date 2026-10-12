import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import { EVERY_FILE, PERMISSION_LISTS } from "../shared/scopes.ts";
import {
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type PermissionEdit,
  type PermissionList,
  type Scope,
  type SettingsEdit,
} from "../shared/types.ts";
import { listBackups, previewRestore, restoreBackup } from "./backups.ts";
import { previewAgentEdit, saveAgentEdit } from "./agent-edit.ts";
import { previewMcpEdit, type RunClaude, runClaude, saveMcpEdit } from "./mcp-edit.ts";
import { changeMemory, isMemoryAction, previewMemoryChange } from "./mutations.ts";
import { openInEditor } from "./open.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isCredentials, isRecord } from "./scan/files.ts";
import { scanDirectory, scanOverview } from "./scan/index.ts";
import { CountStopped, readUsage } from "./scan/usage.ts";
import { testPath } from "./scan/path-test.ts";
import {
  previewHookEdit,
  previewPermissionEdit,
  previewSettingsEdit,
  saveHookEdit,
  savePermissionEdit,
  saveSettingsEdit,
} from "./settings-edit.ts";
import { Watcher } from "./watch.ts";
import { RefusedError } from "./write.ts";

interface ServerOptions {
  env: ScanEnv;
  launchDir: string;
  /** Required on every API request; the browser gets it once, in the URL fragment. */
  token: string;
  /** Built UI directory; null serves the API only (the Vite dev server serves the UI). */
  uiDir: string | null;
  /** Opens a file in the user's editor; replaced in tests so nothing is launched. */
  openFile?: (path: string) => Promise<string>;
  /** Runs `claude`, for MCP servers in ~/.claude.json; replaced in tests so nothing changes. */
  runClaude?: RunClaude;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** A request ccdesk will not take, answered with `status`. */
class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function createCcdeskServer(options: ServerOptions): Server {
  const watcher = new Watcher(options.env);
  const server = createServer((req, res) => {
    handle(options, watcher, server, req, res).catch((error: unknown) => {
      if (error instanceof RequestError) return send(res, error.status, { error: error.message });
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.on("close", () => watcher.close());
  return server;
}

async function handle(
  options: ServerOptions,
  watcher: Watcher,
  server: Server,
  req: IncomingMessage,
  res: ServerResponse
) {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  // Reject DNS-rebinding requests: only our own loopback origin may talk to this server.
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host ?? ""))
    return send(res, 421, { error: "Unexpected host" });

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/api/")) return serveStatic(options.uiDir, url.pathname, res);

  if (req.headers["x-ccdesk-token"] !== options.token)
    return send(res, 401, { error: "Missing or wrong token" });
  const origin = req.headers.origin;
  if (
    req.method !== "GET" &&
    origin !== undefined &&
    !allowedHosts.some((h) => origin === `http://${h}`)
  ) {
    return send(res, 403, { error: "Cross-origin request refused" });
  }

  const { env, launchDir } = options;
  if (req.method === "GET" && url.pathname === "/api/overview") {
    return send(res, 200, await scanOverview(env, launchDir));
  }
  if (req.method === "GET" && url.pathname === "/api/directory") {
    const path = url.searchParams.get("path");
    if (!path) return send(res, 400, { error: "path is required" });
    const view = await scanDirectory(env, path);
    watcher.track(view.path, view);
    return send(res, 200, view);
  }
  if (req.method === "POST" && url.pathname === "/api/usage") {
    const body = await readBody(req);
    const { path } = stringFields(body, ["path"]);
    const rules = (body as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) return send(res, 400, { error: "rules must be a list" });
    const inEffect = rules.map((r) => {
      const { list, rule } = stringFields(r, ["list", "rule"]);
      if (!PERMISSION_LISTS.includes(list as PermissionList))
        throw new RequestError(400, "a rule needs a list: allow, ask or deny");
      return { list: list as PermissionList, rule };
    });
    // The count stops when the page goes away or asks for another directory.
    const stop = new AbortController();
    res.once("close", () => stop.abort());
    try {
      return send(res, 200, await readUsage(env, path, inEffect, { signal: stop.signal }));
    } catch (error) {
      if (error instanceof CountStopped) return send(res, 503, { error: error.message });
      throw error;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/memory/preview") {
    const { action, path } = await fields(req, ["action", "path"]);
    if (!isMemoryAction(action)) return send(res, 400, { error: "unknown memory action" });
    return answer(res, () => previewMemoryChange(env, action, path));
  }
  if (req.method === "POST" && url.pathname === "/api/memory/change") {
    const { action, path, revision } = await fields(req, ["action", "path", "revision"]);
    if (!isMemoryAction(action)) return send(res, 400, { error: "unknown memory action" });
    return answer(res, () => changeMemory(env, action, path, revision));
  }
  if (req.method === "POST" && url.pathname === "/api/open") {
    const { path } = await fields(req, ["path"]);
    if (!isAbsolute(path)) return send(res, 400, { error: "an absolute path is required" });
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() && !info?.isDirectory())
      return send(res, 409, { error: "That file or folder no longer exists." });
    if (await isCredentials(env, path))
      return send(res, 409, { error: "ccdesk does not open credentials." });
    const open = options.openFile ?? openInEditor;
    return answer(res, async () => ({ editor: await open(path) }));
  }
  if (req.method === "POST" && url.pathname === "/api/settings/preview") {
    const edit = settingsEditFrom(await readBody(req));
    return answer(res, () => previewSettingsEdit(env, edit));
  }
  if (req.method === "POST" && url.pathname === "/api/settings/save") {
    const body = await readBody(req);
    const edit = settingsEditFrom(body);
    const { revision } = stringFields(body, ["revision"]);
    return answer(res, () => saveSettingsEdit(env, edit, revision));
  }
  if (req.method === "POST" && url.pathname === "/api/permissions/preview") {
    const edit = permissionEditFrom(await readBody(req));
    return answer(res, () => previewPermissionEdit(env, edit));
  }
  if (req.method === "POST" && url.pathname === "/api/permissions/save") {
    const body = await readBody(req);
    const edit = permissionEditFrom(body);
    const { revision } = stringFields(body, ["revision"]);
    return answer(res, () => savePermissionEdit(env, edit, revision));
  }
  if (req.method === "POST" && url.pathname === "/api/hooks/preview") {
    const edit = hookEditFrom(await readBody(req));
    return answer(res, () => previewHookEdit(env, edit));
  }
  if (req.method === "POST" && url.pathname === "/api/hooks/save") {
    const body = await readBody(req);
    const edit = hookEditFrom(body);
    const { revision } = stringFields(body, ["revision"]);
    return answer(res, () => saveHookEdit(env, edit, revision));
  }
  if (req.method === "POST" && url.pathname === "/api/agents/preview") {
    const edit = agentEditFrom(await readBody(req));
    return answer(res, () => previewAgentEdit(env, edit));
  }
  if (req.method === "POST" && url.pathname === "/api/agents/save") {
    const body = await readBody(req);
    const edit = agentEditFrom(body);
    const { revision } = stringFields(body, ["revision"]);
    return answer(res, () => saveAgentEdit(env, edit, revision));
  }
  if (req.method === "POST" && url.pathname === "/api/mcp/preview") {
    const edit = mcpEditFrom(await readBody(req));
    return answer(res, () => previewMcpEdit(env, edit, options.runClaude ?? runClaude));
  }
  if (req.method === "POST" && url.pathname === "/api/mcp/save") {
    const body = await readBody(req);
    const edit = mcpEditFrom(body);
    const { revision } = stringFields(body, ["revision"]);
    return answer(res, () => saveMcpEdit(env, edit, revision, options.runClaude ?? runClaude));
  }
  if (req.method === "GET" && url.pathname === "/api/watch") {
    const dir = url.searchParams.get("dir");
    const since = Number(url.searchParams.get("since") ?? "0");
    if (!dir || !isAbsolute(dir) || !Number.isInteger(since))
      return send(res, 400, { error: "dir is required" });
    // Stop waiting when the page goes away or asks for another directory.
    const stop = new AbortController();
    res.once("close", () => stop.abort());
    return send(res, 200, await watcher.wait(resolve(dir), since, stop.signal));
  }
  if (req.method === "GET" && url.pathname === "/api/path-test") {
    const dir = url.searchParams.get("dir");
    const file = url.searchParams.get("file");
    if (!dir || !isAbsolute(dir) || !file)
      return send(res, 400, { error: "dir and file are required" });
    return answer(res, () => testPath(env, dir, file));
  }
  if (req.method === "GET" && url.pathname === "/api/backups") {
    const before = url.searchParams.get("before") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      return send(res, 400, { error: "limit must be 1 to 200" });
    return send(res, 200, await listBackups(env, { ...(before ? { before } : {}), limit }));
  }
  if (req.method === "POST" && url.pathname === "/api/backups/preview") {
    const { id } = await fields(req, ["id"]);
    return answer(res, () => previewRestore(env, id));
  }
  if (req.method === "POST" && url.pathname === "/api/backups/restore") {
    const { id, revision } = await fields(req, ["id", "revision"]);
    return answer(res, () => restoreBackup(env, id, revision));
  }
  return send(res, 404, { error: "Not found" });
}

/** The named string fields of a JSON body; anything else is a 400. */
function stringFields<K extends string>(body: unknown, names: K[]): Record<K, string> {
  if (!isRecord(body) || names.some((n) => typeof body[n] !== "string"))
    throw new RequestError(
      400,
      `${names.join(", ")} ${names.length === 1 ? "is" : "are"} required`
    );
  return body as Record<K, string>;
}

async function fields<K extends string>(
  req: IncomingMessage,
  names: K[]
): Promise<Record<K, string>> {
  return stringFields(await readBody(req), names);
}

function settingsEditFrom(body: unknown): SettingsEdit {
  const { dir, scope, key } = stringFields(body, ["dir", "scope", "key"]);
  if (!EVERY_FILE.includes(scope as Scope)) throw new RequestError(400, "unknown scope");
  const value = (body as Record<string, unknown>).value;
  return { dir, scope: scope as Scope, key, ...(value === undefined ? {} : { value }) };
}

function permissionEditFrom(body: unknown): PermissionEdit {
  const { dir, file } = stringFields(body, ["dir", "file"]);
  const rule = (value: unknown) => {
    if (value === undefined) return undefined;
    const { list, rule } = stringFields(value, ["list", "rule"]);
    if (!PERMISSION_LISTS.includes(list as PermissionList) || rule.trim() === "")
      throw new RequestError(400, "a rule needs a list (allow, ask or deny) and text");
    return { list: list as PermissionList, rule };
  };
  const { remove, add } = body as Record<string, unknown>;
  const edit: PermissionEdit = { dir, file };
  const removed = rule(remove);
  const added = rule(add);
  if (removed) edit.remove = removed;
  if (added) edit.add = added;
  if (!removed && !added) throw new RequestError(400, "remove or add is required");
  return edit;
}

function hookEditFrom(body: unknown): HookEdit {
  const { dir, file } = stringFields(body, ["dir", "file"]);
  const { remove, add } = body as Record<string, unknown>;
  const edit: HookEdit = { dir, file };
  if (remove !== undefined) {
    const { event } = stringFields(remove, ["event"]);
    const { at, definition } = remove as Record<string, unknown>;
    const index = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : -1);
    const group = isRecord(at) ? index(at.group) : -1;
    const hook = isRecord(at) ? index(at.index) : -1;
    if (group < 0 || hook < 0) throw new RequestError(400, "remove needs the hook's place");
    edit.remove = { event, at: { group, index: hook }, definition };
  }
  if (add !== undefined) {
    const { event } = stringFields(add, ["event"]);
    if (!HOOK_EVENTS.includes(event))
      throw new RequestError(400, `${event} is not a hook event Claude Code knows`);
    const { matcher, definition } = add as Record<string, unknown>;
    if (matcher !== undefined && typeof matcher !== "string")
      throw new RequestError(400, "matcher must be text");
    if (!isRecord(definition)) throw new RequestError(400, "a hook must be a JSON object");
    edit.add = { event, ...(matcher ? { matcher } : {}), definition };
  }
  if (!edit.remove && !edit.add) throw new RequestError(400, "remove or add is required");
  return edit;
}

function agentEditFrom(body: unknown): AgentEdit {
  const { dir } = stringFields(body, ["dir"]);
  const { path, create, text } = body as Record<string, unknown>;
  if (text !== null && typeof text !== "string")
    throw new RequestError(400, "text must be the agent file, or null to delete it");
  const edit: AgentEdit = { dir, text };
  if (typeof path === "string") edit.path = path;
  else if (create !== undefined) {
    const { scope, file } = stringFields(create, ["scope", "file"]);
    if (scope !== "user" && scope !== "project")
      throw new RequestError(400, "a new agent goes in user or project scope");
    if (text === null) throw new RequestError(400, "a new agent needs its text");
    edit.create = { scope, file };
  } else throw new RequestError(400, "path or create is required");
  return edit;
}

function mcpEditFrom(body: unknown): McpEdit {
  const { dir, scope } = stringFields(body, ["dir", "scope"]);
  if (scope !== "user" && scope !== "local" && scope !== "project")
    throw new RequestError(400, "scope must be user, local or project");
  const { remove, add } = body as Record<string, unknown>;
  const edit: McpEdit = { dir, scope };
  if (remove !== undefined) {
    const { name } = stringFields(remove, ["name"]);
    edit.remove = { name, definition: (remove as Record<string, unknown>).definition };
  }
  if (add !== undefined) {
    const { name } = stringFields(add, ["name"]);
    const { definition } = add as Record<string, unknown>;
    if (!isRecord(definition)) throw new RequestError(400, "a server must be a JSON object");
    edit.add = { name, definition };
  }
  if (!edit.remove && !edit.add) throw new RequestError(400, "remove or add is required");
  return edit;
}

async function answer(res: ServerResponse, action: () => Promise<unknown>) {
  try {
    send(res, 200, await action());
  } catch (error) {
    if (error instanceof RefusedError) return send(res, 409, { error: error.message });
    throw error;
  }
}

const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new RequestError(415, "Send JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RequestError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Not valid JSON");
  }
}

async function serveStatic(uiDir: string | null, pathname: string, res: ServerResponse) {
  if (!uiDir) return send(res, 404, { error: "UI is served by the Vite dev server" });
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: "Bad request" });
  }
  const rel = normalize(decoded).replace(/^[/\\]+/, "");
  const target = join(uiDir, rel === "" ? "index.html" : rel);
  if (!target.startsWith(uiDir + sep) && target !== uiDir)
    return send(res, 403, { error: "Forbidden" });
  const file = await readFile(target).catch(() => null);
  // Unknown paths fall back to the app shell so client-side routes reload correctly.
  const body = file ?? (await readFile(join(uiDir, "index.html")));
  const type = file ? (MIME[extname(target)] ?? "application/octet-stream") : MIME[".html"];
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type as string });
  res.end(body);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
