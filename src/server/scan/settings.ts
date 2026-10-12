import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { allowedScopes, EVERY_FILE, ignoredReason } from "../../shared/scopes.ts";
import { type EffectiveSetting, type Scope, type SettingsLayer } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isRecord, listDir, mainWorktreeRoot, readJsonObject, redactSecrets } from "./files.ts";
import { type Dropped, sandboxFilter } from "./sandbox.ts";

/** Lowest precedence first, so later layers override earlier ones. */
const PRECEDENCE: Scope[] = ["user", "project", "local", "managed"];

/** Keys whose whole value comes from the highest layer that sets it, even though they are lists. */
const WHOLE_VALUE_KEYS = new Set(["fallbackModel", "modelPicker"]);
/** Maps whose entries are taken whole from the highest layer that has them, never field by field. */
const WHOLE_ENTRY_KEYS = new Set(["managedMcpServers", "extraKnownMarketplaces", "modelSettings"]);

interface Strict {
  /** Least strict value first. */
  ladder: unknown[];
  /** Files whose stricter value is honoured over a higher file. */
  from: Scope[];
  /** Values in `from` files only ever tighten: one that is not stricter is ignored. */
  onlyTightens?: boolean;
}

/**
 * Keys, some nested, where Claude Code honours the more restrictive value from some files even over
 * a higher file (docs: settings#exceptions-to-managed-settings-precedence).
 */
const STRICTEST: Record<string, Strict> = {
  disableClaudeAiConnectors: { ladder: [false, true], from: EVERY_FILE },
  isolatePeerMachines: { ladder: [false, true], from: EVERY_FILE },
  enableArtifact: { ladder: [true, false], from: EVERY_FILE },
  disableArtifact: { ladder: [false, true], from: EVERY_FILE },
  "permissions.blockReadsOutsideWorkingDirectories": { ladder: [false, true], from: EVERY_FILE },
  "autoMode.classifyAllShell": { ladder: [false, true], from: ["user"] },
  maxEffortLevel: { ladder: ["max", "xhigh", "high", "medium", "low"], from: EVERY_FILE },
  useAutoModeDuringPlan: { ladder: [true, false], from: ["managed", "user", "local"] },
  syncClaudeAiSkills: { ladder: [true, false], from: ["managed", "user", "local"] },
  syncClaudeAiPlugins: { ladder: [true, false], from: ["managed", "user", "local"] },
  remoteControlAtStartup: { ladder: [true, false], from: ["project", "local"], onlyTightens: true },
  crossSessionInbound: {
    ladder: ["accept", "hold", "refuse"],
    from: ["project", "local"],
    onlyTightens: true,
  },
};

/**
 * Why Claude Code ignores a `permissions.defaultMode` from this file, or undefined when it may apply:
 * a repository's settings cannot start sessions in auto or bypass mode (docs: permission-modes).
 */
export function ignoredModeReason(scope: Scope, mode: unknown): string | undefined {
  if (
    (scope === "project" || scope === "local") &&
    (mode === "auto" || mode === "bypassPermissions")
  )
    return `${mode} takes effect only from user or managed settings`;
  return undefined;
}

/** A file's value for `key` without nested fields Claude Code ignores from that file, and what was dropped. */
function withoutIgnoredFields(
  key: string,
  scope: Scope,
  value: unknown,
  filterSandbox: ReturnType<typeof sandboxFilter>
): { value: unknown; dropped: Dropped[] } {
  if (key === "sandbox") return filterSandbox(scope, value);
  if (key !== "permissions" || !isRecord(value)) return { value, dropped: [] };
  const reason = ignoredModeReason(scope, value.defaultMode);
  if (!reason) return { value, dropped: [] };
  const { defaultMode, ...rest } = value;
  return { value: rest, dropped: [{ value: { defaultMode }, reason }] };
}

type Valued = { scope: Scope; value: unknown };

/**
 * The value that wins for a key with a strictness exception, given its values lowest precedence
 * first; undefined when plain precedence decides.
 */
function strictWinner(strict: Strict, values: Valued[]): { winner: Valued | null } | undefined {
  const rank = (value: unknown) => strict.ladder.indexOf(value);
  const honoured = values.filter((v) => strict.from.includes(v.scope) && rank(v.value) >= 0);
  const strictest = honoured.reduce<Valued | undefined>(
    (best, v) => (!best || rank(v.value) > rank(best.value) ? v : best),
    undefined
  );
  const top = strict.onlyTightens
    ? values.filter((v) => !strict.from.includes(v.scope)).at(-1)
    : values.at(-1);
  const baseline = top ? rank(top.value) : 0;
  if (strictest && rank(strictest.value) > baseline) return { winner: strictest };
  if (strict.onlyTightens && honoured.length > 0) return { winner: top ?? null };
  return undefined;
}

function strictNote(strict: Strict): string {
  const files = strict.from.length === 4 ? "any" : strict.from.join(" or ");
  return strict.onlyTightens
    ? `Claude Code takes this key from ${files} settings only when it is stricter`
    : `Claude Code keeps the strictest value of this key, from ${files} settings`;
}

/** Combines one key's values from two layers, `over` being the higher one. */
function mergeKey(key: string, base: unknown, over: unknown): unknown {
  if (WHOLE_VALUE_KEYS.has(key)) return over;
  if (WHOLE_ENTRY_KEYS.has(key) && isRecord(base) && isRecord(over)) return { ...base, ...over };
  return deepMerge(base, over);
}

/** Combines two whole settings files, `over` being the higher one. */
function mergeSettings(
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(over))
    out[key] = key in out ? mergeKey(key, out[key], value) : value;
  return out;
}

/**
 * Where Claude Code keeps `.claude/settings.local.json` for a session started in `dir`: the
 * repository root (the main checkout's root in a worktree), except outside git, when that root is
 * the home directory, on Windows, or when the root, its .git or its .claude is not yours
 * (docs: settings#where-claude-code-looks-for-each-file).
 */
async function localSettingsDir(env: ScanEnv, dir: string): Promise<string> {
  if (env.platform === "win32") return dir;
  const root = await mainWorktreeRoot(dir);
  if (!root || root === env.home) return dir;
  const uid = process.getuid?.();
  for (const path of [root, join(root, ".git"), join(root, ".claude")]) {
    const info = await lstat(path).catch(() => null);
    if (info && uid !== undefined && info.uid !== uid) return dir;
  }
  return root;
}

export interface SettingsFile {
  scope: Scope;
  path: string;
  legacy?: boolean;
}

/** The settings files Claude Code reads in `dir`, highest precedence first. */
export async function settingsFiles(env: ScanEnv, dir: string): Promise<SettingsFile[]> {
  const localDir = await localSettingsDir(env, dir);
  const userFile = join(env.claudeDir, "settings.json");
  const files: SettingsFile[] = [
    { scope: "managed", path: join(env.managedDir, "managed-settings.json") },
    { scope: "local", path: join(localDir, ".claude", "settings.local.json") },
  ];
  // Before v2.1.211 the local file lived in the start directory; Claude Code still reads one left there.
  if (localDir !== dir)
    files.push({ scope: "local", path: join(dir, ".claude", "settings.local.json"), legacy: true });
  const projectFile = join(dir, ".claude", "settings.json");
  // In the home directory, .claude/settings.json is the user file, not a project layer.
  if (projectFile !== userFile) files.push({ scope: "project", path: projectFile });
  files.push({ scope: "user", path: userFile });
  return files;
}

/** Settings files that apply in `dir`, highest precedence first. */
export async function readSettingsLayers(env: ScanEnv, dir: string): Promise<SettingsLayer[]> {
  const layers: SettingsLayer[] = [];
  for (const file of await settingsFiles(env, dir)) {
    if (file.scope === "managed") {
      layers.push(await readManagedLayer(env, file.path));
      continue;
    }
    const result = await readJsonObject(env, file.path);
    if (file.legacy && !result.ok && result.missing) continue;
    const layer: SettingsLayer = { scope: file.scope, path: file.path, exists: true, data: null };
    if (file.legacy) layer.legacy = true;
    if (result.ok) layer.data = redactSecrets(result.data) as Record<string, unknown>;
    else if (result.missing) layer.exists = false;
    else layer.error = result.error;
    layers.push(layer);
  }
  return layers;
}

/**
 * managed-settings.json, then every *.json in managed-settings.d in alphabetical order, merged, with
 * nothing hidden: for checks such as managedMcpServers that must see header values. Never sent to the
 * page as is.
 */
export async function readManagedSettings(env: ScanEnv): Promise<{
  data: Record<string, unknown> | null;
  sources: string[];
  dropIns: string[];
  errors: string[];
  /** A managed file that is there but not a JSON object: Claude Code refuses to start (docs: managed-settings#find-entries-claude-code-dropped). */
  blocksStart: boolean;
}> {
  const dropInDir = join(env.managedDir, "managed-settings.d");
  const dropIns = (await listDir(dropInDir))
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => join(dropInDir, name));
  const sources: string[] = [];
  const errors: string[] = [];
  let blocksStart = false;
  let data: Record<string, unknown> | null = null;
  for (const source of [join(env.managedDir, "managed-settings.json"), ...dropIns]) {
    // An empty managed file counts as {}.
    const result = await readJsonObject(env, source, { emptyIsObject: true });
    if (!result.ok) {
      if (!result.missing) errors.push(`${source}: ${result.error}`);
      if (result.unparsed) blocksStart = true;
      continue;
    }
    sources.push(source);
    data = data ? mergeSettings(data, result.data) : result.data;
  }
  return { data, sources, dropIns, errors, blocksStart };
}

async function readManagedLayer(env: ScanEnv, path: string): Promise<SettingsLayer> {
  const { data, sources, dropIns, errors, blocksStart } = await readManagedSettings(env);
  const layer: SettingsLayer = { scope: "managed", path, exists: false, data: null };
  if (data) layer.data = redactSecrets(data) as Record<string, unknown>;
  layer.exists = sources.length > 0 || errors.length > 0;
  if (sources.length > 1 || dropIns.length > 0) layer.sources = sources;
  if (errors.length > 0) layer.error = errors.join("; ");
  if (blocksStart) layer.blocksStart = true;
  return layer;
}

/** The value Claude Code ends up with for each top-level key, and where it came from. */
export function effectiveSettings(layers: SettingsLayer[]): EffectiveSetting[] {
  // Layers are highest first; a second layer of one scope (a legacy local file) sits under the first.
  const byScope = new Map<Scope, Record<string, unknown>>();
  for (const layer of layers) {
    if (!layer.data) continue;
    const higher = byScope.get(layer.scope);
    byScope.set(layer.scope, higher ? mergeSettings(layer.data, higher) : layer.data);
  }
  const keys = new Set([...byScope.values()].flatMap((data) => Object.keys(data)));
  const filterSandbox = sandboxFilter((key, scope) =>
    allowedScopes(key).includes(scope) ? byScope.get(scope)?.[key] : undefined
  );
  const out: EffectiveSetting[] = [];
  for (const key of [...keys].sort()) {
    const allowed = allowedScopes(key);
    const present = PRECEDENCE.filter((scope) => byScope.get(scope)?.[key] !== undefined);
    const valueIn = (scope: Scope) => byScope.get(scope)?.[key];
    const ignored = present
      .filter((scope) => !allowed.includes(scope))
      .map((scope) => ({ scope, value: valueIn(scope), reason: ignoredReason(key) }));
    let defined = present.filter((scope) => allowed.includes(scope));
    // A managed availableModels list is applied as-is; other files' entries are ignored.
    if (key === "availableModels" && defined.includes("managed")) {
      for (const scope of defined.filter((s) => s !== "managed"))
        ignored.push({
          scope,
          value: valueIn(scope),
          reason: "Managed settings set availableModels, so Claude Code uses that list as-is",
        });
      defined = ["managed"];
    }
    if (defined.length === 0) {
      out.push({ key, value: undefined, from: [], merged: false, overridden: [], ignored });
      continue;
    }
    const values = defined.map((scope) => {
      const { value, dropped } = withoutIgnoredFields(key, scope, valueIn(scope), filterSandbox);
      for (const d of dropped) ignored.push({ scope, ...d });
      return { scope, value };
    });
    const top = values[values.length - 1];
    if (!top) continue;
    const mergeable =
      !WHOLE_VALUE_KEYS.has(key) &&
      values.every((v) => Array.isArray(v.value) || isRecord(v.value));
    const strict = STRICTEST[key];
    const decided = strict && strictWinner(strict, values);
    if (strict && decided) {
      const { winner } = decided;
      // Only files that may just tighten it set the key, and none tightens it past the default.
      if (!winner)
        for (const v of values)
          ignored.push({ ...v, reason: "it is not stricter than Claude Code's default" });
      out.push({
        key,
        value: winner?.value,
        from: winner ? [winner.scope] : [],
        merged: false,
        overridden: winner ? values.filter((v) => v !== winner).reverse() : [],
        ignored,
        note: strictNote(strict),
      });
    } else if (mergeable && values.length > 1) {
      out.push({
        key,
        value: withStrictFields(
          key,
          values.slice(1).reduce((acc, v) => mergeKey(key, acc, v.value), values[0]?.value),
          values
        ),
        from: defined,
        merged: true,
        overridden: [],
        ignored,
      });
    } else if (isRecord(top.value)) {
      out.push({
        key,
        value: withStrictFields(key, top.value, values),
        from: [top.scope],
        merged: false,
        overridden: values.slice(0, -1).reverse(),
        ignored,
      });
    } else {
      out.push({
        key,
        value: top.value,
        from: [top.scope],
        merged: false,
        overridden: values.slice(0, -1).reverse(),
        ignored,
      });
    }
  }
  return out;
}

/** An object setting with each nested strictness exception (such as permissions.x) applied. */
function withStrictFields(key: string, value: unknown, values: Valued[]): unknown {
  if (!isRecord(value)) return value;
  let out = value;
  for (const [path, strict] of Object.entries(STRICTEST)) {
    const [head, field] = path.split(".");
    if (head !== key || !field) continue;
    const fieldValues = values
      .filter((v) => isRecord(v.value) && (v.value as Record<string, unknown>)[field] !== undefined)
      .map((v) => ({ scope: v.scope, value: (v.value as Record<string, unknown>)[field] }));
    const decided = strictWinner(strict, fieldValues);
    if (decided) out = { ...out, [field]: decided.winner?.value };
  }
  return out;
}

/** Objects merge by key, lists concatenate without duplicates, anything else is replaced. */
function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over)) {
    const seen = new Set(base.map((v) => JSON.stringify(v)));
    return [...base, ...over.filter((v) => !seen.has(JSON.stringify(v)))];
  }
  if (isRecord(base) && isRecord(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
    return out;
  }
  return over;
}
