import { type Scope } from "../../shared/types.ts";
import { isRecord, stringsIn } from "./files.ts";

/** A part of one file's `sandbox` value that Claude Code ignores, and why. */
export interface Dropped {
  value: unknown;
  reason: string;
}

interface Rule {
  /** A field under `sandbox`, such as `network.allowedDomains`. */
  field: string;
  /** The files it is ignored from. */
  from: Scope[];
  reason: string;
  /** Ignores only this value or these list entries, not the whole field. */
  drops?: { value: unknown } | { entries: (entry: unknown) => boolean };
}

const REPOSITORY: Scope[] = ["project", "local"];
const NOT_MANAGED: Scope[] = ["user", "project", "local"];

function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (isRecord(o) ? o[k] : undefined), value);
}

function nested(path: string[], leaf: unknown): unknown {
  return path.reduceRight<unknown>((acc, k) => ({ [k]: acc }), leaf);
}

/**
 * `value` with the field at `path` set to `leaf`, or removed when `leaf` is undefined, along with
 * any object that removal leaves empty.
 */
function replaced(
  value: Record<string, unknown>,
  path: string[],
  leaf: unknown
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const out = { ...value };
  const child = out[head];
  if (rest.length > 0 && !isRecord(child)) return value;
  const next = isRecord(child) && rest.length > 0 ? replaced(child, rest, leaf) : leaf;
  if (next === undefined || (isRecord(next) && Object.keys(next).length === 0)) delete out[head];
  else out[head] = next;
  return out;
}

/**
 * Which `sandbox` fields Claude Code ignores from which files, given every file's `sandbox` and
 * `permissions` values (docs: settings-reference#sandbox-settings, sandboxing#keep-developers-from-widening-the-policy).
 * Locks that depend on paths, such as allowRead entries under a path that managed settings deny
 * reading, and anything the --settings flag sets, are not modelled.
 */
function rulesFor(valueIn: (key: string, scope: Scope) => unknown): Rule[] {
  const managed = valueIn("sandbox", "managed");
  const user = valueIn("sandbox", "user");
  const managedSays = (path: string, value: unknown) => at(managed, path.split(".")) === value;

  const rules: Rule[] = [];
  const add = (fields: string[], from: Scope[], reason: string, drops?: Rule["drops"]) => {
    for (const field of fields) rules.push({ field, from, reason, ...(drops ? { drops } : {}) });
  };

  // Keys read from fewer files (docs: settings-reference, each key's Scope).
  for (const field of [
    "filesystem.allowManagedReadPathsOnly",
    "network.allowManagedDomainsOnly",
    "bwrapPath",
    "socatPath",
  ])
    add([field], NOT_MANAGED, `Claude Code reads sandbox.${field} only from managed settings`);
  for (const field of [
    "allowAppleEvents",
    "ripgrep",
    "credentials.allowPlaintextInject",
    "credentials.awsPairs",
    "credentials.sigv4",
    "network.strictAllowlist",
    "network.tlsTerminate",
  ])
    add(
      [field],
      REPOSITORY,
      `Claude Code reads sandbox.${field} only from user or managed settings`
    );
  // docs: sandboxing#which-settings-can-disable-it
  const managedFiles = at(managed, ["credentials", "files"]);
  const filesystemLocked =
    isRecord(at(managed, ["filesystem"])) ||
    (Array.isArray(managedFiles) && managedFiles.some((f) => isRecord(f) && f.mode === "deny"));
  add(
    ["filesystem.disabled"],
    filesystemLocked ? NOT_MANAGED : REPOSITORY,
    filesystemLocked
      ? "Managed settings configure the sandbox filesystem, so only they can turn it off"
      : "Claude Code reads sandbox.filesystem.disabled only from user or managed settings"
  );
  add(
    ["credentials.files", "credentials.envVars"],
    REPOSITORY,
    "Claude Code drops mask entries from repository settings",
    { entries: (e) => isRecord(e) && e.mode === "mask" }
  );

  // docs: sandboxing#turn-off-the-retry-with-strict-sandbox-mode
  if (
    managedSays("allowUnsandboxedCommands", false) ||
    at(user, ["allowUnsandboxedCommands"]) === false
  )
    add(
      ["allowUnsandboxedCommands"],
      REPOSITORY,
      "A false in user or managed settings holds against a repository's true",
      { value: true }
    );

  // Managed-only locks (docs: sandboxing#keep-developers-from-widening-the-policy).
  if (managedSays("filesystem.allowManagedReadPathsOnly", true))
    add(
      ["filesystem.allowRead"],
      NOT_MANAGED,
      "Managed settings honor only their own allowRead entries (allowManagedReadPathsOnly)"
    );
  const domainsLocked = managedSays("network.allowManagedDomainsOnly", true);
  if (domainsLocked)
    add(
      ["network.allowedDomains", "network.httpProxyPort", "network.socksProxyPort"],
      NOT_MANAGED,
      "Managed settings honor only their own domains and proxy ports (allowManagedDomainsOnly)"
    );

  // docs: sandboxing#repository-settings-under-an-admin-required-sandbox
  if (managedSays("allowUnsandboxedCommands", false) || domainsLocked) {
    const reason =
      "Managed settings require the sandbox, so Claude Code ignores repository settings that loosen it";
    add(
      [
        "excludedCommands",
        "ignoreViolations",
        "network.allowedDomains",
        "network.allowUnixSockets",
        "network.allowMachLookup",
        "network.httpProxyPort",
        "network.socksProxyPort",
        "filesystem.allowWrite",
      ],
      REPOSITORY,
      reason
    );
    add(
      [
        "enableWeakerNestedSandbox",
        "enableWeakerNetworkIsolation",
        "network.allowAllUnixSockets",
        "network.allowLocalBinding",
      ],
      REPOSITORY,
      reason,
      { value: true }
    );
    for (const field of ["enabled", "failIfUnavailable"])
      if (at(user, [field]) === true) add([field], REPOSITORY, reason, { value: false });
  }

  // docs: sandboxing#locks-that-apply-without-an-admin-required-sandbox
  const managedDeny = stringsIn(at(valueIn("permissions", "managed"), ["deny"]));
  if (
    stringsIn(at(managed, ["network", "deniedDomains"])).length > 0 ||
    managedDeny.some((rule) => rule.startsWith("WebFetch(domain:"))
  )
    add(
      ["network.httpProxyPort", "network.socksProxyPort"],
      REPOSITORY,
      "Managed settings deny domains, so a repository cannot set a proxy port"
    );
  const strictAllowlist =
    at(managed, ["network", "strictAllowlist"]) ?? at(user, ["network", "strictAllowlist"]);
  if (strictAllowlist === true)
    add(
      ["network.allowedDomains", "network.httpProxyPort", "network.socksProxyPort"],
      REPOSITORY,
      "strictAllowlist is on, so Claude Code ignores a repository's domains and proxy ports"
    );

  // While the block covers sandboxed commands, repository allowRead and allowWrite entries do not
  // count; it does not when filesystem isolation is off or allowManagedReadPathsOnly is set
  // (docs: settings-reference#sandboxed-commands-under-the-block).
  const blocked = (["user", "project", "local", "managed"] as const).some(
    (s) => at(valueIn("permissions", s), ["blockReadsOutsideWorkingDirectories"]) === true
  );
  const filesystemOff =
    (filesystemLocked ? [managed] : [managed, user])
      .map((v) => at(v, ["filesystem", "disabled"]))
      .find((v) => v !== undefined) === true;
  if (blocked && !filesystemOff && !managedSays("filesystem.allowManagedReadPathsOnly", true))
    add(
      ["filesystem.allowRead", "filesystem.allowWrite"],
      REPOSITORY,
      "blockReadsOutsideWorkingDirectories is on, so repository allowRead and allowWrite entries do not count"
    );
  return rules;
}

/**
 * A filter for each file's `sandbox` value: what is left once the fields Claude Code ignores from
 * that file are taken out, and what was taken out.
 */
export function sandboxFilter(valueIn: (key: string, scope: Scope) => unknown) {
  const rules = rulesFor(valueIn);
  return (scope: Scope, value: unknown): { value: unknown; dropped: Dropped[] } => {
    if (!isRecord(value)) return { value, dropped: [] };
    let out = value;
    const dropped: Dropped[] = [];
    for (const rule of rules) {
      if (!rule.from.includes(scope)) continue;
      const path = rule.field.split(".");
      const field = at(out, path);
      if (field === undefined) continue;
      const drops = rule.drops;
      let removed: unknown = field;
      let kept: unknown;
      if (drops && "value" in drops) {
        if (field !== drops.value) continue;
      } else if (drops) {
        if (!Array.isArray(field)) continue;
        removed = field.filter(drops.entries);
        if ((removed as unknown[]).length === 0) continue;
        kept = field.filter((e) => !drops.entries(e));
      }
      out = replaced(out, path, kept);
      dropped.push({ value: nested(path, removed), reason: rule.reason });
    }
    return { value: out, dropped };
  };
}
