import { stat } from "node:fs/promises";
import { previewAgentEdit, saveAgentEdit } from "./agent-edit.ts";
import { listBackups, previewRestore, restoreBackup } from "./backups.ts";
import { forgetDirectory, previewForget } from "./forget.ts";
import { claudeRunner, previewMcpEdit, type RunClaude, saveMcpEdit } from "./mcp-edit.ts";
import { changeMemory, previewMemoryChange } from "./mutations.ts";
import { openInEditor } from "./open.ts";
import { compareSettings } from "./scan/compare.ts";
import { type ScanEnv } from "./scan/env.ts";
import { isCredentials } from "./scan/files.ts";
import { scanDirectory, scanOverview } from "./scan/index.ts";
import { testPath } from "./scan/path-test.ts";
import { type RuleInEffect, usageCounter } from "./scan/usage.ts";
import {
  previewHookEdit,
  previewPermissionEdit,
  previewSettingsEdit,
  saveHookEdit,
  savePermissionEdit,
  saveSettingsEdit,
} from "./settings-edit.ts";
import { changeQueue, RefusedError } from "./write.ts";
import {
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type MemoryAction,
  type PermissionEdit,
  type SessionProfile,
  type SettingsEdit,
} from "../shared/types.ts";

export interface CoreOptions {
  /** Runs `claude` for user and local MCP servers. By default, the claude on `env`'s PATH. */
  runClaude?: RunClaude;
  /**
   * Opens a file or folder and resolves with the command used. By default, the editor `env` names
   * or has. The core refuses a missing path and the credentials file before calling it.
   */
  openFile?: (path: string) => Promise<string>;
}

/**
 * The core for one machine: every read and change, with `env` already passed. Changes made through
 * one core run one at a time, and its usage counts share one cache. Two cores share neither, so
 * make one per Claude folder: two on the same folder could both pass a revision check.
 */
export function createCore(env: ScanEnv, options: CoreOptions = {}) {
  const run = options.runClaude ?? claudeRunner(env);
  const open = options.openFile ?? ((path: string) => openInEditor(path, env));
  const queue = changeQueue();
  const countUsage = usageCounter();
  const bound =
    <A extends unknown[], R>(read: (env: ScanEnv, ...args: A) => R) =>
    (...args: A) =>
      read(env, ...args);
  return {
    env,
    openFile: async (path: string) => {
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() && !info?.isDirectory())
        throw new RefusedError("That file or folder no longer exists.");
      if (await isCredentials(env, path))
        throw new RefusedError("ccdesk does not open credentials.");
      return open(path);
    },

    scanOverview: bound(scanOverview),
    scanDirectory: bound(scanDirectory),
    compareSettings: bound(compareSettings),
    testPath: bound(testPath),
    /**
     * Counts the tool calls in the sessions started in `dir`, and the Read calls on each memory file
     * of the store a session under `profile` uses there. The memory files come from a scan of `dir`,
     * never from the caller, so no other file's reads can be asked about. Each count scans `dir` once.
     */
    readUsage: async (
      dir: string,
      rules: RuleInEffect[],
      {
        profile = "interactive",
        ...counting
      }: { profile?: SessionProfile; signal?: AbortSignal; maxCachedCalls?: number } = {}
    ) => {
      const view = await scanDirectory(env, dir, profile);
      const memories = view.memory.memories.map((m) => m.path);
      return countUsage(env, dir, rules, { ...counting, memories });
    },

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
    changeMemory: (action: MemoryAction, path: string, revision: string, projectPath?: string) =>
      changeMemory(env, action, path, revision, queue, projectPath),

    previewForget: bound(previewForget),
    /** Forgets a directory whose folder is gone; `launchDir` is never forgotten. */
    forgetDirectory: (dir: string, launchDir: string, revision: string) =>
      forgetDirectory(env, dir, launchDir, revision, queue),

    listBackups: bound(listBackups),
    previewRestore: bound(previewRestore),
    restoreBackup: (id: string, revision: string) => restoreBackup(env, id, revision, queue),
  };
}

export type Core = ReturnType<typeof createCore>;
