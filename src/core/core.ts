import { previewAgentEdit, saveAgentEdit } from "./agent-edit.ts";
import { listBackups, previewRestore, restoreBackup } from "./backups.ts";
import { claudeRunner, previewMcpEdit, type RunClaude, saveMcpEdit } from "./mcp-edit.ts";
import { changeMemory, previewMemoryChange } from "./mutations.ts";
import { openInEditor } from "./open.ts";
import { compareSettings } from "./scan/compare.ts";
import { type ScanEnv } from "./scan/env.ts";
import { scanDirectory, scanOverview } from "./scan/index.ts";
import { testPath } from "./scan/path-test.ts";
import { usageCounter } from "./scan/usage.ts";
import {
  previewHookEdit,
  previewPermissionEdit,
  previewSettingsEdit,
  saveHookEdit,
  savePermissionEdit,
  saveSettingsEdit,
} from "./settings-edit.ts";
import { changeQueue } from "./write.ts";
import {
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type MemoryAction,
  type PermissionEdit,
  type SettingsEdit,
} from "../shared/types.ts";

export interface CoreOptions {
  /** Runs `claude` for user and local MCP servers. By default, the claude on `env`'s PATH. */
  runClaude?: RunClaude;
  /** Opens a file or folder and resolves with the command used. By default, the editor `env` names or has. */
  openFile?: (path: string) => Promise<string>;
}

/**
 * The core for one machine: every read and change, with `env` already passed. Changes made through
 * one core run one at a time, and its usage counts share one cache. Two cores share neither, so
 * make one per Claude folder: two on the same folder could both pass a revision check.
 */
export function createCore(env: ScanEnv, options: CoreOptions = {}) {
  const run = options.runClaude ?? claudeRunner(env);
  const queue = changeQueue();
  const bound =
    <A extends unknown[], R>(read: (env: ScanEnv, ...args: A) => R) =>
    (...args: A) =>
      read(env, ...args);
  return {
    env,
    openFile: options.openFile ?? ((path: string) => openInEditor(path, env)),

    scanOverview: bound(scanOverview),
    scanDirectory: bound(scanDirectory),
    compareSettings: bound(compareSettings),
    testPath: bound(testPath),
    readUsage: bound(usageCounter()),

    previewSettingsEdit: bound(previewSettingsEdit),
    saveSettingsEdit: (edit: SettingsEdit, revision: string) =>
      saveSettingsEdit(env, edit, revision, queue),
    previewPermissionEdit: bound(previewPermissionEdit),
    savePermissionEdit: (edit: PermissionEdit, revision: string) =>
      savePermissionEdit(env, edit, revision, queue),
    previewHookEdit: bound(previewHookEdit),
    saveHookEdit: (edit: HookEdit, revision: string) => saveHookEdit(env, edit, revision, queue),
    previewAgentEdit: bound(previewAgentEdit),
    saveAgentEdit: (edit: AgentEdit, revision: string) => saveAgentEdit(env, edit, revision, queue),
    previewMcpEdit: (edit: McpEdit) => previewMcpEdit(env, edit, run),
    saveMcpEdit: (edit: McpEdit, revision: string) => saveMcpEdit(env, edit, revision, run, queue),
    previewMemoryChange: bound(previewMemoryChange),
    changeMemory: (action: MemoryAction, path: string, revision: string) =>
      changeMemory(env, action, path, revision, queue),

    listBackups: bound(listBackups),
    previewRestore: bound(previewRestore),
    restoreBackup: (id: string, revision: string) => restoreBackup(env, id, revision, queue),
  };
}

export type Core = ReturnType<typeof createCore>;
