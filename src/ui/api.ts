import { type SettingsComparison } from "../shared/compare.ts";
import { eventReader } from "../shared/events.ts";
import {
  type BackupSummary,
  type Change,
  type DirectoryView,
  type MemoryAction,
  type MemoryChangePreview,
  type Overview,
  type PathTest,
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type PermissionEdit,
  type PermissionList,
  type Reference,
  type RestorePreview,
  type SessionProfile,
  type SettingsEdit,
  type SettingsEditPreview,
  type Usage,
} from "../shared/types.ts";

const TOKEN_KEY = "ccdesk-token";

/** The CLI puts the session token in the URL fragment; keep it for this tab and clean the address bar. */
function token(): string {
  const match = /token=([\w-]+)/.exec(location.hash);
  if (match?.[1]) {
    try {
      sessionStorage.setItem(TOKEN_KEY, match[1]);
    } catch {
      // Storage blocked: the token still works for this page load.
    }
    history.replaceState(null, "", location.pathname + location.search);
    return match[1];
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? (import.meta.env.DEV ? "dev" : "");
  } catch {
    return import.meta.env.DEV ? "dev" : "";
  }
}

const sessionToken = token();

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** What to tell you about a failed call: an expired token says how to get a new one. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401)
    return "This page lost its access token. Open the link ccdesk printed in your terminal again.";
  return error instanceof Error ? error.message : String(error);
}

/** The error a failed response carries, with the message the server put in its body. */
async function failure(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const message =
    typeof body === "object" && body && "error" in body ? String(body.error) : response.statusText;
  return new ApiError(message, response.status);
}

async function request<T>(
  path: string,
  init?: { method: string; body: unknown },
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(path, {
    ...(signal ? { signal } : {}),
    method: init?.method ?? "GET",
    headers: {
      "x-ccdesk-token": sessionToken,
      ...(init ? { "content-type": "application/json" } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json().catch(() => null)) as T;
}

/** What the server pushes about the open directory's config files. */
export type WatchEvent = { type: "change" } | { type: "unwatched"; folders: string[] };

/**
 * The events of a server-sent event stream, read with fetch: EventSource cannot send the token
 * header, and the token must not go into the URL. Ends when the stream does.
 */
async function* events(path: string, signal: AbortSignal): AsyncGenerator<WatchEvent> {
  const response = await fetch(path, { signal, headers: { "x-ccdesk-token": sessionToken } });
  if (!response.ok || !response.body) throw await failure(response);
  const reader = response.body.getReader();
  const read = eventReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    for (const { event, data } of read(value)) {
      if (event === "change") yield { type: "change" };
      else if (event === "unwatched")
        yield { type: "unwatched", folders: JSON.parse(data) as string[] };
    }
  }
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  /** Claude Code's settings schema, settings catalog and hook events. */
  reference: () => request<Reference>("/api/reference"),
  directory: (path: string, profile: SessionProfile) =>
    request<DirectoryView>(
      `/api/directory?path=${encodeURIComponent(path)}${profile === "interactive" ? "" : `&profile=${profile}`}`
    ),
  /**
   * How Claude used tools in the sessions started in `path`, how many calls each rule covers, and
   * how often it read each memory file the scan in `profile` finds there.
   */
  usage: (
    path: string,
    rules: Array<{ list: PermissionList; rule: string }>,
    profile: SessionProfile,
    signal: AbortSignal
  ) => request<Usage>("/api/usage", { method: "POST", body: { path, rules, profile } }, signal),
  /** What a memory action would change; `path` is the memory, or MEMORY.md for remove-dead. */
  previewMemory: (action: MemoryAction, path: string) =>
    request<MemoryChangePreview>("/api/memory/preview", { method: "POST", body: { action, path } }),
  /**
   * Makes the reviewed memory action, only while what it was worked out from is unchanged.
   * `projectPath` is the directory the store is saved for, which Recent changes then names.
   */
  changeMemory: (action: MemoryAction, path: string, revision: string, projectPath?: string) =>
    request<Change>("/api/memory/change", {
      method: "POST",
      body: { action, path, revision, ...(projectPath && { projectPath }) },
    }),
  open: (path: string) =>
    request<{ editor: string }>("/api/open", { method: "POST", body: { path } }),
  previewSettings: (edit: SettingsEdit) =>
    request<SettingsEditPreview>("/api/settings/preview", { method: "POST", body: edit }),
  /** Saves exactly the reviewed edit, and only while the file still has the reviewed revision. */
  saveSettings: (edit: SettingsEdit, revision: string) =>
    request<Change>("/api/settings/save", { method: "POST", body: { ...edit, revision } }),
  previewPermission: (edit: PermissionEdit) =>
    request<SettingsEditPreview>("/api/permissions/preview", { method: "POST", body: edit }),
  savePermission: (edit: PermissionEdit, revision: string) =>
    request<Change>("/api/permissions/save", { method: "POST", body: { ...edit, revision } }),
  previewAgent: (edit: AgentEdit) =>
    request<SettingsEditPreview>("/api/agents/preview", { method: "POST", body: edit }),
  saveAgent: (edit: AgentEdit, revision: string) =>
    request<Change>("/api/agents/save", { method: "POST", body: { ...edit, revision } }),
  previewMcp: (edit: McpEdit) =>
    request<SettingsEditPreview>("/api/mcp/preview", { method: "POST", body: edit }),
  /** A project server change comes back as a Change; one made through `claude mcp` cannot be undone. */
  saveMcp: (edit: McpEdit, revision: string) =>
    request<Change | { target: string }>("/api/mcp/save", {
      method: "POST",
      body: { ...edit, revision },
    }).then((saved) => ("id" in saved ? saved : null)),
  previewHook: (edit: HookEdit) =>
    request<SettingsEditPreview>("/api/hooks/preview", { method: "POST", body: edit }),
  saveHook: (edit: HookEdit, revision: string) =>
    request<Change>("/api/hooks/save", { method: "POST", body: { ...edit, revision } }),
  /**
   * The changes to the config files that affect `dir`, until `signal` aborts or the server goes
   * away: first the folders ccdesk cannot watch, then each change, and those folders again whenever
   * they change.
   */
  events: (dir: string, signal: AbortSignal) =>
    events(`/api/events?dir=${encodeURIComponent(dir)}`, signal),
  /** The effective settings of two directories, key by key. */
  compare: (a: string, b: string) =>
    request<SettingsComparison>(
      `/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
    ),
  pathTest: (dir: string, file: string) =>
    request<PathTest>(
      `/api/path-test?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`
    ),
  backups: (before?: string) =>
    request<{ changes: BackupSummary[]; more: boolean }>(
      `/api/backups?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`
    ),
  previewRestore: (id: string) =>
    request<RestorePreview>("/api/backups/preview", { method: "POST", body: { id } }),
  /** Restores a backup while the file still has the reviewed (or just-changed) revision. */
  restore: (id: string, revision: string) =>
    request<{ target: string }>("/api/backups/restore", {
      method: "POST",
      body: { id, revision },
    }),
};
