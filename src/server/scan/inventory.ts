import { basename, dirname, join, relative } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import {
  type Entry,
  type Hook,
  type Inventory,
  type Plugin,
  type Scope,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isDir,
  isFile,
  isRecord,
  isWithin,
  listDir,
  parseFrontmatter,
  readJsonObject,
  redactSecrets,
  shownUrl,
  readTextFile,
  resolvedPath,
  stringField,
  toStringList,
} from "./files.ts";
import { ancestorsRootFirst } from "./instructions.ts";
import { readMcpServers } from "./mcp.ts";
import { manifestCommandMap, manifestConfigs, manifestPaths, readPlugins } from "./plugins.ts";
import { effectiveSettings } from "./settings.ts";

type Source = Scope | "plugin";

function isTrue(value: unknown): boolean {
  return value === true || (typeof value === "string" && /^(true|yes|on|1)$/i.test(value));
}

/** A `.md` file as an agent, command or output style. */
async function readEntry(
  path: string,
  name: string,
  scope: Source,
  plugin?: string
): Promise<Entry | null> {
  const file = await readTextFile(path);
  if (!file) return null;
  const { data } = parseFrontmatter(file.text);
  const entry: Entry = {
    name: stringField(data, "name") || name,
    description: stringField(data, "description"),
    path,
    scope,
    text: file.text,
  };
  const model = stringField(data, "model");
  if (model) entry.model = model;
  if (plugin) entry.plugin = plugin;
  const real = await resolvedPath(path);
  if (real !== path) entry.realPath = real;
  return entry;
}

/**
 * `*.md` files in a folder and its subfolders. A file in a subfolder is named by its path, joined
 * with `separator`: commands use ":" (`frontend/component.md` is `/frontend:component`).
 */
async function readFileEntries(
  dir: string,
  scope: Source,
  { plugin, separator = "/" }: { plugin?: string | undefined; separator?: string } = {},
  base = dir,
  depth = 0
): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const name of await listDir(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (await isDir(path)) {
      if (depth < 4)
        out.push(...(await readFileEntries(path, scope, { plugin, separator }, base, depth + 1)));
      continue;
    }
    if (!name.endsWith(".md")) continue;
    const fallback = relative(base, path).replace(/\.md$/, "").split(/[/\\]/).join(separator);
    const entry = await readEntry(path, fallback, scope, plugin);
    if (entry) out.push(entry);
  }
  return out;
}

/** Files or folders of `.md` files. */
async function readPaths(
  paths: string[],
  scope: Source,
  options: { plugin?: string | undefined; separator?: string }
) {
  const out: Entry[] = [];
  for (const path of paths) {
    if (await isDir(path)) out.push(...(await readFileEntries(path, scope, options)));
    else if (path.endsWith(".md")) {
      const entry = await readEntry(path, basename(path, ".md"), scope, options.plugin);
      if (entry) out.push(entry);
    }
  }
  return out;
}

export async function readSkill(
  folder: string,
  scope: Source,
  plugin?: string
): Promise<Entry | null> {
  const path = join(folder, "SKILL.md");
  const file = await readTextFile(path);
  if (!file) return null;
  const { data, body } = parseFrontmatter(file.text);
  const entry: Entry = {
    name: stringField(data, "name") || (folder.split(/[/\\]/).pop() ?? ""),
    // Without a description, Claude Code lists the first non-empty line of the body.
    description:
      stringField(data, "description") ||
      (body.split("\n").find((line) => line.trim() !== "") ?? "").trim(),
    path,
    folder,
    listed: !isTrue(data["disable-model-invocation"]),
    scope,
    text: file.text,
  };
  const paths = toStringList(data.paths);
  if (paths.length > 0) entry.paths = paths;
  const whenToUse = stringField(data, "when_to_use");
  if (whenToUse) entry.whenToUse = whenToUse;
  const model = stringField(data, "model");
  if (model) entry.model = model;
  if (plugin) entry.plugin = plugin;
  const real = await resolvedPath(folder);
  if (real !== folder) entry.realPath = real;
  return entry;
}

/** `<name>/SKILL.md` folders, or one folder holding SKILL.md itself. */
async function readSkills(dir: string, scope: Source, plugin?: string): Promise<Entry[]> {
  if (plugin && (await isFile(join(dir, "SKILL.md")))) {
    const skill = await readSkill(dir, scope, plugin);
    return skill ? [skill] : [];
  }
  const out: Entry[] = [];
  for (const name of await listDir(dir)) {
    if (name.startsWith(".") || (scope === "user" && name === "synced")) continue;
    const skill = await readSkill(join(dir, name), scope, plugin);
    if (skill) out.push(skill);
  }
  return out;
}

/** A plugin's skills, agents, commands and output styles, from its folders and its manifest. */
async function pluginEntries(plugin: Plugin) {
  const root = plugin.installPath;
  const options = { plugin: plugin.id };
  // `skills` adds to the default folder; the other keys replace theirs (docs: plugins-reference).
  const extraSkills = await manifestPaths(plugin, "skills");
  const skillDirs = [join(root, "skills"), ...(extraSkills ?? [])];
  const rootSkill = extraSkills === null && !(await isDir(join(root, "skills")));
  const skills = rootSkill ? await readSkills(root, "plugin", plugin.id) : [];
  for (const dir of skillDirs) skills.push(...(await readSkills(dir, "plugin", plugin.id)));
  const listed = async (key: string, folder: string, separator = "/") =>
    readPaths((await manifestPaths(plugin, key)) ?? [join(root, folder)], "plugin", {
      ...options,
      separator,
    });
  const commands = await listed("commands", "commands", ":");
  for (const c of await manifestCommandMap(plugin))
    commands.push(
      c.text === null
        ? ((await readEntry(c.path, c.name, "plugin", plugin.id)) ?? {
            name: c.name,
            description: c.description,
            path: c.path,
            scope: "plugin",
            plugin: plugin.id,
            text: "",
          })
        : {
            name: c.name,
            description: c.description,
            path: c.path,
            scope: "plugin",
            plugin: plugin.id,
            text: c.text,
          }
    );
  // A plugin subagent is named with the plugin and its subfolders (docs: sub-agents#choose-the-subagent-scope).
  const agents: Entry[] = [];
  for (const path of (await manifestPaths(plugin, "agents")) ?? [join(root, "agents")]) {
    const folder = (await isDir(path)) ? path : null;
    for (const agent of await readPaths([path], "plugin", options)) {
      const subfolders = folder ? relative(folder, dirname(agent.path)).split(/[/\\]/) : [];
      const own = agent.name.split("/").at(-1) ?? agent.name;
      agent.id = [plugin.id.split("@")[0], ...subfolders.filter(Boolean), own].join(":");
      agents.push(agent);
    }
  }
  return {
    skills,
    agents,
    commands,
    outputStyles: await listed("outputStyles", "output-styles"),
  };
}

interface InventoryInput {
  env: ScanEnv;
  projectDir: string;
  /** The repository (or worktree) root, where the search for project skills stops. */
  gitRoot: string | null;
  layers: SettingsLayer[];
  claudeJson: Record<string, unknown> | null;
  trust: Trust;
}

/**
 * The `.claude/<sub>` folders of the start directory and every parent up to the repository root
 * (only the start directory outside git), root first, leaving out the user folder.
 */
function projectFolders(env: ScanEnv, projectDir: string, gitRoot: string | null, sub: string) {
  return ancestorsRootFirst(projectDir)
    .filter((dir) => !gitRoot || isWithin(gitRoot, dir))
    .slice(gitRoot ? 0 : -1)
    .map((dir) => join(dir, ".claude", sub))
    .filter((dir) => dir !== join(env.claudeDir, sub));
}

/**
 * Subagents by priority: managed, then project folders closest to the start directory first, then
 * yours. A name defined again lower down is marked as shadowed (docs: sub-agents#choose-the-subagent-scope).
 */
async function readAgents(env: ScanEnv, projectDir: string, gitRoot: string | null) {
  const sources: Array<[string, Source]> = [
    [join(env.managedDir, ".claude", "agents"), "managed"],
    ...projectFolders(env, projectDir, gitRoot, "agents")
      .reverse()
      .map((dir): [string, Source] => [dir, "project"]),
    [join(env.claudeDir, "agents"), "user"],
  ];
  const agents: Entry[] = [];
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of sources)
    for (const agent of await readFileEntries(dir, scope)) {
      const winner = winners.get(agent.name);
      if (winner) agent.shadowedBy = winner.path;
      else winners.set(agent.name, agent);
      agents.push(agent);
    }
  return agents;
}

/**
 * Applies skillOverrides to your skills and command files; plugin skills are not affected
 * (docs: skills#override-skill-visibility-from-settings).
 */
export function applySkillOverrides(entries: Entry[], overrides: unknown) {
  if (!isRecord(overrides)) return;
  for (const entry of entries) {
    const state = overrides[entry.name];
    if (entry.scope === "plugin") continue;
    if (state !== "name-only" && state !== "user-invocable-only" && state !== "off") continue;
    entry.override = state;
    if (state !== "name-only") entry.listed = false;
  }
}

export async function readInventory(input: InventoryInput): Promise<Inventory> {
  const { env, projectDir, gitRoot, layers } = input;
  const plugins = await readPlugins(env, layers, projectDir, gitRoot);
  const active = plugins.filter((p) => p.enabled);
  const fromPlugins = await Promise.all(active.map(pluginEntries));
  const projectClaude = join(projectDir, ".claude");
  const hasProjectDir = projectClaude !== env.claudeDir;
  const files = async (sub: string, separator = "/") => [
    ...(await readFileEntries(join(env.claudeDir, sub), "user", { separator })),
    ...(hasProjectDir
      ? await readFileEntries(join(projectClaude, sub), "project", { separator })
      : []),
  ];

  // Project skills come from the start directory and every parent up to the repository root.
  const skillDirs: Array<[string, Source]> = [
    [join(env.managedDir, ".claude", "skills"), "managed"],
    [join(env.claudeDir, "skills"), "user"],
    ...(await listDir(join(env.claudeDir, "skills", "synced")))
      .filter((bucket) => !bucket.startsWith("."))
      .map((bucket): [string, Source] => [join(env.claudeDir, "skills", "synced", bucket), "user"]),
    ...projectFolders(env, projectDir, gitRoot, "skills").map((dir): [string, Source] => [
      dir,
      "project",
    ]),
  ];
  const skills: Entry[] = [];
  const seenFolders = new Set<string>();
  for (const [dir, scope] of skillDirs) {
    for (const skill of await readSkills(dir, scope)) {
      // A folder that several locations link to loads once.
      const real = skill.realPath ?? skill.folder ?? skill.path;
      if (seenFolders.has(real)) continue;
      seenFolders.add(real);
      skills.push(skill);
    }
  }

  // A command file is a skill too: one with disable-model-invocation is not listed to Claude.
  const commands = await files("commands", ":");
  for (const command of commands)
    if (isTrue(parseFrontmatter(command.text).data["disable-model-invocation"]))
      command.listed = false;
  const overrides = effectiveSettings(layers).find((s) => s.key === "skillOverrides")?.value;
  applySkillOverrides([...skills, ...commands], overrides);

  return {
    agents: [
      ...(await readAgents(env, projectDir, gitRoot)),
      ...fromPlugins.flatMap((p) => p.agents),
    ],
    skills: [...skills, ...fromPlugins.flatMap((p) => p.skills)],
    commands: [...commands, ...fromPlugins.flatMap((p) => p.commands)],
    outputStyles: [
      ...(await files("output-styles")),
      ...fromPlugins.flatMap((p) => p.outputStyles),
    ],
    hooks: await readHooks(layers, active),
    mcpServers: await readMcpServers(input, active),
    plugins,
  };
}

async function readHooks(layers: SettingsLayer[], plugins: Plugin[]): Promise<Hook[]> {
  const out: Hook[] = [];
  for (const layer of layers) {
    if (layer.data) out.push(...hooksFrom(layer.data.hooks, layer.scope, layer.path));
  }
  for (const plugin of plugins) {
    const path = join(plugin.installPath, "hooks", "hooks.json");
    const file = await readJsonObject(path);
    if (file.ok) out.push(...hooksFrom(file.data.hooks, "plugin", path, plugin));
    for (const part of await manifestConfigs(plugin, "hooks"))
      out.push(...hooksFrom(part.value, "plugin", part.path, plugin));
  }

  // docs: hooks#disable-or-remove-hooks, settings-reference#allowmanagedhooksonly
  const managed = layers.find((l) => l.scope === "managed")?.data;
  const managedOff = managed?.disableAllHooks === true;
  // The value left after precedence counts, so a project false beats a user true.
  const othersOff =
    HIGHEST_FIRST.filter((s) => s !== "managed")
      .flatMap((scope) => layers.filter((l) => l.scope === scope))
      .find((l) => typeof l.data?.disableAllHooks === "boolean")?.data?.disableAllHooks === true;
  const managedOnly = managed?.allowManagedHooksOnly === true;
  const forcedByManaged = new Set(
    plugins.filter((p) => p.enabledIn === "managed").map((p) => p.id)
  );
  for (const hook of out) {
    const organisation =
      hook.source === "managed" || (hook.plugin !== undefined && forcedByManaged.has(hook.plugin));
    if (managedOff) {
      hook.active = false;
      hook.note = "Managed settings turn off every hook (disableAllHooks)";
    } else if (hook.source !== "managed" && othersOff) {
      hook.active = false;
      hook.note = "disableAllHooks is on, so only managed hooks run";
    } else if (!organisation && managedOnly) {
      hook.active = false;
      hook.note = "Managed settings allow only managed hooks (allowManagedHooksOnly)";
    }
  }
  return out;
}

function hooksFrom(config: unknown, source: Source, sourcePath: string, plugin?: Plugin): Hook[] {
  if (!isRecord(config)) return [];
  const out: Hook[] = [];
  for (const [event, groups] of Object.entries(config)) {
    if (!Array.isArray(groups)) continue;
    for (const [g, group] of groups.entries()) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
      for (const [index, h] of group.hooks.entries()) {
        if (!isRecord(h)) continue;
        const entry: Hook = {
          event,
          type: stringField(h, "type") || "command",
          command:
            stringField(h, "command") || stringField(h, "prompt") || shownUrl(stringField(h, "url")),
          source,
          sourcePath,
          active: true,
          at: { group: g, index },
          definition: redactSecrets(h),
        };
        const matcher = stringField(group, "matcher");
        if (matcher) entry.matcher = matcher;
        if (plugin) entry.plugin = plugin.id;
        out.push(entry);
      }
    }
  }
  return out;
}
