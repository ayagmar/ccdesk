import { join, resolve } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import {
  type Plugin,
  type Problem,
  type Scope,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isWithin, listDir, readJsonOrReport, resolvedPath, stringField } from "./files.ts";
import { isRecord } from "./data.ts";
import { isSyncedFolder } from "./names.ts";

function manifestPath(plugin: Plugin): string {
  return join(plugin.installPath, ".claude-plugin", "plugin.json");
}

/** A plugin with its manifest, which a scan reads once. */
export interface LoadedPlugin {
  plugin: Plugin;
  /** `.claude-plugin/plugin.json`, or `{}` when there is none or it does not parse. */
  manifest: Record<string, unknown>;
}

/** Reads a plugin's manifest; one that is there but does not parse goes into `problems`. */
export async function loadPlugin(
  env: ScanEnv,
  plugin: Plugin,
  problems: Problem[]
): Promise<LoadedPlugin> {
  return { plugin, manifest: (await readJsonOrReport(env, manifestPath(plugin), problems)) ?? {} };
}

/**
 * The prefix of a plugin's skills, commands and agents: the manifest's name, which wins over the
 * name the plugin is enabled under (docs: plugins-reference#name, #metadata-precedence).
 */
export function pluginNamespace({ plugin, manifest }: LoadedPlugin): string {
  return stringField(manifest, "name") || (plugin.id.split("@")[0] ?? plugin.id);
}

/** A part of Claude Code that managed strictPluginOnlyCustomization can lock to plugins and managed settings. */
export type Surface = "skills" | "agents" | "hooks" | "mcp";

/**
 * The surfaces managed settings lock: true locks all four, a list the ones it names; an entry
 * naming no surface locks nothing (docs: settings-reference#strictpluginonlycustomization).
 */
export function pluginOnlySurfaces(managed: Record<string, unknown> | null): Set<Surface> {
  const value = managed?.strictPluginOnlyCustomization;
  if (value === true) return new Set(["skills", "agents", "hooks", "mcp"]);
  const all: Surface[] = ["skills", "agents", "hooks", "mcp"];
  return new Set(all.filter((surface) => Array.isArray(value) && value.includes(surface)));
}

/** Why Claude Code does not load an entry from your or the project's files on a locked surface. */
export function pluginOnlyNote(surface: Surface): string {
  return `Managed settings allow ${surface === "mcp" ? "MCP servers" : surface} only from plugins and managed settings (strictPluginOnlyCustomization)`;
}

/**
 * The enabledPlugins entry that decides a plugin: from the highest-precedence settings file that
 * names it under any of `ids`, the first id it names winning there. An installed plugin is on
 * unless that entry is false.
 */
export function enabledPluginsEntry(
  layers: SettingsLayer[],
  ids: string[]
): { scope: Scope; value: unknown } | undefined {
  for (const scope of HIGHEST_FIRST)
    for (const layer of layers.filter((l) => l.scope === scope)) {
      const flags = layer.data?.enabledPlugins;
      if (!isRecord(flags)) continue;
      const id = ids.find((i) => flags[i] !== undefined);
      if (id) return { scope, value: flags[id] };
    }
  return undefined;
}

/**
 * The plugins root, which holds installed_plugins.json, known_marketplaces.json and the plugins'
 * data folders: CLAUDE_CODE_PLUGIN_CACHE_DIR, else plugins in the Claude folder (docs:
 * plugins/loading#find-plugins-on-disk).
 */
export function pluginsRoot(env: ScanEnv): string {
  return env.pluginsDir ?? join(env.claudeDir, "plugins");
}

/** The origin of plugins saved as folders under a skills folder (docs: plugins/loading#find-where-a-plugin-came-from). */
const SKILLS_DIR = "skills-dir";

/** Whether a plugin is a folder in a skills folder, loaded in place. */
export function isSkillsDirPlugin(plugin: Plugin): boolean {
  return plugin.id.endsWith(`@${SKILLS_DIR}`);
}

/**
 * The skills-dir plugin folders that settings turn off, each with why: enabledPlugins false for the
 * plugin also skips the SKILL.md in its folder, whatever else keeps the plugin from loading
 * (observed in v2.1.296).
 */
export function turnedOffFolders(
  layers: SettingsLayer[],
  plugins: LoadedPlugin[]
): Map<string, string> {
  const off = new Map<string, string>();
  for (const { plugin } of plugins.filter((p) => isSkillsDirPlugin(p.plugin))) {
    const setting = enabledPluginsEntry(layers, [plugin.id]);
    if (setting?.value === false)
      off.set(
        plugin.installPath,
        `${plugin.id} is turned off in ${setting.scope} settings, which skips the skill in its folder too`
      );
  }
  return off;
}

/**
 * A plugin that comes from the repository: one in the project's .claude/skills. Its MCP servers
 * wait for the same approval as the project's .mcp.json (docs: plugins/loading#plugins-shared-through-a-repository).
 */
export function fromRepository(plugin: Plugin): boolean {
  return plugin.scope === "project" && isSkillsDirPlugin(plugin);
}

/** Where a scan starts (see canonicalRoot), with the trust and managed settings that gate plugins. */
interface PluginPlace {
  projectDir: string;
  gitRoot: string | null;
  canonicalRoot: string;
  trust: Trust;
  /** Managed settings as written. */
  managed: Record<string, unknown> | null;
}

/**
 * The plugins that apply in `projectDir`, with whether each is enabled and by which file: the
 * installed ones, then the folders under a skills folder that hold a plugin. A file that is there
 * but does not parse goes into `problems`.
 */
export async function readPlugins(
  env: ScanEnv,
  layers: SettingsLayer[],
  place: PluginPlace,
  problems: Problem[]
): Promise<LoadedPlugin[]> {
  const installed = await installedPlugins(env, layers, place, problems);
  return [...installed, ...(await skillsDirPlugins(env, layers, place, installed, problems))];
}

async function installedPlugins(
  env: ScanEnv,
  layers: SettingsLayer[],
  { projectDir, gitRoot, canonicalRoot }: PluginPlace,
  problems: Problem[]
): Promise<LoadedPlugin[]> {
  const root = pluginsRoot(env);
  const installed = await readJsonOrReport(env, join(root, "installed_plugins.json"), problems);
  if (!installed || !isRecord(installed.plugins)) return [];
  const marketDefault = marketplaceDefaults(env, problems);
  const out: LoadedPlugin[] = [];
  for (const [id, installs] of Object.entries(installed.plugins)) {
    if (!Array.isArray(installs)) continue;
    // A project or local install applies only in its own project, and one made in the main
    // checkout in its worktrees too (docs: worktrees#what-worktrees-share-with-the-main-checkout);
    // it beats a user install there.
    const records = installs.filter((i): i is Record<string, unknown> => isRecord(i));
    const here = [projectDir, gitRoot, canonicalRoot];
    const install =
      records.find((i) => typeof i.projectPath === "string" && here.includes(i.projectPath)) ??
      records.find((i) => typeof i.projectPath !== "string");
    if (!install) continue;
    const plugin: Plugin = {
      id,
      version: stringField(install, "version"),
      scope: stringField(install, "scope"),
      installPath: stringField(install, "installPath"),
      updated: stringField(install, "lastUpdated") || null,
      enabled: true,
      note: "",
    };
    const loaded = await loadPlugin(env, plugin, problems);
    // The marketplace entry's defaultEnabled wins over the manifest's (docs: plugins-reference#metadata-precedence).
    const fromMarket = await marketDefault(id);
    decide(plugin, layers, fromMarket ?? loaded.manifest.defaultEnabled);
    out.push(loaded);
  }
  return out;
}

/** Turns `plugin` on or off by its enabledPlugins entry, else by `defaultEnabled`. */
function decide(plugin: Plugin, layers: SettingsLayer[], defaultEnabled: unknown): void {
  const setting = enabledPluginsEntry(layers, [plugin.id]);
  if (setting) {
    plugin.enabled = setting.value !== false;
    plugin.enabledIn = setting.scope;
    plugin.note = `${plugin.enabled ? "Enabled" : "Turned off"} in ${setting.scope} settings`;
  } else {
    plugin.enabled = defaultEnabled !== false;
    plugin.note = plugin.enabled
      ? "On by default (no enabledPlugins entry)"
      : "Off by default (no enabledPlugins entry)";
  }
}

/**
 * The defaultEnabled that an installed plugin's marketplace entry sets, from the marketplace.json
 * at the marketplace's installLocation in known_marketplaces.json; undefined when it sets none.
 */
function marketplaceDefaults(
  env: ScanEnv,
  problems: Problem[]
): (id: string) => Promise<boolean | undefined> {
  const markets = new Map<string, Promise<Record<string, unknown>[]>>();
  const known = readJsonOrReport(env, join(pluginsRoot(env), "known_marketplaces.json"), problems);
  const entries = async (market: string) => {
    const record = (await known)?.[market];
    if (!isRecord(record)) return [];
    const location = stringField(record, "installLocation");
    if (!location) return [];
    // A marketplace added from a file is recorded at that file (docs: plugins/loading#find-plugins-on-disk).
    const fromFile = isRecord(record.source) && record.source.source === "file";
    const file = fromFile ? location : join(location, ".claude-plugin", "marketplace.json");
    const json = await readJsonOrReport(env, file, problems);
    return Array.isArray(json?.plugins) ? json.plugins.filter((p) => isRecord(p)) : [];
  };
  return async (id) => {
    const at = id.lastIndexOf("@");
    const market = id.slice(at + 1);
    if (at <= 0 || !market) return;
    if (!markets.has(market)) markets.set(market, entries(market));
    const entry = (await markets.get(market))?.find((p) => p.name === id.slice(0, at));
    return typeof entry?.defaultEnabled === "boolean" ? entry.defaultEnabled : undefined;
  };
}

/**
 * Folders in ~/.claude/skills and the start folder's .claude/skills that hold a
 * .claude-plugin/plugin.json, each loaded as `<manifest name>@skills-dir` (docs:
 * plugins/loading#plugins-shared-through-a-repository). Claude Code does not look in parent folders
 * for them. A project one loads only once you trust the folder itself; between two of one name the
 * copy in your own skills folder loads, and an enabled installed plugin of the name beats both
 * (docs: plugins/loading#name-conflicts).
 */
async function skillsDirPlugins(
  env: ScanEnv,
  layers: SettingsLayer[],
  { projectDir, trust, managed }: PluginPlace,
  installed: LoadedPlugin[],
  problems: Problem[]
): Promise<LoadedPlugin[]> {
  const blocked = skillsDirBlocked(managed);
  const taken = new Map(
    installed.filter((p) => p.plugin.enabled).map((p) => [pluginNamespace(p), p.plugin.id])
  );
  const userDir = join(env.claudeDir, "skills");
  const seen = new Set<string>();
  const out = await skillsDirFolders(env, projectDir, problems);
  for (const { plugin, manifest } of out) {
    const name = pluginNamespace({ plugin, manifest });
    const untrusted = plugin.scope === "project" && !trust.trusted;
    const skipped =
      blocked ??
      (untrusted
        ? "Loads once you accept Claude Code's trust dialog for this folder; trusting a parent folder or running claude -p is not enough"
        : null) ??
      (seen.has(name) ? `Not loaded: your copy in ${userDir} has the name "${name}"` : null) ??
      (taken.has(name) ? `Not loaded: the name "${name}" is taken by ${taken.get(name)}` : null);
    if (!untrusted) seen.add(name);
    if (skipped) plugin.note = skipped;
    else decide(plugin, layers, manifest.defaultEnabled);
  }
  return out;
}

/** The skills-dir plugins on disk, yours first, each off until skillsDirPlugins decides. */
async function skillsDirFolders(
  env: ScanEnv,
  projectDir: string,
  problems: Problem[]
): Promise<LoadedPlugin[]> {
  const userDir = join(env.claudeDir, "skills");
  const projectSkills = join(projectDir, ".claude", "skills");
  const folders: Array<{ dir: string; scope: "user" | "project" }> = [
    { dir: userDir, scope: "user" },
  ];
  if ((await resolvedPath(projectSkills)) !== (await resolvedPath(userDir)))
    folders.push({ dir: projectSkills, scope: "project" });
  const out: LoadedPlugin[] = [];
  for (const { dir, scope } of folders)
    for (const folder of await listDir(dir)) {
      // The folder synced skills live in, and hidden folders, are never plugins (observed in v2.1.296).
      if (folder.startsWith(".") || isSyncedFolder(folder)) continue;
      const installPath = join(dir, folder);
      const manifestFile = join(installPath, ".claude-plugin", "plugin.json");
      const manifest = await readJsonOrReport(env, manifestFile, problems);
      if (!manifest) continue;
      const plugin: Plugin = {
        id: `${stringField(manifest, "name") || folder}@${SKILLS_DIR}`,
        version: stringField(manifest, "version"),
        scope,
        installPath,
        updated: null,
        enabled: false,
        note: "",
      };
      out.push({ plugin, manifest });
    }
  return out;
}

/**
 * Why managed settings keep every skills-dir plugin from loading, or null: a surface locked to
 * plugins (docs: settings-reference#strictpluginonlycustomization), a marketplace allowlist without
 * the skills-dir entry, or a blocklist with it (docs: settings-reference#strictknownmarketplaces).
 * Claude Code drops the project's ones too, though the docs name only ~/.claude/skills.
 */
function skillsDirBlocked(managed: Record<string, unknown> | null): string | null {
  if (pluginOnlySurfaces(managed).size > 0)
    return "Not loaded: managed settings keep customization to plugins and managed settings (strictPluginOnlyCustomization)";
  const isSkillsDir = (e: unknown) => isRecord(e) && e.source === SKILLS_DIR;
  const allowed = managed?.strictKnownMarketplaces;
  if (Array.isArray(managed?.blockedMarketplaces) && managed.blockedMarketplaces.some(isSkillsDir))
    return "Not loaded: managed settings block skills-dir plugins (blockedMarketplaces)";
  if (Array.isArray(allowed) && !allowed.some(isSkillsDir))
    return 'Not loaded: managed settings allow only listed marketplaces, without { "source": "skills-dir" } (strictKnownMarketplaces)';
  return null;
}

/** A path from a manifest, if it stays inside the plugin once links are followed. */
async function inside(plugin: Plugin, path: string): Promise<string | null> {
  const target = resolve(plugin.installPath, path);
  const root = await resolvedPath(plugin.installPath);
  return isWithin(root, await resolvedPath(target)) ? target : null;
}

/** The paths a manifest key names (one path or a list), inside the plugin; null when unset. */
export async function manifestPaths(
  { plugin, manifest }: LoadedPlugin,
  key: string
): Promise<string[] | null> {
  const value = manifest[key];
  if (typeof value !== "string" && !Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of typeof value === "string" ? [value] : value) {
    if (typeof item !== "string") continue;
    const path = await inside(plugin, item);
    if (path) out.push(path);
  }
  return out;
}

/**
 * The value of a manifest key that is a path, an inline object, or a list of either. A file it
 * names that is there but does not parse goes into `problems`. A file holds the value under `key`,
 * or is the value itself; with `wrapped`, only under `key`, and a file without it is a problem.
 */
export async function manifestConfigs(
  env: ScanEnv,
  { plugin, manifest }: LoadedPlugin,
  key: string,
  problems: Problem[],
  wrapped = false
): Promise<Array<{ value: unknown; path: string }>> {
  const value = manifest[key];
  if (value === undefined) return [];
  const out: Array<{ value: unknown; path: string }> = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (isRecord(item)) out.push({ value: item, path: manifestPath(plugin) });
    if (typeof item !== "string") continue;
    const path = await inside(plugin, item);
    const file = path ? await readJsonOrReport(env, path, problems) : null;
    if (!path || !file) continue;
    const problem = wrapped ? unwrapped(file, key) : null;
    if (problem) problems.push({ path, error: problem });
    else out.push({ value: wrapped ? file[key] : (file[key] ?? file), path });
  }
  return out;
}

/**
 * Why Claude Code loads nothing from a file that must hold its value under `key`, as a plugin's
 * hooks file does, or null: `key` is not an object, or is missing beside other keys, such as an
 * event map written without the wrapper (docs: plugins-reference#hooks). A file with only a
 * description or hook modules is not one.
 */
export function unwrapped(file: Record<string, unknown>, key: string): string | null {
  const value = file[key];
  if (
    value === undefined
      ? Object.keys(file).every((k) => k === "description" || k === "modules")
      : isRecord(value)
  )
    return null;
  return `no top-level "${key}" object, so Claude Code loads none of it`;
}

type ManifestCommand = { name: string; path: string; description: string; text: string | null };

/** The manifest's `commands` object form: command name to a file or inline content. */
export async function manifestCommandMap({
  plugin,
  manifest,
}: LoadedPlugin): Promise<ManifestCommand[]> {
  const value = manifest.commands;
  if (!isRecord(value)) return [];
  const out: ManifestCommand[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const source = typeof entry.source === "string" ? await inside(plugin, entry.source) : null;
    const content = typeof entry.content === "string" ? entry.content : null;
    if (!source && content === null) continue;
    out.push({
      name,
      path: source ?? manifestPath(plugin),
      description: stringField(entry, "description"),
      text: content,
    });
  }
  return out;
}
