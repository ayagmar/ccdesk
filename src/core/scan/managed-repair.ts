import { type ManagedRepair } from "../../shared/types.ts";
import { redactSecrets } from "../secrets.ts";
import { isRecord } from "./data.ts";
import { schemaAt, validatorAt } from "./settings-schema.ts";

// Managed settings that fail the settings schema are not dropped whole: Claude Code repairs what it
// can, reads some keys as their most restrictive value, and drops the rest (docs:
// managed-settings#find-entries-claude-code-dropped, #keys-that-fail-closed, #invalid-values-inside-sandbox,
// settings-reference#invalid-credential-entries-in-managed-settings).

type Path = string[];
type Report = (path: Path, written: unknown, note: string) => void;

const QUOTED = "a quoted Boolean, which Claude Code reads as that Boolean; remove the quotes";
const DROPPED = "fails the settings schema, so Claude Code drops it";

/**
 * Top-level keys whose invalid value reads as their one restrictive value: the ones the docs name,
 * the other allow…Only switches they imply, and the two the fallback table gives a value.
 */
const FAIL_CLOSED: Record<string, unknown> = {
  allowManagedPermissionRulesOnly: true,
  allowManagedHooksOnly: true,
  allowManagedMcpServersOnly: true,
  disableAutoMode: "disable",
  skipDangerousModePermissionPrompt: false,
  crossSessionInbound: "refuse",
  availableModelsMatch: "exact",
};

/** Allowlists enforced as empty while their value is invalid, and what that means. */
const EMPTY_WHEN_INVALID: Record<string, string> = {
  allowedMcpServers: "no MCP server users add is admitted",
  allowedProviders: "every API provider is refused and Claude Code does not start",
  allowedHttpHookUrls: "an HTTP hook runs only if another settings file lists its URL",
  httpHookAllowedEnvVars:
    "a header variable is interpolated only if another settings file names it",
  allowedChannelPlugins: "no channel plugin passed to --channels is admitted",
  strictKnownMarketplaces: "no marketplace source is admitted",
  availableModels: "only the Default model is available",
};

/** Keys whose fallback has no value to show, so ccdesk leaves them out and says what Claude Code does. */
const NO_VALUE_WHEN_INVALID: Record<string, string> = {
  forceLoginOrgUUID: "Claude Code permits no organisation to log in until it is fixed",
  gatewayInternalNetworks:
    "when this is the highest managed source, /login refuses every new cloud gateway sign-in until it is fixed",
};

/** Sandbox switches an invalid value turns on, and ones it turns off, keeping the sandbox strictest. */
const SANDBOX_ON = new Set([
  "enabled",
  "network.allowManagedDomainsOnly",
  "network.strictAllowlist",
  "filesystem.allowManagedReadPathsOnly",
]);
const SANDBOX_OFF = new Set([
  "allowUnsandboxedCommands",
  "autoAllowBashIfSandboxed",
  "enableWeakerNestedSandbox",
  "enableWeakerNetworkIsolation",
  "allowAppleEvents",
  "network.allowAllUnixSockets",
  "network.allowLocalBinding",
  "filesystem.disabled",
  "credentials.allowPlaintextInject",
]);

/** Whether `value` passes the schema at `path`; a field the schema does not name passes unless its object is closed. */
function passes(path: Path, value: unknown): boolean {
  const validate = validatorAt(path);
  if (validate) return validate.Check(value);
  return schemaAt(path.slice(0, -1))?.additionalProperties !== false;
}

function quoted(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** A list's valid entries, reporting any stripped; undefined when `value` is not a list. */
function validEntries(path: Path, value: unknown, report: Report): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((entry) => passes([...path, "[]"], entry));
  if (kept.length < value.length)
    report(path, value, `Claude Code strips the ${value.length - kept.length} invalid entries`);
  return kept;
}

/**
 * An object's fields with each invalid one repaired by `fix`, which returns undefined to drop it.
 * An object a repair leaves empty is dropped too.
 */
function repairFields(
  path: Path,
  value: Record<string, unknown>,
  fix: (path: Path, value: unknown) => unknown
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const at = [...path, key];
    const fixed = passes(at, inner) ? inner : fix(at, inner);
    if (fixed !== undefined) out[key] = fixed;
  }
  return Object.keys(out).length === 0 && Object.keys(value).length > 0 ? undefined : out;
}

/** Removes grants Claude Code withholds while the restrictions beside them cannot be read. */
function withhold(
  path: Path,
  value: Record<string, unknown> | undefined,
  fields: string[],
  because: string,
  report: Report
): Record<string, unknown> | undefined {
  if (!value) return value;
  const out = { ...value };
  for (const field of fields) {
    if (out[field] === undefined) continue;
    report([...path, field], out[field], `withheld while ${because} is invalid`);
    delete out[field];
  }
  return out;
}

/** permissions, repaired field by field: locks read as restrictive, grants withheld without their deny and ask lists. */
function repairPermissions(value: Record<string, unknown>, report: Report): unknown {
  const path = ["permissions"];
  const unreadable: string[] = [];
  const out = repairFields(path, value, (at, inner) => {
    const field = at[1];
    if (field === "defaultMode") return readAs(at, inner, "default", report);
    if (field === "disableBypassPermissionsMode") return readAs(at, inner, "disable", report);
    if (field === "blockReadsOutsideWorkingDirectories") return lock(at, inner, true, report);
    const kept = validEntries(at, inner, report);
    if (kept !== undefined) return kept;
    if (field === "deny" || field === "ask") unreadable.push(at.join("."));
    report(at, inner, DROPPED);
    return;
  });
  if (unreadable.length === 0) return out;
  return withhold(path, out, ["allow", "additionalDirectories"], unreadable.join(" and "), report);
}

/** autoMode, repaired field by field: its grants are withheld while a deny list is unreadable or lost an entry. */
function repairAutoMode(value: Record<string, unknown>, report: Report): unknown {
  const path = ["autoMode"];
  const damaged: string[] = [];
  const out = repairFields(path, value, (at, inner) => {
    const field = at[1];
    if (field === "classifyAllShell") return lock(at, inner, true, report);
    if (field === "soft_deny" || field === "hard_deny") damaged.push(at.join("."));
    const kept = validEntries(at, inner, report);
    if (kept === undefined) report(at, inner, DROPPED);
    return kept;
  });
  if (damaged.length === 0) return out;
  return withhold(path, out, ["allow", "environment"], damaged.join(" and "), report);
}

function readAs(path: Path, written: unknown, value: unknown, report: Report): unknown {
  report(path, written, `read as ${JSON.stringify(value)} until it is fixed`);
  return value;
}

/** A switch with a restrictive value: a quoted Boolean reads as that Boolean, anything else as `restrictive`. */
function lock(path: Path, value: unknown, restrictive: unknown, report: Report): unknown {
  const fromQuotes = typeof restrictive === "boolean" ? quoted(value) : undefined;
  if (fromQuotes === undefined) return readAs(path, value, restrictive, report);
  report(path, value, QUOTED);
  return fromQuotes;
}

/** One sandbox field that fails the schema, as Claude Code reads it; undefined to drop it. */
function fixSandboxField(
  path: Path,
  value: unknown,
  report: Report,
  withheld: Set<string>
): unknown {
  const field = path.slice(1).join(".");
  const schema = schemaAt(path);
  if (schema?.type === "boolean") {
    const asBoolean = quoted(value);
    if (asBoolean !== undefined) {
      report(path, value, QUOTED);
      return asBoolean;
    }
    if (SANDBOX_ON.has(field)) return readAs(path, value, true, report);
    if (SANDBOX_OFF.has(field)) return readAs(path, value, false, report);
    // Any other, failIfUnavailable among them, is dropped: an unreadable failIfUnavailable never
    // stops sessions from starting.
  } else if (field === "credentials.files" || field === "credentials.envVars") {
    return credentialEntries(path, value, report);
  } else if (schema?.type === "array") {
    if (field === "network.deniedDomains") withheld.add("network.allowedDomains");
    if (field === "filesystem.denyRead" || field === "filesystem.denyWrite")
      for (const grant of ["filesystem.allowRead", "filesystem.allowWrite"]) withheld.add(grant);
    if (Array.isArray(value)) {
      const kept = value.filter((entry) => passes([...path, "[]"], entry));
      if (kept.length > 0) {
        report(path, value, `Claude Code strips the ${value.length - kept.length} invalid entries`);
        return kept;
      }
    }
    report(path, value, "has no valid entry, so it does not apply");
    return undefined;
  } else if (isRecord(schema?.properties) && isRecord(value)) {
    return repairFields(path, value, (at, inner) => fixSandboxField(at, inner, report, withheld));
  }
  report(path, value, DROPPED);
  return undefined;
}

/**
 * credentials.files or envVars: an entry that still names its path or variable with a known mode is
 * kept as a deny entry, so the credential stays blocked; any other invalid entry is stripped.
 */
function credentialEntries(path: Path, value: unknown, report: Report): unknown {
  if (!Array.isArray(value)) {
    report(path, value, DROPPED);
    return undefined;
  }
  const id = path.at(-1) === "files" ? "path" : "name";
  return value.flatMap((entry) => {
    if (passes([...path, "[]"], entry)) return [entry];
    if (
      isRecord(entry) &&
      typeof entry[id] === "string" &&
      entry[id] !== "" &&
      (entry.mode === "deny" || entry.mode === "mask")
    ) {
      report(path, [entry], 'an invalid entry Claude Code keeps as mode "deny"');
      return [{ [id]: entry[id], mode: "deny" }];
    }
    report(path, [entry], "an invalid entry Claude Code strips");
    return [];
  });
}

/** The sandbox block, repaired field by field rather than dropped whole. */
function repairSandbox(value: Record<string, unknown>, report: Report): unknown {
  const path = ["sandbox"];
  const withheld = new Set<string>();
  const out = repairFields(path, value, (at, inner) =>
    fixSandboxField(at, inner, report, withheld)
  );
  for (const field of withheld) {
    const [group = "", grant = ""] = field.split(".");
    const parent = out?.[group];
    if (!out || !isRecord(parent) || parent[grant] === undefined) continue;
    const because =
      group === "network" ? "sandbox.network.deniedDomains" : "a filesystem deny list";
    report(["sandbox", group, grant], parent[grant], `withheld while ${because} is invalid`);
    const { [grant]: _withheld, ...rest } = parent;
    if (Object.keys(rest).length > 0) out[group] = rest;
    else delete out[group];
  }
  return out;
}

/** One top-level key that fails the schema, as Claude Code reads it; undefined when it drops the key. */
function repairKey(key: string, value: unknown, report: Report): unknown {
  const path = [key];
  if (key === "disableAllHooks") {
    report(
      path,
      value,
      "dropped: enforcing true would also turn off the hooks managed settings deploy"
    );
    return undefined;
  }
  if (key in FAIL_CLOSED) return lock(path, value, FAIL_CLOSED[key], report);
  const empty = EMPTY_WHEN_INVALID[key];
  if (empty !== undefined) {
    const kept = validEntries(path, value, report);
    if (kept !== undefined) return kept;
    report(path, value, `enforced as an empty allowlist until it is fixed, so ${empty}`);
    return [];
  }
  // A value neither Boolean nor list locks all four surfaces; a list entry naming no surface locks nothing.
  if (key === "strictPluginOnlyCustomization" && !Array.isArray(value))
    return readAs(path, value, true, report);
  const noValue = NO_VALUE_WHEN_INVALID[key];
  if (noValue !== undefined) {
    report(path, value, noValue);
    return undefined;
  }
  // Its entries are checked where its servers are read, which shows each one Claude Code drops.
  if (key === "managedMcpServers" && isRecord(value)) return value;
  if (key === "permissions" && isRecord(value)) return repairPermissions(value, report);
  if (key === "autoMode" && isRecord(value)) return repairAutoMode(value, report);
  if (key === "sandbox" && isRecord(value)) return repairSandbox(value, report);
  // Anything else: Claude Code skips each entry of a list or map that fails, and drops a value
  // that still fails, such as deniedMcpServers when it is not a list.
  const perField = key === "worktree" || key === "attribution";
  if (Array.isArray(value)) return validEntries(path, value, report);
  if (isRecord(value) && (perField || isRecord(schemaAt(path)?.additionalProperties))) {
    const out = repairFields(path, value, (at, inner) => report(at, inner, DROPPED));
    if (out === undefined) report(path, value, "has no valid entry, so Claude Code drops it");
    return out;
  }
  report(path, value, DROPPED);
  return undefined;
}

/**
 * Managed settings as Claude Code enforces them, and each entry it reads other than as written,
 * with the written value hidden as the page hides it.
 */
export function repairManaged(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  repairs: ManagedRepair[];
} {
  const repairs: ManagedRepair[] = [];
  const report: Report = (path, written, note) => {
    const nested = path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), written);
    repairs.push({ field: path.join("."), written: redactSecrets(nested), note });
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      report([key], value, "null removes the key");
      continue;
    }
    const fixed = passes([key], value) ? value : repairKey(key, value, report);
    if (fixed !== undefined) out[key] = fixed;
  }
  return { data: out, repairs };
}
