import { join, resolve } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type Plugin, type Problem, type Scope, type SettingsLayer } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isWithin, readJsonOrReport, resolvedPath, stringField } from "./files.ts";
import { isRecord } from "./data.ts";

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

/** Where a scan starts: the folder, its repository root and canonical root (see canonicalRoot). */
interface PluginPlace {
  projectDir: string;
  gitRoot: string | null;
  canonicalRoot: string;
}

/**
 * Installed plugins that apply in `projectDir`, with whether each is enabled and by which file. An
 * install list or manifest that is there but does not parse goes into `problems`.
 */
export async function readPlugins(
  env: ScanEnv,
  layers: SettingsLayer[],
  { projectDir, gitRoot, canonicalRoot }: PluginPlace,
  problems: Problem[]
): Promise<LoadedPlugin[]> {
  const installed = await readJsonOrReport(
    env,
    join(env.claudeDir, "plugins", "installed_plugins.json"),
    problems
  );
  if (!installed || !isRecord(installed.plugins)) return [];
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
    const setting = enabledPluginsEntry(layers, [id]);
    if (setting) {
      plugin.enabled = setting.value !== false;
      plugin.enabledIn = setting.scope;
      plugin.note = `${plugin.enabled ? "Enabled" : "Turned off"} in ${setting.scope} settings`;
    } else {
      plugin.enabled = loaded.manifest.defaultEnabled !== false;
      plugin.note = plugin.enabled
        ? "On by default (no enabledPlugins entry)"
        : "Off by default (no enabledPlugins entry)";
    }
    out.push(loaded);
  }
  return out;
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
