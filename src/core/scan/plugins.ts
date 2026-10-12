import { join, resolve } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type Plugin, type SettingsLayer } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isWithin, readJsonObject, resolvedPath, stringField } from "./files.ts";
import { isRecord } from "./data.ts";

function manifestPath(plugin: Plugin): string {
  return join(plugin.installPath, ".claude-plugin", "plugin.json");
}

async function manifest(env: ScanEnv, plugin: Plugin): Promise<Record<string, unknown>> {
  const result = await readJsonObject(env, manifestPath(plugin));
  return result.ok ? result.data : {};
}

/**
 * The prefix of a plugin's skills, commands and agents: the manifest's name, which wins over the
 * name the plugin is enabled under (docs: plugins-reference#name, #metadata-precedence).
 */
export async function pluginNamespace(env: ScanEnv, plugin: Plugin): Promise<string> {
  return stringField(await manifest(env, plugin), "name") || (plugin.id.split("@")[0] ?? plugin.id);
}

/** Installed plugins that apply in `projectDir`, with whether each is enabled and by which file. */
export async function readPlugins(
  env: ScanEnv,
  layers: SettingsLayer[],
  projectDir: string,
  gitRoot: string | null
): Promise<Plugin[]> {
  const installed = await readJsonObject(
    env,
    join(env.claudeDir, "plugins", "installed_plugins.json")
  );
  if (!installed.ok || !isRecord(installed.data.plugins)) return [];
  const out: Plugin[] = [];
  for (const [id, installs] of Object.entries(installed.data.plugins)) {
    if (!Array.isArray(installs)) continue;
    // A project or local install applies only in its own project; it beats a user install there.
    const records = installs.filter((i): i is Record<string, unknown> => isRecord(i));
    const install =
      records.find((i) => i.projectPath === projectDir || (gitRoot && i.projectPath === gitRoot)) ??
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
    const setting = HIGHEST_FIRST.flatMap((scope) =>
      layers
        .filter((l) => l.scope === scope)
        .map((l) => l.data?.enabledPlugins)
        .filter(isRecord)
        .filter((flags) => flags[id] !== undefined)
        .map((flags) => ({ scope, value: flags[id] }))
    )[0];
    if (setting) {
      plugin.enabled = setting.value !== false;
      plugin.enabledIn = setting.scope;
      plugin.note = `${plugin.enabled ? "Enabled" : "Turned off"} in ${setting.scope} settings`;
    } else {
      plugin.enabled = (await manifest(env, plugin)).defaultEnabled !== false;
      plugin.note = plugin.enabled
        ? "On by default (no enabledPlugins entry)"
        : "Off by default (no enabledPlugins entry)";
    }
    out.push(plugin);
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
  env: ScanEnv,
  plugin: Plugin,
  key: string
): Promise<string[] | null> {
  const value = (await manifest(env, plugin))[key];
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!list) return null;
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const path = await inside(plugin, item);
    if (path) out.push(path);
  }
  return out;
}

/** The value of a manifest key that is a path, an inline object, or a list of either. */
export async function manifestConfigs(
  env: ScanEnv,
  plugin: Plugin,
  key: string
): Promise<Array<{ value: unknown; path: string }>> {
  const value = (await manifest(env, plugin))[key];
  const out: Array<{ value: unknown; path: string }> = [];
  for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
    if (isRecord(item)) out.push({ value: item, path: manifestPath(plugin) });
    if (typeof item !== "string") continue;
    const path = await inside(plugin, item);
    const file = path ? await readJsonObject(env, path) : null;
    if (path && file?.ok) out.push({ value: file.data[key] ?? file.data, path });
  }
  return out;
}

/** The manifest's `commands` object form: command name to a file or inline content. */
export async function manifestCommandMap(
  env: ScanEnv,
  plugin: Plugin
): Promise<Array<{ name: string; path: string; description: string; text: string | null }>> {
  const value = (await manifest(env, plugin)).commands;
  if (!isRecord(value)) return [];
  const out = [];
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
