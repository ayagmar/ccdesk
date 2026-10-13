import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { allowedScopes, EVERY_FILE, ignoredReason } from "../../shared/scopes.ts";
import {
  type EffectiveSetting,
  type ManagedRepair,
  type Scope,
  type SettingsLayer,
} from "../../shared/types.ts";
import { schemaErrors } from "../schema.ts";
import { redactSecrets } from "../secrets.ts";
import { isRecord } from "./data.ts";
import { isUserClaudeFolder, type ScanEnv } from "./env.ts";
import { isFile, listDir, readJsonObject } from "./files.ts";
import { mainWorktreeRoot } from "./git.ts";
import { repairManaged } from "./managed-repair.ts";
import { type Dropped, sandboxFilter } from "./sandbox.ts";
import { envFilter } from "./settings-env.ts";
import { hasSchemaType, validatorFor } from "./settings-schema.ts";

/** Lowest precedence first, so later layers override earlier ones. */
const PRECEDENCE: Scope[] = ["user", "project", "local", "managed"];

/** Keys whose whole value comes from the highest layer that sets it, even though they are lists. */
const WHOLE_VALUE_KEYS = new Set(["fallbackModel", "modelPicker"]);
/** Maps whose entries are taken whole from the highest layer that has them, never field by field. */
const WHOLE_ENTRY_KEYS = new Set(["managedMcpServers", "extraKnownMarketplaces"]);

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

/**
 * A file's value for `key` without nested fields Claude Code ignores from that file, and what was
 * dropped; undefined when nothing is left. `raw` is the value unhidden, for the checks that read values.
 */
function withoutIgnoredFields(
  key: string,
  scope: Scope,
  value: unknown,
  raw: unknown,
  filterSandbox: ReturnType<typeof sandboxFilter>
): { value: unknown; dropped: Dropped[] } {
  if (key === "sandbox") return filterSandbox(scope, value);
  if (key === "env") return envFilter(scope, value, raw);
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
  // In the home directory, .claude/settings.json is the user file, not a project layer, whose edits
  // would then change every project.
  if (!(await isUserClaudeFolder(env, dir))) files.push({ scope: "project", path: projectFile });
  files.push({ scope: "user", path: userFile });
  return files;
}

/**
 * What the settings schema rejects in a file, each led by where, such as `cleanupPeriodDays must be
 * number`. A top-level key of the wrong type is the file's top-level shape failing, which rejects
 * the whole file; anything deeper is an entry Claude Code may skip while the rest applies. An
 * unknown nested field is no error: Claude Code's check strips unknown keys from most objects
 * (docs: managed-settings#find-entries-claude-code-dropped, settings#fix-a-broken-settings-file).
 */
function settingsErrors(data: Record<string, unknown>): { file: string[]; entries: string[] } {
  const file: string[] = [];
  const entries: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const validate = validatorFor(key);
    if (!validate) continue;
    // "manual" is an alias Claude Code accepts for "default" (docs: permission-modes).
    const checked =
      key === "permissions" && isRecord(value) && value.defaultMode === "manual"
        ? { ...value, defaultMode: "default" }
        : value;
    const errors = schemaErrors(validate, checked, key).filter(
      (e) => !e.endsWith("must NOT have additional properties")
    );
    if (hasSchemaType([key], checked)) entries.push(...errors);
    else file.push(...errors);
  }
  return { file, entries };
}

/** The first few errors, for a problem line. */
function firstErrors(errors: string[]): string {
  return errors.slice(0, 3).join("; ") + (errors.length > 3 ? "; …" : "");
}

/**
 * Settings files that apply in `dir`, highest precedence first. `managed` is what
 * readManagedSettings read, so a scan reads the managed files once.
 */
export async function readSettingsLayers(
  env: ScanEnv,
  dir: string,
  managed: ManagedSettings
): Promise<SettingsLayer[]> {
  const layers: SettingsLayer[] = [];
  for (const file of await settingsFiles(env, dir)) {
    if (file.scope === "managed") {
      layers.push(managedLayer(file.path, managed));
      continue;
    }
    const result = await readJsonObject(env, file.path);
    if (file.legacy && !result.ok && result.missing) continue;
    const layer: SettingsLayer = { scope: file.scope, path: file.path, exists: true, data: null };
    if (file.legacy) layer.legacy = true;
    const errors = result.ok ? settingsErrors(result.data) : null;
    if (result.ok && errors && errors.file.length > 0) {
      // A user, project or local file whose top-level shape the schema rejects is not applied at
      // all: an interactive session offers to fix it, exit, or continue without it, and claude -p
      // skips it (docs: settings#fix-a-broken-settings-file, managed-settings#find-entries-claude-code-dropped).
      layer.error = `has a value Claude Code's settings schema rejects (${firstErrors(errors.file)}), so Claude Code skips the whole file: an interactive session asks at startup whether to fix it, exit or continue without it, and claude -p skips it`;
    } else if (result.ok) {
      layer.data = redactSecrets(result.data);
      unredacted.set(layer, result.data);
      if (errors && errors.entries.length > 0)
        layer.warning = `has entries Claude Code's settings schema rejects (${firstErrors(errors.entries)}); Claude Code may skip them with a warning, and the rest of the file applies`;
    } else if (result.missing) layer.exists = false;
    else layer.error = result.error;
    layers.push(layer);
  }
  return layers;
}

/**
 * Each layer's data as the file has it, for the checks that must compare real values: an MCP policy
 * entry matches a server's command or URL exactly, secrets included. Kept beside the layer rather
 * than on it, so it never reaches the page with the rest of the view.
 */
const unredacted = new WeakMap<SettingsLayer, Record<string, unknown>>();

/** A layer's data with nothing hidden; only for comparing, never for showing. */
export function unredactedData(layer: SettingsLayer): Record<string, unknown> | null {
  return unredacted.get(layer) ?? null;
}

export interface ManagedSettings {
  data: Record<string, unknown> | null;
  sources: string[];
  dropIns: string[];
  /** Managed sources ccdesk does not read that rank above the files (higherSources). */
  higher: string[];
  errors: string[];
  /** A managed file that is there but not a JSON object: Claude Code refuses to start (docs: managed-settings#find-entries-claude-code-dropped). */
  blocksStart: boolean;
  /** Entries that fail validation; `data` holds them as Claude Code reads them. */
  repairs: ManagedRepair[];
}

/**
 * managed-settings.json, then every *.json in managed-settings.d in alphabetical order, merged and
 * repaired as Claude Code repairs entries that fail validation, with nothing hidden: for checks such
 * as managedMcpServers that must see header values. Never sent to the page as is.
 */
export async function readManagedSettings(env: ScanEnv): Promise<ManagedSettings> {
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
  // Checked once merged, so a later drop-in's null removes a key an earlier file set.
  const repaired = data ? repairManaged(data) : null;
  // Server-managed settings, then MDM, outrank the files; by default Claude Code uses the first
  // source that sets a policy key and skips the rest (docs: managed-settings#how-claude-code-combines-managed-sources).
  const candidates = [join(env.claudeDir, "remote-settings.json"), ...(env.managedProfiles ?? [])];
  const higher: string[] = [];
  for (const source of candidates) if (await isFile(source)) higher.push(source);
  return {
    data: repaired?.data ?? null,
    sources,
    dropIns,
    higher,
    errors,
    blocksStart,
    repairs: repaired?.repairs ?? [],
  };
}

function managedLayer(path: string, managed: ManagedSettings): SettingsLayer {
  const { data, sources, dropIns, higher, errors, blocksStart, repairs } = managed;
  const layer: SettingsLayer = { scope: "managed", path, exists: false, data: null };
  if (data) {
    layer.data = redactSecrets(data);
    unredacted.set(layer, data);
  }
  layer.exists = sources.length > 0 || errors.length > 0;
  if (sources.length > 1 || dropIns.length > 0) layer.sources = sources;
  if (errors.length > 0) layer.error = errors.join("; ");
  if (blocksStart) layer.blocksStart = true;
  if (higher.length > 0) layer.higherSources = higher;
  if (repairs.length > 0) layer.repairs = repairs;
  return layer;
}

/** The value Claude Code ends up with for each top-level key, and where it came from. */
export function effectiveSettings(layers: SettingsLayer[]): EffectiveSetting[] {
  // Layers are highest first; a second layer of one scope (a legacy local file) sits under the first.
  const byScope = new Map<Scope, Record<string, unknown>>();
  const rawByScope = new Map<Scope, Record<string, unknown>>();
  for (const layer of layers) {
    if (!layer.data) continue;
    const raw = unredactedData(layer) ?? layer.data;
    const higher = byScope.get(layer.scope);
    const rawHigher = rawByScope.get(layer.scope);
    byScope.set(layer.scope, higher ? mergeSettings(layer.data, higher) : layer.data);
    rawByScope.set(layer.scope, rawHigher ? mergeSettings(raw, rawHigher) : raw);
  }
  const keys = new Set([...byScope.values()].flatMap((data) => Object.keys(data)));
  const filterSandbox = sandboxFilter((key, scope) =>
    allowedScopes(key).includes(scope) ? byScope.get(scope)?.[key] : undefined
  );
  return [...keys].sort().map((key) => {
    const setting = effectiveSetting(
      key,
      (scope) => byScope.get(scope)?.[key],
      (scope) => rawByScope.get(scope)?.[key],
      filterSandbox
    );
    return key === "modelSettings"
      ? withModelEffort(setting, (k, scope) => byScope.get(scope)?.[k])
      : setting;
  });
}

/**
 * modelSettings with each model's effortLevel and maxEffortLevel as Claude Code resolves them; its
 * other fields merge field by field. The level comes from the highest file that sets it for the
 * model, or that sets a top-level effortLevel applying to every model (any file but user settings,
 * where it applies only to older models). Each file caps the model at its entry's maxEffortLevel,
 * else its top-level one, and the lowest cap holds (docs: settings-reference#modelsettings,
 * #maxeffortlevel).
 */
function withModelEffort(
  setting: EffectiveSetting,
  valueIn: (key: string, scope: Scope) => unknown
): EffectiveSetting {
  if (!isRecord(setting.value)) return setting;
  const ladder = STRICTEST.maxEffortLevel?.ladder ?? [];
  const entryIn = (scope: Scope, model: string) => {
    const models = valueIn("modelSettings", scope);
    const entry = isRecord(models) ? models[model] : undefined;
    return isRecord(entry) ? entry : {};
  };
  const value: Record<string, unknown> = {};
  const overridden = [...setting.overridden];
  for (const [model, merged] of Object.entries(setting.value)) {
    if (!isRecord(merged)) {
      value[model] = merged;
      continue;
    }
    const { effortLevel: _level, maxEffortLevel: cap, ...entry } = merged;
    let decided = false;
    for (const scope of [...PRECEDENCE].reverse()) {
      const level = entryIn(scope, model).effortLevel;
      if (level !== undefined && decided)
        overridden.push({ scope, value: { [model]: { effortLevel: level } } });
      else if (level !== undefined) entry.effortLevel = level;
      decided ||=
        level !== undefined || (scope !== "user" && valueIn("effortLevel", scope) !== undefined);
    }
    if (PRECEDENCE.some((scope) => entryIn(scope, model).maxEffortLevel !== undefined)) {
      const caps = PRECEDENCE.map(
        (scope) => entryIn(scope, model).maxEffortLevel ?? valueIn("maxEffortLevel", scope)
      );
      // Starts from the highest entry's own cap, so an invalid one still shows when no cap is valid.
      entry.maxEffortLevel = caps.reduce(
        (low, c) => (ladder.indexOf(c) > ladder.indexOf(low) ? c : low),
        cap
      );
    }
    value[model] = entry;
  }
  return {
    ...setting,
    value,
    overridden,
    note: "Claude Code takes each model's effortLevel from the highest file that sets it, and caps the model at the lowest maxEffortLevel any file gives it",
  };
}

/** One key's value, from its value in each scope, lowest precedence first. */
function effectiveSetting(
  key: string,
  valueIn: (scope: Scope) => unknown,
  rawIn: (scope: Scope) => unknown,
  filterSandbox: ReturnType<typeof sandboxFilter>
): EffectiveSetting {
  const { defined, ignored } = scopesThatCount(key, valueIn);
  const values = defined.flatMap((scope) => {
    const { value, dropped } = withoutIgnoredFields(
      key,
      scope,
      valueIn(scope),
      rawIn(scope),
      filterSandbox
    );
    for (const d of dropped) ignored.push({ scope, ...d });
    return value === undefined ? [] : [{ scope, value }];
  });
  const top = values.at(-1);
  if (!top) return { key, value: undefined, from: [], merged: false, overridden: [], ignored };
  const strict = STRICTEST[key];
  const decided = strict && strictWinner(strict, values);
  if (strict && decided) {
    const { winner } = decided;
    // Only files that may just tighten it set the key, and none tightens it past the default.
    if (!winner)
      for (const v of values)
        ignored.push({ ...v, reason: "it is not stricter than Claude Code's default" });
    return {
      key,
      value: winner?.value,
      from: winner ? [winner.scope] : [],
      merged: false,
      overridden: winner ? values.filter((v) => v !== winner).reverse() : [],
      ignored,
      note: strictNote(strict),
    };
  }
  const mergeable =
    !WHOLE_VALUE_KEYS.has(key) && values.every((v) => Array.isArray(v.value) || isRecord(v.value));
  if (mergeable && values.length > 1)
    return {
      key,
      value: withStrictFields(
        key,
        values.slice(1).reduce((acc, v) => mergeKey(key, acc, v.value), values[0]?.value),
        values
      ),
      from: values.map((v) => v.scope),
      merged: true,
      overridden: [],
      ignored,
    };
  return {
    key,
    value: withStrictFields(key, top.value, values),
    from: [top.scope],
    merged: false,
    overridden: values.slice(0, -1).reverse(),
    ignored,
  };
}

/**
 * The scopes whose value for `key` counts, lowest precedence first, and the values Claude Code
 * ignores: ones from files the key is not read from, and, once managed settings set
 * availableModels, every other file's list, since Claude Code uses the managed one as-is.
 */
function scopesThatCount(
  key: string,
  valueIn: (scope: Scope) => unknown
): { defined: Scope[]; ignored: EffectiveSetting["ignored"] } {
  const allowed = allowedScopes(key);
  const present = PRECEDENCE.filter((scope) => valueIn(scope) !== undefined);
  const ignored = present
    .filter((scope) => !allowed.includes(scope))
    .map((scope) => ({ scope, value: valueIn(scope), reason: ignoredReason(key) }));
  const defined = present.filter((scope) => allowed.includes(scope));
  if (key !== "availableModels" || !defined.includes("managed")) return { defined, ignored };
  for (const scope of defined.filter((s) => s !== "managed"))
    ignored.push({
      scope,
      value: valueIn(scope),
      reason: "Managed settings set availableModels, so Claude Code uses that list as-is",
    });
  return { defined: ["managed"], ignored };
}

/** An object setting with each nested strictness exception (such as permissions.x) applied. */
function withStrictFields(key: string, value: unknown, values: Valued[]): unknown {
  if (!isRecord(value)) return value;
  let out = value;
  for (const [path, strict] of Object.entries(STRICTEST)) {
    const [head, field] = path.split(".");
    if (head !== key || !field) continue;
    const fieldValues = values.flatMap((v) =>
      isRecord(v.value) && v.value[field] !== undefined
        ? [{ scope: v.scope, value: v.value[field] }]
        : []
    );
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
