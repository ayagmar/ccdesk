// The core: everything a front end needs to read and change Claude Code's configuration, without
// HTTP. It re-exports the modules in src/server and src/shared where they live today.

// Environment: every function below takes the ScanEnv first.
export { isConfigHome, type ScanEnv, scanEnvFromProcess } from "../server/scan/env.ts";

// Read.
export { compareSettings } from "../server/scan/compare.ts";
export { revisionOf, redactSecrets, shownText } from "../server/scan/files.ts";
export { scanDirectory, scanOverview } from "../server/scan/index.ts";
export { testPath } from "../server/scan/path-test.ts";
export { CountStopped, readUsage } from "../server/scan/usage.ts";
export { hasHiddenValues, shown } from "../server/secrets.ts";
export { Watcher } from "../server/watch.ts";

// Edits: preview returns a revision, save takes it back. Both refuse with RefusedError; a save
// whose file changed since the preview throws StaleError, a RefusedError.
export { previewAgentEdit, saveAgentEdit } from "../server/agent-edit.ts";
export {
  claudeProgram,
  previewMcpEdit,
  type RunClaude,
  runClaude,
  saveMcpEdit,
} from "../server/mcp-edit.ts";
export { changeMemory, isMemoryAction, previewMemoryChange } from "../server/mutations.ts";
export {
  previewHookEdit,
  previewPermissionEdit,
  previewSettingsEdit,
  saveHookEdit,
  savePermissionEdit,
  saveSettingsEdit,
} from "../server/settings-edit.ts";
export { RefusedError, StaleError } from "../server/write.ts";

// History: every change ccdesk saves is a backup that can be restored by its id.
export { listBackups, previewRestore, restoreBackup } from "../server/backups.ts";

// Host.
export { openInEditor } from "../server/open.ts";

// Claude Code's settings schema, settings catalog and hook events.
export { REFERENCE } from "../server/reference.ts";

// Types and constants shared with the web UI.
export * from "../shared/compare.ts";
export * from "../shared/memory.ts";
export * from "../shared/scopes.ts";
export * from "../shared/types.ts";
