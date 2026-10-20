// The core: everything a front end needs to read and change Claude Code's configuration, without
// HTTP. It re-exports the modules in src/core and src/shared; see ARCHITECTURE.md for how they
// fit together and docs/split-plan.md for where they are going.

// The core for one machine: createCore(env) returns every read and change with the env already
// passed, its own change queue and usage cache, and the editor and claude its env names. Changes,
// usage counts and undo are made only through a core, so they run on its queue and cache.
export { type Core, type CoreOptions, createCore } from "./core.ts";

// Environment: every function below takes the ScanEnv first.
export { isConfigHome, type ScanEnv, scanEnvFromProcess } from "./scan/env.ts";

// Read.
export { compareSettings } from "./scan/compare.ts";
export { revisionOf } from "./scan/files.ts";
export { canonicalRoot } from "./scan/git.ts";
export { scanDirectory, scanOverview } from "./scan/index.ts";
export { testPath } from "./scan/path-test.ts";
export { CountStopped } from "./scan/usage.ts";
export { hasHiddenValues, redactSecrets, shown, shownText } from "./secrets.ts";
export { Watcher } from "./watch.ts";

// Edits: the parse functions turn input from outside (JSON, arguments) into an edit, or throw
// InvalidEditError. Preview returns a revision, and a core's save takes it back. Both refuse with
// RefusedError, also when the file changed since the preview; StaleError, a RefusedError, means it
// changed while ccdesk was writing it.
export { previewAgentEdit } from "./agent-edit.ts";
export { claudeProgram, claudeRunner, previewMcpEdit, type RunClaude } from "./mcp-edit.ts";
export { previewForget } from "./forget.ts";
export { isMemoryAction, previewMemoryChange } from "./mutations.ts";
export {
  InvalidEditError,
  parseAgentEdit,
  parseHookEdit,
  parseMcpEdit,
  parsePermissionEdit,
  parseSettingsEdit,
} from "./parse-edit.ts";
export { previewHookEdit, previewPermissionEdit, previewSettingsEdit } from "./settings-edit.ts";
export { firstError } from "./schema.ts";
export { RefusedError, StaleError } from "./write.ts";

// History: every change ccdesk saves is a backup that a core can restore by its id.
export { listBackups, previewRestore, showChange } from "./backups.ts";

// Host.
export { openBrowser, openInEditor } from "./open.ts";

// Claude Code's settings schema, settings catalog and hook events.
export { REFERENCE } from "./reference.ts";

// Types and constants shared with the web UI.
export * from "../shared/compare.ts";
export * from "../shared/memory.ts";
export * from "../shared/scopes.ts";
export * from "../shared/types.ts";
