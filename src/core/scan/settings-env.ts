import { type Scope } from "../../shared/types.ts";
import { isRecord } from "./data.ts";
import { type Dropped } from "./sandbox.ts";

/**
 * Variables Claude Code reads from the environment it starts in only, so it ignores them in every
 * settings file (docs: settings-reference#variables-claude-code-ignores-in-env).
 */
const LAUNCH_ONLY = new Set([
  "CLAUDE_CODE_REMOTE",
  "CLAUDE_CODE_ACCOUNT_UUID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "CLAUDE_CODE_RESTRICTED",
  "CLAUDE_CODE_DISABLE_POWERSHELL_CMD_RM_DENY",
  "CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT",
  "CLAUDE_CODE_DISABLE_SUBSTITUTION_RM_PROMPT",
  "CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT",
  "CLAUDE_CODE_DISABLE_MOUNTED_DRIVE_RM_PROMPT",
]);

/** Variables project and local settings cannot set (same section). */
const NOT_FROM_REPOSITORY = new Set([
  // Where Claude Code stores or writes its own files.
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_TMPDIR",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  // Exporting session content.
  "OTEL_LOG_RAW_API_BODIES",
  "ENABLE_BETA_TRACING_DETAILED",
  "BETA_TRACING_ENDPOINT",
  // Turning telemetry on, or choosing where it goes or what it captures.
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
  "ENABLE_ENHANCED_TELEMETRY_BETA",
  "OTEL_LOGS_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_TRACES_EXPORTER",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_ASSISTANT_RESPONSES",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_EXPORTER_PROMETHEUS_HOST",
  "OTEL_EXPORTER_PROMETHEUS_PORT",
  // How Claude Code starts or syncs.
  "CLAUDE_CODE_PROCESS_WRAPPER",
  "CLAUDE_CODE_SYNC_SKILLS",
  "CLAUDE_CODE_SYNC_PLUGINS",
  "CLAUDE_CODE_PLUGIN_CACHE_DIR",
  "CLAUDE_CODE_PLUGIN_SEED_DIR",
  // The timer on an unanswered dialog.
  "CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_ATTACHMENTS",
  "CLAUDE_CODE_DISABLE_FILE_MENTIONS",
]);

/** Windows variables that pick programs and machine-wide configuration; Windows names ignore case. */
const WINDOWS_NOT_FROM_REPOSITORY = new Set([
  "SYSTEMROOT",
  "COMSPEC",
  "PROGRAMDATA",
  "LOCALAPPDATA",
  "PATHEXT",
  "PSMODULEPATH",
]);

/** The XDG_* family, the ProgramFiles family, and the OTLP exporter's endpoint and connection variables. */
const NOT_FROM_REPOSITORY_PATTERNS = [
  /^XDG_/,
  /^PROGRAMFILES/i,
  /^OTEL_EXPORTER_OTLP_(\w+_)?(ENDPOINT|HEADERS|PROTOCOL|CERTIFICATE|CLIENT_KEY|INSECURE)$/,
];

/** The values that still apply from a repository, because they turn telemetry off. */
const OFF_VALUES: Record<string, string[]> = {
  OTEL_LOGS_EXPORTER: ["none"],
  OTEL_METRICS_EXPORTER: ["none"],
  OTEL_TRACES_EXPORTER: ["none"],
  // docs: env-vars, the off values of a variable that turns a behaviour on or off, in any casing.
  OTEL_LOG_USER_PROMPTS: ["0", "false", "no", "off"],
  OTEL_LOG_TOOL_CONTENT: ["0", "false", "no", "off"],
  OTEL_LOG_TOOL_DETAILS: ["0", "false", "no", "off"],
};

/** Why Claude Code ignores `name` with this value from a file of `scope`, or undefined when it applies. */
function ignoredReason(scope: Scope, name: string, value: unknown): string | undefined {
  if (LAUNCH_ONLY.has(name))
    return "Claude Code reads this variable only from the environment it starts in";
  if (scope !== "project" && scope !== "local") return undefined;
  const notFromRepository =
    NOT_FROM_REPOSITORY.has(name) ||
    WINDOWS_NOT_FROM_REPOSITORY.has(name.toUpperCase()) ||
    NOT_FROM_REPOSITORY_PATTERNS.some((p) => p.test(name));
  if (!notFromRepository) return undefined;
  // The OTEL_LOG_* switches take any casing; the exporter selectors are off only as "none".
  const off =
    name.startsWith("OTEL_LOG_") && typeof value === "string" ? value.toLowerCase() : value;
  if (typeof off === "string" && OFF_VALUES[name]?.includes(off)) return undefined;
  return "Project and local settings cannot set this variable; set it in your shell, user or managed settings";
}

/**
 * A repository's `env` held back until you trust the folder, as Claude Code holds it in an
 * interactive session (docs: settings-reference#when-claude-code-applies-env-values,
 * permissions#what-runs-before-you-trust-a-folder). `filtered` is envFilter's result for the file.
 */
export function heldForTrust(filtered: { value: unknown; dropped: Dropped[] }): {
  value: unknown;
  dropped: Dropped[];
} {
  if (filtered.value === undefined) return filtered;
  const held: Dropped = {
    value: filtered.value,
    reason:
      "Claude Code applies project and local env values once you trust this folder; a variable it classifies as safe, such as model selection, timeouts and limits, or a feature toggle, applies at startup, and the docs don't list which those are",
    waitsForTrust: true,
  };
  return { value: undefined, dropped: [...filtered.dropped, held] };
}

/**
 * A file's `env` without the variables Claude Code ignores from it, undefined when none is left, and
 * what was dropped, grouped by reason. `raw` is the same value unhidden, since whether a telemetry
 * variable turns telemetry off depends on its value; only names and hidden values are returned.
 */
export function envFilter(
  scope: Scope,
  value: unknown,
  raw: unknown
): { value: unknown; dropped: Dropped[] } {
  if (!isRecord(value)) return { value, dropped: [] };
  const kept: Record<string, unknown> = {};
  const byReason = new Map<string, Record<string, unknown>>();
  for (const [name, shown] of Object.entries(value)) {
    const reason = ignoredReason(scope, name, isRecord(raw) ? raw[name] : undefined);
    if (!reason) {
      kept[name] = shown;
      continue;
    }
    const group = byReason.get(reason) ?? {};
    group[name] = shown;
    byReason.set(reason, group);
  }
  const dropped = [...byReason].map(([reason, names]) => ({ value: names, reason }));
  const left = dropped.length > 0 && Object.keys(kept).length === 0 ? undefined : kept;
  return { value: dropped.length > 0 ? left : value, dropped };
}
