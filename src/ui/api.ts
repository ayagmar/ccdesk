import { type SettingsComparison } from "../shared/compare.ts";
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
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : response.statusText;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  /** Claude Code's settings schema, settings catalog and hook events. */
  reference: () => request<Reference>("/api/reference"),
  directory: (path: string, profile: SessionProfile) =>
    request<DirectoryView>(
      `/api/directory?path=${encodeURIComponent(path)}${profile === "interactive" ? "" : `&profile=${profile}`}`
    ),
  /** How Claude used tools in the sessions started in `path`, and how many calls each rule covers. */
  usage: (
    path: string,
    rules: Array<{ list: PermissionList; rule: string }>,
    signal: AbortSignal
  ) => request<Usage>("/api/usage", { method: "POST", body: { path, rules } }, signal),
  /** What a memory action would change; `path` is the memory, or MEMORY.md for remove-dead. */
  previewMemory: (action: MemoryAction, path: string) =>
    request<MemoryChangePreview>("/api/memory/preview", { method: "POST", body: { action, path } }),
  /** Makes the reviewed memory action, only while what it was worked out from is unchanged. */
  changeMemory: (action: MemoryAction, path: string, revision: string) =>
    request<Change>("/api/memory/change", { method: "POST", body: { action, path, revision } }),
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
   * Waits up to 25 seconds for a config file that affects `dir` to change after `since`. While
   * some folders cannot be watched, it answers at once with them in `unwatched`.
   */
  watch: (dir: string, since: number, signal: AbortSignal) =>
    request<{ changed: boolean; at: number; unwatched: string[] }>(
      `/api/watch?dir=${encodeURIComponent(dir)}&since=${since}`,
      undefined,
      signal
    ),
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
