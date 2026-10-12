import { basename, dirname, join, relative } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import {
  type Entry,
  type Hook,
  type Inventory,
  type Plugin,
  type Scope,
  type SessionProfile,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { redactSecrets, shownUrl } from "../secrets.ts";
import { type ScanEnv } from "./env.ts";
import {
  isDir,
  isFile,
  isWithin,
  listDir,
  readJsonObject,
  readTextFile,
  resolvedPath,
  stringField,
  toStringList,
} from "./files.ts";
import { isRecord, parseFrontmatter } from "./data.ts";
import { ancestorsRootFirst } from "./instructions.ts";
import { readMcpServers } from "./mcp.ts";
import {
  manifestCommandMap,
  manifestConfigs,
  manifestPaths,
  pluginNamespace,
  readPlugins,
} from "./plugins.ts";
import { effectiveSettings } from "./settings.ts";

type Source = Scope | "plugin";

function isTrue(value: unknown): boolean {
  return value === true || (typeof value === "string" && /^(true|yes|on|1)$/i.test(value));
}

/**
 * A `.md` file as an agent, command or output style. `fileName` is its name from its path, which a
 * frontmatter `name` replaces, except for a command (docs: skills#how-a-skill-gets-its-command-name).
 */
async function readEntry(
  env: ScanEnv,
  path: string,
  fileName: string,
  scope: Source,
  { plugin, isCommand = false }: { plugin?: string | undefined; isCommand?: boolean } = {}
): Promise<Entry | null> {
  const file = await readTextFile(env, path);
  if (!file) return null;
  const { data } = parseFrontmatter(file.text);
  const entry: Entry = {
    name: (!isCommand && stringField(data, "name")) || fileName,
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
  env: ScanEnv,
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
        out.push(
          ...(await readFileEntries(env, path, scope, { plugin, separator }, base, depth + 1))
        );
      continue;
    }
    if (!name.endsWith(".md")) continue;
    const fileName = relative(base, path).replace(/\.md$/, "").split(/[/\\]/).join(separator);
    // Commands are the entries joined with ":".
    const entry = await readEntry(env, path, fileName, scope, {
      plugin,
      isCommand: separator === ":",
    });
    if (entry) out.push(entry);
  }
  return out;
}

/** Files or folders of `.md` files. */
async function readPaths(
  env: ScanEnv,
  paths: string[],
  scope: Source,
  options: { plugin?: string | undefined; separator?: string }
) {
  const out: Entry[] = [];
  for (const path of paths) {
    if (await isDir(path)) out.push(...(await readFileEntries(env, path, scope, options)));
    else if (path.endsWith(".md")) {
      const entry = await readEntry(env, path, basename(path, ".md"), scope, {
        plugin: options.plugin,
        isCommand: options.separator === ":",
      });
      if (entry) out.push(entry);
    }
  }
  return out;
}

export async function readSkill(
  env: ScanEnv,
  folder: string,
  scope: Source,
  plugin?: string
): Promise<Entry | null> {
  const path = join(folder, "SKILL.md");
  const file = await readTextFile(env, path);
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
async function readSkills(
  env: ScanEnv,
  dir: string,
  scope: Source,
  plugin?: string
): Promise<Entry[]> {
  if (plugin && (await isFile(join(dir, "SKILL.md")))) {
    const skill = await readSkill(env, dir, scope, plugin);
    return skill ? [skill] : [];
  }
  const out: Entry[] = [];
  for (const name of await listDir(dir)) {
    if (name.startsWith(".") || (scope === "user" && name === "synced")) continue;
    const skill = await readSkill(env, join(dir, name), scope, plugin);
    if (skill) out.push(skill);
  }
  return out;
}

/** A plugin's skills, agents, commands and output styles, from its folders and its manifest. */
async function pluginEntries(env: ScanEnv, plugin: Plugin) {
  const root = plugin.installPath;
  const options = { plugin: plugin.id };
  // `skills` adds to the default folder; the other keys replace theirs (docs: plugins-reference).
  const extraSkills = await manifestPaths(env, plugin, "skills");
  const skillDirs = [join(root, "skills"), ...(extraSkills ?? [])];
  const rootSkill = extraSkills === null && !(await isDir(join(root, "skills")));
  const namespace = await pluginNamespace(env, plugin);
  const skills: Entry[] = [];
  if (rootSkill)
    for (const skill of await readSkills(env, root, "plugin", plugin.id)) {
      // Without a name, a root SKILL.md is named after the plugin (docs: skills#how-a-skill-gets-its-command-name).
      if (skill.folder === root && !stringField(parseFrontmatter(skill.text).data, "name"))
        skill.name = namespace;
      skills.push(skill);
    }
  for (const dir of skillDirs) skills.push(...(await readSkills(env, dir, "plugin", plugin.id)));
  const listed = async (key: string, folder: string, separator = "/") =>
    readPaths(env, (await manifestPaths(env, plugin, key)) ?? [join(root, folder)], "plugin", {
      ...options,
      separator,
    });
  const commands = await listed("commands", "commands", ":");
  for (const c of await manifestCommandMap(env, plugin))
    commands.push(
      c.text === null
        ? ((await readEntry(env, c.path, c.name, "plugin", {
            plugin: plugin.id,
            isCommand: true,
          })) ?? {
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
  // A plugin's skills and commands are called as plugin-name:name; a name that already has the
  // prefix keeps it once (docs: skills#how-a-skill-gets-its-command-name).
  for (const entry of [...skills, ...commands])
    entry.id = entry.name.startsWith(`${namespace}:`) ? entry.name : `${namespace}:${entry.name}`;
  // A plugin subagent is named with the plugin and its subfolders (docs: sub-agents#choose-the-subagent-scope).
  const agents: Entry[] = [];
  for (const path of (await manifestPaths(env, plugin, "agents")) ?? [join(root, "agents")]) {
    const folder = (await isDir(path)) ? path : null;
    for (const agent of await readPaths(env, [path], "plugin", options)) {
      const subfolders = folder ? relative(folder, dirname(agent.path)).split(/[/\\]/) : [];
      const own = agent.name.split("/").at(-1) ?? agent.name;
      agent.id = [namespace, ...subfolders.filter(Boolean), own].join(":");
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
  profile: SessionProfile;
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
 * What Claude Code requires of a subagent file; it skips one that falls short, and treats one
 * without a name as documentation (docs: sub-agents#subagent-files-claude-code-skips).
 */
export function agentProblems(text: string): string[] {
  const { data } = parseFrontmatter(text);
  const name = stringField(data, "name");
  const problems: string[] = [];
  if (!name) problems.push("The frontmatter needs a name.");
  else if (name.length > 256 || name.includes(":") || name.startsWith("-"))
    problems.push("A name has at most 256 characters, no ':' and does not start with '-'.");
  if (!stringField(data, "description"))
    problems.push("The frontmatter needs a description: when Claude should use this agent.");
  return problems;
}

/**
 * Subagents by priority: managed, then project folders closest to the start directory first, then
 * yours. A name defined again lower down is marked as shadowed (docs: sub-agents#choose-the-subagent-scope).
 * A file Claude Code skips takes no part in that.
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
    for (const agent of await readFileEntries(env, dir, scope)) {
      const [problem] = agentProblems(agent.text);
      if (problem) {
        agent.skipped = problem;
        agents.push(agent);
        continue;
      }
      const winner = winners.get(agent.name);
      if (winner) agent.shadowedBy = winner.path;
      else winners.set(agent.name, agent);
      agents.push(agent);
    }
  return agents;
}

/**
 * Output styles from the managed folder, every project folder from the start directory up to the
 * repository root (the closest wins) and yours (docs: output-styles#create-a-custom-output-style).
 * The docs order only the project folders; managed, project, then yours follows subagents.
 */
async function readOutputStyles(env: ScanEnv, projectDir: string, gitRoot: string | null) {
  const sources: Array<[string, Source]> = [
    [join(env.managedDir, ".claude", "output-styles"), "managed"],
    ...projectFolders(env, projectDir, gitRoot, "output-styles")
      .reverse()
      .map((dir): [string, Source] => [dir, "project"]),
    [join(env.claudeDir, "output-styles"), "user"],
  ];
  const styles: Entry[] = [];
  for (const [dir, scope] of sources) styles.push(...(await readFileEntries(env, dir, scope)));
  return styles;
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
  const fromPlugins = await Promise.all(active.map((plugin) => pluginEntries(env, plugin)));
  const projectClaude = join(projectDir, ".claude");
  const hasProjectDir = projectClaude !== env.claudeDir;
  const files = async (sub: string, separator = "/") => [
    ...(await readFileEntries(env, join(env.claudeDir, sub), "user", { separator })),
    ...(hasProjectDir
      ? await readFileEntries(env, join(projectClaude, sub), "project", { separator })
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
  // The same name in two of managed, yours and the project runs the first, in that order
  // (docs: skills#resolve-skills-that-share-a-name).
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of skillDirs) {
    for (const skill of await readSkills(env, dir, scope)) {
      // A folder that several locations link to loads once.
      const real = skill.realPath ?? skill.folder ?? skill.path;
      if (seenFolders.has(real)) continue;
      seenFolders.add(real);
      const winner = winners.get(skill.name);
      if (winner && winner.scope !== skill.scope) skill.shadowedBy = winner.path;
      else if (!winner) winners.set(skill.name, skill);
      skills.push(skill);
    }
  }

  // A command file is a skill too: one with disable-model-invocation is not listed to Claude.
  const commands = await files("commands", ":");
  // A skill of the same name runs instead of it (docs: skills#resolve-skills-that-share-a-name).
  for (const command of commands) {
    if (isTrue(parseFrontmatter(command.text).data["disable-model-invocation"]))
      command.listed = false;
    const skill = winners.get(command.name);
    if (skill) command.shadowedBy = skill.path;
  }
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
      ...(await readOutputStyles(env, projectDir, gitRoot)),
      ...fromPlugins.flatMap((p) => p.outputStyles),
    ],
    hooks: await readHooks(env, layers, active, input.trust, input.profile),
    mcpServers: await readMcpServers(input, active),
    plugins,
  };
}

async function readHooks(
  env: ScanEnv,
  layers: SettingsLayer[],
  plugins: Plugin[],
  trust: Trust,
  profile: SessionProfile
): Promise<Hook[]> {
  const out: Hook[] = [];
  for (const layer of layers) {
    if (layer.data) out.push(...hooksFrom(layer.data.hooks, layer.scope, layer.path));
  }
  for (const plugin of plugins) {
    const path = join(plugin.installPath, "hooks", "hooks.json");
    const file = await readJsonObject(env, path);
    if (file.ok) out.push(...hooksFrom(file.data.hooks, "plugin", path, plugin));
    for (const part of await manifestConfigs(env, plugin, "hooks"))
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
  // An interactive session holds back hooks from every settings file, managed and yours included,
  // until the folder or a parent covering it is trusted; -p and the SDK do not (docs:
  // hooks#workspace-trust, permissions#what-runs-before-you-trust-a-folder). The docs say nothing
  // of plugin hooks, so those are left as they are.
  const heldBack = profile === "interactive" && !trust.trusted && !trust.inheritedFrom;
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
    } else if (hook.source !== "plugin" && heldBack) {
      hook.active = false;
      hook.note = "Waits until you accept Claude Code's trust dialog for this folder";
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
            stringField(h, "command") ||
            stringField(h, "prompt") ||
            shownUrl(stringField(h, "url")),
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
