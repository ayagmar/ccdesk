// The core: everything a front end needs to read and change Claude Code's configuration, without
// HTTP. It re-exports the modules in src/server and src/shared where they live today; see
// ARCHITECTURE.md for how they fit together and docs/split-plan.md for where they are going.

// The core for one machine: createCore(env) returns the reads and changes below with the env
// already passed, its own change queue and usage cache, and the editor and claude its env names.
export { type Core, type CoreOptions, createCore } from "./core.ts";

// Environment: every function below takes the ScanEnv first. Called directly, they share one
// change queue and one usage cache across the process; they stay for one release beside createCore.
export { isConfigHome, type ScanEnv, scanEnvFromProcess } from "./scan/env.ts";

// Read.
export { compareSettings } from "./scan/compare.ts";
export { revisionOf } from "./scan/files.ts";
export { scanDirectory, scanOverview } from "./scan/index.ts";
export { testPath } from "./scan/path-test.ts";
export { CountStopped, readUsage } from "./scan/usage.ts";
export { hasHiddenValues, redactSecrets, shown, shownText } from "./secrets.ts";
export { Watcher } from "./watch.ts";

// Edits: the parse functions turn input from outside (JSON, arguments) into an edit, or throw
// InvalidEditError. Preview returns a revision, save takes it back. Both refuse with RefusedError,
// also when the file changed since the preview; StaleError, a RefusedError, means it changed while
// ccdesk was writing it.
export { previewAgentEdit, saveAgentEdit } from "./agent-edit.ts";
export {
  claudeProgram,
  claudeRunner,
  previewMcpEdit,
  type RunClaude,
  runClaude,
  saveMcpEdit,
} from "./mcp-edit.ts";
export { changeMemory, isMemoryAction, previewMemoryChange } from "./mutations.ts";
export {
  InvalidEditError,
  parseAgentEdit,
  parseHookEdit,
  parseMcpEdit,
  parsePermissionEdit,
  parseSettingsEdit,
} from "./parse-edit.ts";
export {
  previewHookEdit,
  previewPermissionEdit,
  previewSettingsEdit,
  saveHookEdit,
  savePermissionEdit,
  saveSettingsEdit,
} from "./settings-edit.ts";
export { RefusedError, StaleError } from "./write.ts";

// History: every change ccdesk saves is a backup that can be restored by its id.
export { listBackups, previewRestore, restoreBackup } from "./backups.ts";

// Host.
export { openInEditor } from "./open.ts";

// Claude Code's settings schema, settings catalog and hook events.
export { REFERENCE } from "./reference.ts";

// Types and constants shared with the web UI.
export * from "../shared/compare.ts";
export * from "../shared/memory.ts";
export * from "../shared/scopes.ts";
export * from "../shared/types.ts";
