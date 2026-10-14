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
  pluginOnlyNote,
  pluginOnlySurfaces,
  readPlugins,
  unwrapped,
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

/** Whether a name is in the `anthropic-skills` namespace, which Claude Code keeps for synced skills. */
function isReservedName(name: string): boolean {
  return name === "anthropic-skills" || name.startsWith("anthropic-skills:");
}

const RESERVED_NOTE =
  "Claude Code keeps the name anthropic-skills for skills synced from claude.ai and skips this one";

/**
 * Why Claude Code skips a skill outside a plugin for its name, or null: a folder named `synced` in
 * any case, or a folder or frontmatter name in the `anthropic-skills` namespace
 * (docs: skills#where-skills-live, skills#names-reserved-for-synced-skills).
 */
export function reservedSkillNote(skill: Entry): string | null {
  const folder = basename(skill.folder ?? "");
  if (folder.toLowerCase() === "synced")
    return "Claude Code keeps the folder name synced for skills synced from claude.ai and skips this one";
  if (isReservedName(folder) || isReservedName(skill.name)) return RESERVED_NOTE;
  return null;
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
    if (name.startsWith(".")) continue;
    const skill = await readSkill(env, join(dir, name), scope, options);
    if (!skill) continue;
    const reserved = scope === "plugin" ? null : reservedSkillNote(skill);
    if (reserved) skill.skipped = reserved;
    out.push(skill);
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
  // A commands map replaces the default folder as a path does (docs: plugins-reference#how-each-key-combines-with-its-default-location).
  const commands = isRecord(loaded.manifest.commands)
    ? await manifestCommands(env, loaded, problems)
    : await listed("commands", "commands", ":");
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
  /** The repository's canonical root (see canonicalRoot): a linked worktree reads through to it. */
  canonicalRoot: string;
  layers: SettingsLayer[];
  effective: EffectiveSetting[];
  /** Managed settings as written, nothing hidden: for checks that must see header values. */
  managed: Record<string, unknown> | null;
  claudeJson: Record<string, unknown> | null;
  trust: Trust;
  profile: SessionProfile;
  /** Whether a project or local file's grants wait for the trust dialog (see trustWaits). */
  waitsForTrust: (scope: Scope, path: string) => boolean;
  /** Receives files that are there but cannot be read or parsed. */
  problems: Problem[];
}

/** The project's `.claude/<sub>` folders for a kind of entry, root first (see projectFolders). */
type ProjectFolders = (sub: string) => Promise<string[]>;

/**
 * The `.claude/<sub>` folders of the start directory and every parent up to the repository root
 * (only the start directory outside git), root first, leaving out the user folder. In a linked
 * worktree whose root has no `.claude/<sub>`, the main checkout's comes first, so it loses to the
 * worktree's own (docs: worktrees#what-worktrees-share-with-the-main-checkout; output styles are
 * read through too, as observed in v2.1.296).
 */
async function projectFolders(
  env: ScanEnv,
  { projectDir, gitRoot, canonicalRoot }: InventoryInput,
  sub: string
): Promise<string[]> {
  const dirs = ancestorsRootFirst(projectDir)
    .filter((dir) => !gitRoot || isWithin(gitRoot, dir))
    .slice(gitRoot ? 0 : -1);
  const folders: string[] = [];
  if (gitRoot && canonicalRoot !== gitRoot && !(await isDir(join(gitRoot, ".claude", sub))))
    folders.push(join(canonicalRoot, ".claude", sub));
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
 * A file Claude Code skips, or one that `locked` keeps to managed settings and plugins, takes no
 * part in that.
 */
async function readAgents(
  env: ScanEnv,
  folders: ProjectFolders,
  locked: boolean,
  problems: Problem[]
) {
  const sources: [string, Source][] = [
    [join(env.managedDir, ".claude", "agents"), "managed"],
    ...(await folders("agents")).reverse().map((dir): [string, Source] => [dir, "project"]),
    [join(env.claudeDir, "agents"), "user"],
  ];
  const agents: Entry[] = [];
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of sources)
    for (const agent of await readFileEntries(env, dir, scope, { problems })) {
      const problem =
        locked && scope !== "managed" ? pluginOnlyNote("agents") : agentProblems(agent.text)[0];
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
async function readOutputStyles(env: ScanEnv, folders: ProjectFolders, problems: Problem[]) {
  const sources: [string, Source][] = [
    [join(env.managedDir, ".claude", "output-styles"), "managed"],
    ...(await folders("output-styles")).reverse().map((dir): [string, Source] => [dir, "project"]),
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

/**
 * Skills from the managed folder, yours and the project's, and the one that runs for each name. The same name in two of managed, yours and the project runs the first, in that order
 * (docs: skills#resolve-skills-that-share-a-name).
 */
async function readLocalSkills(
  env: ScanEnv,
  folders: ProjectFolders,
  locked: boolean,
  problems: Problem[]
): Promise<{ skills: Entry[]; winners: Map<string, Entry> }> {
  // Project skills come from the start directory and every parent up to the repository root.
  const skillDirs: [string, Source][] = [
    [join(env.managedDir, ".claude", "skills"), "managed"],
    [join(env.claudeDir, "skills"), "user"],
    ...(await folders("skills")).map((dir): [string, Source] => [dir, "project"]),
  ];
  const skills: Entry[] = [];
  const seenFolders = new Set<string>();
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of skillDirs) {
    for (const skill of await readSkills(env, dir, scope, { problems })) {
      // A folder that several locations link to loads once.
      const real = skill.realPath ?? skill.folder ?? skill.path;
      if (seenFolders.has(real)) continue;
      seenFolders.add(real);
      if (!skill.skipped && locked && scope !== "managed") skill.skipped = pluginOnlyNote("skills");
      skills.push(skill);
      if (skill.skipped) continue;
      const winner = winners.get(skill.name);
      if (winner && winner.scope !== skill.scope) skill.shadowedBy = winner.path;
      else if (!winner) winners.set(skill.name, skill);
    }
  }
  return { skills, winners };
}

/**
 * Command files from the managed folder, yours, then every project folder from the start directory
 * up to the repository root, closest first; the first of a name runs, and a skill of that name runs
 * instead of any (docs: skills#resolve-skills-that-share-a-name; the order within the project is
 * observed in v2.1.296). A command file is a skill too: one with disable-model-invocation is not
 * listed to Claude.
 */
async function readCommands(
  env: ScanEnv,
  folders: ProjectFolders,
  locked: boolean,
  skills: Map<string, Entry>,
  problems: Problem[]
): Promise<Entry[]> {
  const sources: [string, Source][] = [
    [join(env.managedDir, ".claude", "commands"), "managed"],
    [join(env.claudeDir, "commands"), "user"],
    ...(await folders("commands")).reverse().map((dir): [string, Source] => [dir, "project"]),
  ];
  const commands: Entry[] = [];
  const winners = new Map<string, Entry>();
  for (const [dir, scope] of sources)
    for (const command of await readFileEntries(env, dir, scope, { separator: ":", problems })) {
      commands.push(command);
      if (isTrue(parseFrontmatter(command.text).data["disable-model-invocation"]))
        command.listed = false;
      // A command file or subfolder named in the anthropic-skills namespace does not load.
      if (isReservedName(command.name)) command.skipped = RESERVED_NOTE;
      else if (locked) command.skipped = pluginOnlyNote("skills");
      if (command.skipped) continue;
      const winner = skills.get(command.name) ?? winners.get(command.name);
      if (winner) command.shadowedBy = winner.path;
      else winners.set(command.name, command);
    }
  return commands;
}

/**
 * A name as Claude Code compares a synced skill's with other commands': without case, spacing or
 * invisible characters, with compatibility forms such as fullwidth letters and dash variants as
 * their plain equivalents (docs: skills#when-a-synced-skill-name-matches-another-command).
 */
function foldedName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\p{Z}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, "")
    .replace(/[\p{Pd}\u2212]/gu, "-")
    .toLowerCase();
}

/**
 * Skills synced from your claude.ai account. Claude Code downloads each account's into
 * `synced/<organization>_<account>` and loads only the folder of the account `~/.claude.json` says
 * you are signed in with (observed in v2.1.296), and none after `syncClaudeAiSkills: false`
 * (docs: skills#where-synced-skills-load). They take no part in the precedence of your skills.
 */
async function readSyncedSkills(input: InventoryInput, locked: boolean): Promise<Entry[]> {
  const { env, claudeJson, problems } = input;
  const root = join(env.claudeDir, "skills", "synced");
  const account = isRecord(claudeJson?.oauthAccount) ? claudeJson.oauthAccount : {};
  const org = stringField(account, "organizationUuid");
  const user = stringField(account, "accountUuid");
  const signedIn = org && user ? `${org}_${user}`.toLowerCase() : null;
  const setting = input.effective.find((s) => s.key === "syncClaudeAiSkills");
  // Only false counts: true is the same as unset.
  const off = [setting?.value, ...(setting?.overridden ?? []).map((o) => o.value)].includes(false);
  const notLoaded = (bucket: string): string | null => {
    if (locked) return pluginOnlyNote("skills");
    if (off) return "syncClaudeAiSkills is false, so Claude Code loads no synced skill";
    if (!signedIn)
      return "Claude Code loads synced skills only when you sign in with a claude.ai account";
    if (bucket !== signedIn)
      return "Synced for a claude.ai account other than the one you are signed in with";
    return null;
  };
  const skills: Entry[] = [];
  for (const bucket of await listDir(root)) {
    if (bucket.startsWith(".")) continue;
    for (const skill of await readSkills(env, join(root, bucket), "user", { problems })) {
      skill.synced = true;
      const skipped = skill.skipped ?? notLoaded(bucket);
      if (skipped) skill.skipped = skipped;
      skills.push(skill);
    }
  }
  return skills;
}

/**
 * Gives a synced skill its full name, anthropic-skills:<name>, when another skill or command uses
 * its short name: the other one keeps it (docs: skills#when-a-synced-skill-name-matches-another-command).
 */
function nameSyncedSkills(synced: Entry[], others: Entry[]): void {
  const taken = new Set(others.filter((e) => !e.skipped).map((e) => foldedName(e.name)));
  for (const skill of synced)
    if (!skill.skipped && taken.has(foldedName(skill.name)))
      skill.id = `anthropic-skills:${skill.name}`;
}

export async function readInventory(input: InventoryInput): Promise<Inventory> {
  const { env, layers, problems } = input;
  const locked = pluginOnlySurfaces(input.managed);
  const plugins = await readPlugins(env, layers, input, problems);
  const active = plugins.filter((p) => p.plugin.enabled);
  const fromPlugins = await Promise.all(
    active.map((plugin) => pluginEntries(env, plugin, problems))
  );
  const folders = (sub: string) => projectFolders(env, input, sub);
  const { skills, winners } = await readLocalSkills(env, folders, locked.has("skills"), problems);
  const commands = await readCommands(env, folders, locked.has("skills"), winners, problems);
  const synced = await readSyncedSkills(input, locked.has("skills"));
  const fromPluginSkills = fromPlugins.flatMap((p) => p.skills);
  nameSyncedSkills(synced, [...skills, ...commands, ...fromPluginSkills]);
  const overrides = input.effective.find((s) => s.key === "skillOverrides")?.value;
  applySkillOverrides([...skills, ...synced, ...commands], overrides);

  return {
    agents: [
      ...(await readAgents(env, folders, locked.has("agents"), problems)),
      ...fromPlugins.flatMap((p) => p.agents),
    ],
    skills: [...skills, ...synced, ...fromPluginSkills],
    commands: [...commands, ...fromPlugins.flatMap((p) => p.commands)],
    outputStyles: [
      ...(await readOutputStyles(env, folders, problems)),
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
  for (const loaded of plugins) out.push(...(await pluginHooks(env, loaded, problems)));

  // docs: hooks#disable-or-remove-hooks, settings-reference#allowmanagedhooksonly
  const managed = layers.find((l) => l.scope === "managed")?.data;
  const managedOff = managed?.disableAllHooks === true;
  // The value left after precedence counts, so a project false beats a user true.
  const othersOff =
    HIGHEST_FIRST.filter((s) => s !== "managed")
      .flatMap((scope) => layers.filter((l) => l.scope === scope))
      .find((l) => typeof l.data?.disableAllHooks === "boolean")?.data?.disableAllHooks === true;
  const managedOnly = managed?.allowManagedHooksOnly === true;
  const locked = pluginOnlySurfaces(input.managed).has("hooks");
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
    } else if (locked && hook.source !== "managed" && hook.source !== "plugin") {
      hook.active = false;
      hook.note = pluginOnlyNote("hooks");
    } else if (hook.source !== "plugin" && heldBack) {
      hook.active = false;
      hook.note = "Waits until you accept Claude Code's trust dialog for this folder";
    }
  }
  return out;
}

/** A plugin's hooks: hooks/hooks.json, then the files and inline objects its manifest names. */
async function pluginHooks(
  env: ScanEnv,
  loaded: LoadedPlugin,
  problems: Problem[]
): Promise<Hook[]> {
  const { plugin } = loaded;
  const out: Hook[] = [];
  const path = join(plugin.installPath, "hooks", "hooks.json");
  const file = await readJsonOrReport(env, path, problems);
  const problem = file && unwrapped(file, "hooks");
  if (problem) problems.push({ path, error: problem });
  else if (file) out.push(...hooksFrom(file.hooks, "plugin", path, plugin));
  // A hooks file wraps its events in "hooks"; an inline object is the events themselves.
  for (const part of await manifestConfigs(env, loaded, "hooks", problems, true))
    out.push(...hooksFrom(part.value, "plugin", part.path, plugin));
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
