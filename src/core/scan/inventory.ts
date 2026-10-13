import { basename, dirname, join, relative } from "node:path";
import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import {
  type EffectiveSetting,
  type Entry,
  type Hook,
  type Inventory,
  type Plugin,
  type Problem,
  type Scope,
  type SessionProfile,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { redactSecrets, shownUrl } from "../secrets.ts";
import { isUserClaudeFolder, type ScanEnv } from "./env.ts";
import {
  isDir,
  isFile,
  isWithin,
  listDir,
  pathsField,
  readJsonOrReport,
  readTextFile,
  resolvedPath,
  stringField,
} from "./files.ts";
import { isRecord, parseFrontmatter } from "./data.ts";
import { ancestorsRootFirst } from "./instructions.ts";
import { readMcpServers } from "./mcp.ts";
import { hooksWait } from "./permissions.ts";
import {
  type LoadedPlugin,
  manifestCommandMap,
  manifestConfigs,
  manifestPaths,
  pluginNamespace,
  readPlugins,
} from "./plugins.ts";

type Source = Scope | "plugin";

interface ReadOptions {
  plugin?: string | undefined;
  /** Joins the folders of a file in a subfolder into its name; commands use ":". */
  separator?: string;
  /** Receives files that are there but cannot be read. */
  problems?: Problem[] | undefined;
}

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
  { plugin, isCommand = false, problems }: ReadOptions & { isCommand?: boolean } = {}
): Promise<Entry | null> {
  const file = await readTextFile(env, path, problems);
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
  options: ReadOptions = {},
  base = dir,
  depth = 0
): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const name of await listDir(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (await isDir(path)) {
      if (depth < 4)
        out.push(...(await readFileEntries(env, path, scope, options, base, depth + 1)));
      continue;
    }
    if (!name.endsWith(".md")) continue;
    const separator = options.separator ?? "/";
    const fileName = relative(base, path).replace(/\.md$/, "").split(/[/\\]/).join(separator);
    // Commands are the entries joined with ":".
    const entry = await readEntry(env, path, fileName, scope, {
      plugin: options.plugin,
      isCommand: separator === ":",
      problems: options.problems,
    });
    if (entry) out.push(entry);
  }
  return out;
}

/** Files or folders of `.md` files. */
async function readPaths(env: ScanEnv, paths: string[], scope: Source, options: ReadOptions) {
  const out: Entry[] = [];
  for (const path of paths) {
    if (await isDir(path)) out.push(...(await readFileEntries(env, path, scope, options)));
    else if (path.endsWith(".md")) {
      const entry = await readEntry(env, path, basename(path, ".md"), scope, {
        plugin: options.plugin,
        isCommand: options.separator === ":",
        problems: options.problems,
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
  { plugin, problems }: ReadOptions = {}
): Promise<Entry | null> {
  const path = join(folder, "SKILL.md");
  const file = await readTextFile(env, path, problems);
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
  const paths = pathsField(data.paths);
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
  options: ReadOptions
): Promise<Entry[]> {
  if (options.plugin && (await isFile(join(dir, "SKILL.md")))) {
    const skill = await readSkill(env, dir, scope, options);
    return skill ? [skill] : [];
  }
  const out: Entry[] = [];
  for (const name of await listDir(dir)) {
    if (name.startsWith(".") || (scope === "user" && name === "synced")) continue;
    const skill = await readSkill(env, join(dir, name), scope, options);
    if (skill) out.push(skill);
  }
  return out;
}

/** A plugin's skills, agents, commands and output styles, from its folders and its manifest. */
async function pluginEntries(env: ScanEnv, loaded: LoadedPlugin, problems: Problem[]) {
  const root = loaded.plugin.installPath;
  const options = { plugin: loaded.plugin.id, problems };
  const namespace = pluginNamespace(loaded);
  const listed = async (key: string, folder: string, separator = "/") =>
    readPaths(env, (await manifestPaths(loaded, key)) ?? [join(root, folder)], "plugin", {
      ...options,
      separator,
    });
  const skills = await pluginSkills(env, loaded, problems);
  const commands = [
    ...(await listed("commands", "commands", ":")),
    ...(await manifestCommands(env, loaded, problems)),
  ];
  // A plugin's skills and commands are called as plugin-name:name; a name that already has the
  // prefix keeps it once (docs: skills#how-a-skill-gets-its-command-name).
  for (const entry of [...skills, ...commands])
    entry.id = entry.name.startsWith(`${namespace}:`) ? entry.name : `${namespace}:${entry.name}`;
  return {
    skills,
    agents: await pluginAgents(env, loaded, problems),
    commands,
    outputStyles: await listed("outputStyles", "output-styles"),
  };
}

/** A plugin's skills: its skills folder, the manifest's extra ones, or a SKILL.md at its root. */
async function pluginSkills(
  env: ScanEnv,
  loaded: LoadedPlugin,
  problems: Problem[]
): Promise<Entry[]> {
  const root = loaded.plugin.installPath;
  const options = { plugin: loaded.plugin.id, problems };
  // `skills` adds to the default folder; the other keys replace theirs (docs: plugins-reference).
  const extraSkills = await manifestPaths(loaded, "skills");
  const skillDirs = [join(root, "skills"), ...(extraSkills ?? [])];
  const rootSkill = extraSkills === null && !(await isDir(join(root, "skills")));
  const skills: Entry[] = [];
  if (rootSkill)
    for (const skill of await readSkills(env, root, "plugin", options)) {
      // Without a name, a root SKILL.md is named after the plugin (docs: skills#how-a-skill-gets-its-command-name).
      if (skill.folder === root && !stringField(parseFrontmatter(skill.text).data, "name"))
        skill.name = pluginNamespace(loaded);
      skills.push(skill);
    }
  for (const dir of skillDirs) skills.push(...(await readSkills(env, dir, "plugin", options)));
  return skills;
}

/** The commands a plugin's manifest names with their own file or text. */
async function manifestCommands(
  env: ScanEnv,
  loaded: LoadedPlugin,
  problems: Problem[]
): Promise<Entry[]> {
  const plugin = loaded.plugin.id;
  const commands: Entry[] = [];
  for (const c of await manifestCommandMap(loaded)) {
    const listed: Entry = {
      name: c.name,
      description: c.description,
      path: c.path,
      scope: "plugin",
      plugin,
      text: c.text ?? "",
    };
    const read =
      c.text === null
        ? await readEntry(env, c.path, c.name, "plugin", { plugin, problems, isCommand: true })
        : null;
    commands.push(read ?? listed);
  }
  return commands;
}

/** A plugin's subagents, named with the plugin and its subfolders (docs: sub-agents#choose-the-subagent-scope). */
async function pluginAgents(
  env: ScanEnv,
  loaded: LoadedPlugin,
  problems: Problem[]
): Promise<Entry[]> {
  const root = loaded.plugin.installPath;
  const namespace = pluginNamespace(loaded);
  const agents: Entry[] = [];
  for (const path of (await manifestPaths(loaded, "agents")) ?? [join(root, "agents")]) {
    const folder = (await isDir(path)) ? path : null;
    for (const agent of await readPaths(env, [path], "plugin", {
      plugin: loaded.plugin.id,
      problems,
    })) {
      const subfolders = folder ? relative(folder, dirname(agent.path)).split(/[/\\]/) : [];
      const own = agent.name.split("/").at(-1) ?? agent.name;
      agent.id = [namespace, ...subfolders.filter(Boolean), own].join(":");
      agents.push(agent);
    }
  }
  return agents;
}

interface InventoryInput {
  env: ScanEnv;
  projectDir: string;
  /** The repository (or worktree) root, where the search for project skills stops. */
  gitRoot: string | null;
  layers: SettingsLayer[];
  effective: EffectiveSetting[];
  /** Managed settings as written, nothing hidden: for checks that must see header values. */
  managed: Record<string, unknown> | null;
  claudeJson: Record<string, unknown> | null;
  trust: Trust;
  profile: SessionProfile;
  /** Receives files that are there but cannot be read or parsed. */
  problems: Problem[];
}

/**
 * The `.claude/<sub>` folders of the start directory and every parent up to the repository root
 * (only the start directory outside git), root first, leaving out the user folder.
 */
async function projectFolders(
  env: ScanEnv,
  projectDir: string,
  gitRoot: string | null,
  sub: string
): Promise<string[]> {
  const dirs = ancestorsRootFirst(projectDir)
    .filter((dir) => !gitRoot || isWithin(gitRoot, dir))
    .slice(gitRoot ? 0 : -1);
  const folders: string[] = [];
  for (const dir of dirs)
    if (!(await isUserClaudeFolder(env, dir))) folders.push(join(dir, ".claude", sub));
  return folders;
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
async function readAgents(
  env: ScanEnv,
  projectDir: string,
  gitRoot: string | null,
  problems: Problem[]
) {
  const sources: [string, Source][] = [
    [join(env.managedDir, ".claude", "agents"), "managed"],
    ...(await projectFolders(env, projectDir, gitRoot, "agents"))
      .reverse()
      .map((dir): [string, Source] => [dir, "project"]),
    [join(env.claudeDir, "agents"), "user"],
  ];
  const agents: Entry[] = [];
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of sources)
    for (const agent of await readFileEntries(env, dir, scope, { problems })) {
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
async function readOutputStyles(
  env: ScanEnv,
  projectDir: string,
  gitRoot: string | null,
  problems: Problem[]
) {
  const sources: [string, Source][] = [
    [join(env.managedDir, ".claude", "output-styles"), "managed"],
    ...(await projectFolders(env, projectDir, gitRoot, "output-styles"))
      .reverse()
      .map((dir): [string, Source] => [dir, "project"]),
    [join(env.claudeDir, "output-styles"), "user"],
  ];
  const styles: Entry[] = [];
  for (const [dir, scope] of sources)
    styles.push(...(await readFileEntries(env, dir, scope, { problems })));
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
  const { env, projectDir, gitRoot, layers, problems } = input;
  const plugins = await readPlugins(env, layers, projectDir, gitRoot, problems);
  const active = plugins.filter((p) => p.plugin.enabled);
  const fromPlugins = await Promise.all(
    active.map((plugin) => pluginEntries(env, plugin, problems))
  );
  const projectClaude = join(projectDir, ".claude");
  const hasProjectDir = !(await isUserClaudeFolder(env, projectDir));
  const files = async (sub: string, separator = "/") => [
    ...(await readFileEntries(env, join(env.claudeDir, sub), "user", { separator, problems })),
    ...(hasProjectDir
      ? await readFileEntries(env, join(projectClaude, sub), "project", { separator, problems })
      : []),
  ];

  // Project skills come from the start directory and every parent up to the repository root.
  const skillDirs: [string, Source][] = [
    [join(env.managedDir, ".claude", "skills"), "managed"],
    [join(env.claudeDir, "skills"), "user"],
    ...(await listDir(join(env.claudeDir, "skills", "synced")))
      .filter((bucket) => !bucket.startsWith("."))
      .map((bucket): [string, Source] => [join(env.claudeDir, "skills", "synced", bucket), "user"]),
    ...(await projectFolders(env, projectDir, gitRoot, "skills")).map((dir): [string, Source] => [
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
    for (const skill of await readSkills(env, dir, scope, { problems })) {
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
  const overrides = input.effective.find((s) => s.key === "skillOverrides")?.value;
  applySkillOverrides([...skills, ...commands], overrides);

  return {
    agents: [
      ...(await readAgents(env, projectDir, gitRoot, problems)),
      ...fromPlugins.flatMap((p) => p.agents),
    ],
    skills: [...skills, ...fromPlugins.flatMap((p) => p.skills)],
    commands: [...commands, ...fromPlugins.flatMap((p) => p.commands)],
    outputStyles: [
      ...(await readOutputStyles(env, projectDir, gitRoot, problems)),
      ...fromPlugins.flatMap((p) => p.outputStyles),
    ],
    hooks: await readHooks(input, active),
    mcpServers: await readMcpServers(input, active),
    plugins: plugins.map((p) => p.plugin),
  };
}

async function readHooks(input: InventoryInput, plugins: LoadedPlugin[]): Promise<Hook[]> {
  const { env, layers, trust, profile, problems } = input;
  const out: Hook[] = [];
  for (const layer of layers) {
    if (layer.data) out.push(...hooksFrom(layer.data.hooks, layer.scope, layer.path));
  }
  for (const loaded of plugins) {
    const { plugin } = loaded;
    const path = join(plugin.installPath, "hooks", "hooks.json");
    const file = await readJsonOrReport(env, path, problems);
    if (file) out.push(...hooksFrom(file.hooks, "plugin", path, plugin));
    for (const part of await manifestConfigs(env, loaded, "hooks", problems))
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
    plugins.filter((p) => p.plugin.enabledIn === "managed").map((p) => p.plugin.id)
  );
  // An interactive session holds back hooks from every settings file, managed and yours included,
  // until the folder or a parent covering it is trusted. The docs say nothing of plugin hooks, so
  // those are left as they are.
  const heldBack = hooksWait(trust, profile);
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
  return Object.entries(config).flatMap(([event, groups]) =>
    Array.isArray(groups)
      ? groups.flatMap((group, g) => groupHooks(event, g, group, source, sourcePath, plugin))
      : []
  );
}

/** The hooks of one matcher group, each with where it sits so an edit can find it again. */
function groupHooks(
  event: string,
  g: number,
  group: unknown,
  source: Source,
  sourcePath: string,
  plugin?: Plugin
): Hook[] {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return [];
  const matcher = stringField(group, "matcher");
  return group.hooks.flatMap((h: unknown, index): Hook[] => {
    if (!isRecord(h)) return [];
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
    if (matcher) entry.matcher = matcher;
    if (plugin) entry.plugin = plugin.id;
    return [entry];
  });
}
