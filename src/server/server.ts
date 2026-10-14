import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { type TProperties, type TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import {
  type Core,
  CountStopped,
  firstError,
  InvalidEditError,
  isMemoryAction,
  parseAgentEdit,
  parseHookEdit,
  parseMcpEdit,
  parsePermissionEdit,
  parseSettingsEdit,
  REFERENCE,
  RefusedError,
  Watcher,
} from "../core/index.ts";
import { BackupBody, MemoryBody, OpenBody, RevisionBody, UsageBody } from "../shared/requests.ts";
import { SESSION_PROFILES } from "../shared/types.ts";

export interface ServerOptions {
  /** What the routes read and change; tests make one with fakes so nothing is launched. */
  core: Core;
  launchDir: string;
  /** Required on every API request; the browser gets it once, in the URL fragment. */
  token: string;
  /** Built UI directory; null serves the API only (the Vite dev server serves the UI). */
  uiDir: string | null;
}

const HTML = "text/html; charset=utf-8";

const MIME: Record<string, string> = {
  ".html": HTML,
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

/** How often an event stream sends a comment, so the browser and any proxy keep it open. */
const HEARTBEAT_MS = 25_000;

/** What a route returns when it answered the request itself, as an event stream does. */
const ANSWERED = Symbol("answered");

/** A request ccdesk will not take, answered with `status`. */
class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createCcdeskServer(options: ServerOptions): Server {
  const watcher = new Watcher(options.core.env);
  const table = routes(options.core, watcher, options.launchDir);
  const server = createServer((req, res) => {
    handle(options, table, server, req, res).catch((error: unknown) => {
      const [status, message] = failure(error);
      send(res, status, { error: message });
    });
  });
  server.on("close", () => watcher.close());
  return server;
}

/** The status and message an API request that failed is answered with. */
function failure(error: unknown): [number, string] {
  if (error instanceof RequestError) return [error.status, error.message];
  if (error instanceof InvalidEditError) return [400, error.message];
  // A change ccdesk refuses on purpose.
  if (error instanceof RefusedError) return [409, error.message];
  if (error instanceof CountStopped) return [503, error.message];
  return [500, error instanceof Error ? error.message : String(error)];
}

interface Request {
  url: URL;
  /** A POST's JSON body, already read and parsed. */
  body: unknown;
  res: ServerResponse;
}

interface Route {
  method: "GET" | "POST";
  path: string;
  /** What the request is answered with, as JSON with status 200, or ANSWERED. */
  action: (request: Request) => Promise<unknown>;
}

/** The query parameter `name`; a missing one is a 400. */
function param(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new RequestError(400, `${name} is required`);
  return value;
}

/** The query parameter `name`, which must be an absolute path. */
function absoluteParam(url: URL, name: string): string {
  const value = param(url, name);
  if (!isAbsolute(value)) throw new RequestError(400, `${name} must be an absolute path`);
  return value;
}

const revisionBody = Compile(RevisionBody);
const usageBody = Compile(UsageBody);
const memoryBody = Compile(MemoryBody);
const openBody = Compile(OpenBody);
const backupBody = Compile(BackupBody);

/** A POST body `validator` accepts; anything else is a 400 naming what is wrong. */
function checked<T>(validator: Validator<TProperties, TSchema, T>, body: unknown): T {
  if (!validator.Check(body)) throw new RequestError(400, firstError(validator, body));
  return body;
}

/** Aborts when the page goes away or asks for something else. */
function stopOnClose(res: ServerResponse): AbortSignal {
  const stop = new AbortController();
  res.once("close", () => stop.abort());
  return stop.signal;
}

/**
 * Pushes the changes to what ccdesk shows for `dir` as server-sent events until the page closes
 * the stream: `unwatched` with the folders ccdesk cannot watch, first and whenever they change, and
 * `change` after each change. A stream whose watchers cannot start ends at once.
 */
async function streamChanges(watcher: Watcher, dir: string, res: ServerResponse): Promise<void> {
  // Sent at once, so the page knows the stream is open while the watchers start.
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8" });
  res.flushHeaders();
  const event = (name: string, data: unknown) =>
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_MS);
  const closed = stopOnClose(res);
  let unsubscribe = () => {
    // Replaced once subscribed.
  };
  closed.addEventListener("abort", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  try {
    unsubscribe = await watcher.subscribe(
      dir,
      () => event("change", {}),
      (unwatched) => event("unwatched", unwatched)
    );
  } catch {
    res.end();
  }
  // Closed while its watchers were starting.
  if (closed.aborted) unsubscribe();
}

function routes(core: Core, watcher: Watcher, launchDir: string): Route[] {
  const revision = (body: unknown) => checked(revisionBody, body).revision;
  const get = (path: string, action: Route["action"]): Route => ({ method: "GET", path, action });
  const post = (path: string, action: Route["action"]): Route => ({ method: "POST", path, action });
  return [
    get("/api/overview", () => core.scanOverview(launchDir)),
    // Sent instead of bundled with the page: the catalog and schema are most of its size.
    get("/api/reference", async () => REFERENCE),
    get("/api/directory", ({ url }) => {
      const asked = url.searchParams.get("profile") ?? "interactive";
      const profile = SESSION_PROFILES.find((p) => p === asked);
      if (!profile) throw new RequestError(400, `profile is one of ${SESSION_PROFILES.join(", ")}`);
      return watcher.scan(absoluteParam(url, "path"), profile);
    }),
    post("/api/usage", async ({ body, res }) => {
      const { path, rules, profile = "interactive" } = checked(usageBody, body);
      if (!isAbsolute(path)) throw new RequestError(400, "path must be an absolute path");
      return core.readUsage(path, rules, { profile, signal: stopOnClose(res) });
    }),
    post("/api/memory/preview", async ({ body }) => {
      const { action, path } = checked(memoryBody, body);
      if (!isMemoryAction(action)) throw new RequestError(400, "unknown memory action");
      return core.previewMemoryChange(action, path);
    }),
    post("/api/memory/change", async ({ body }) => {
      const { action, path, projectPath } = checked(memoryBody, body);
      if (!isMemoryAction(action)) throw new RequestError(400, "unknown memory action");
      return core.changeMemory(action, path, revision(body), projectPath);
    }),
    post("/api/open", async ({ body }) => {
      const { path } = checked(openBody, body);
      if (!isAbsolute(path)) throw new RequestError(400, "path must be an absolute path");
      return { editor: await core.openFile(path) };
    }),
    post("/api/settings/preview", async ({ body }) =>
      core.previewSettingsEdit(parseSettingsEdit(body))
    ),
    post("/api/settings/save", async ({ body }) =>
      core.saveSettingsEdit(parseSettingsEdit(body), revision(body))
    ),
    post("/api/permissions/preview", async ({ body }) =>
      core.previewPermissionEdit(parsePermissionEdit(body))
    ),
    post("/api/permissions/save", async ({ body }) =>
      core.savePermissionEdit(parsePermissionEdit(body), revision(body))
    ),
    post("/api/hooks/preview", async ({ body }) => core.previewHookEdit(parseHookEdit(body))),
    post("/api/hooks/save", async ({ body }) =>
      core.saveHookEdit(parseHookEdit(body), revision(body))
    ),
    post("/api/agents/preview", async ({ body }) => core.previewAgentEdit(parseAgentEdit(body))),
    post("/api/agents/save", async ({ body }) =>
      core.saveAgentEdit(parseAgentEdit(body), revision(body))
    ),
    post("/api/mcp/preview", async ({ body }) => core.previewMcpEdit(parseMcpEdit(body))),
    post("/api/mcp/save", async ({ body }) => core.saveMcpEdit(parseMcpEdit(body), revision(body))),
    get("/api/events", async ({ url, res }) => {
      await streamChanges(watcher, resolve(absoluteParam(url, "dir")), res);
      return ANSWERED;
    }),
    get("/api/compare", async ({ url }) =>
      core.compareSettings(absoluteParam(url, "a"), absoluteParam(url, "b"))
    ),
    get("/api/path-test", async ({ url }) =>
      core.testPath(absoluteParam(url, "dir"), param(url, "file"), (cwd) => watcher.view(cwd))
    ),
    get("/api/backups", async ({ url }) => {
      const before = url.searchParams.get("before") ?? undefined;
      const limit = Number(url.searchParams.get("limit") ?? "50");
      if (!Number.isInteger(limit) || limit < 1 || limit > 200)
        throw new RequestError(400, "limit must be 1 to 200");
      return core.listBackups({ ...(before ? { before } : {}), limit });
    }),
    post("/api/backups/preview", async ({ body }) =>
      core.previewRestore(checked(backupBody, body).id)
    ),
    post("/api/backups/restore", async ({ body }) =>
      core.restoreBackup(checked(backupBody, body).id, revision(body))
    ),
  ];
}

/**
 * Every request passes the same checks before its route runs: the Host header, then for the API
 * the token, the Origin of anything but a GET, and a POST's body. Failures are answered by
 * `failure`.
 */
async function handle(
  options: ServerOptions,
  table: Route[],
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

  const route = table.find((r) => r.method === req.method && r.path === url.pathname);
  if (!route) return send(res, 404, { error: "Not found" });
  const body = route.method === "POST" ? await readBody(req) : undefined;
  const answer = await route.action({ url, body, res });
  if (answer !== ANSWERED) send(res, 200, answer);
}

const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new RequestError(415, "Send JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    // A request without setEncoding yields Buffers.
    const piece: Buffer = chunk;
    size += piece.length;
    if (size > MAX_BODY) throw new RequestError(413, "Request too large");
    chunks.push(piece);
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
  const type = file ? (MIME[extname(target)] ?? "application/octet-stream") : HTML;
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type });
  res.end(body);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
