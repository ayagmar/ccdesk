import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AgentsMdMode,
  type DirectoryView,
  type EffectiveSetting,
  type MemoryStore,
  type Overview,
  type Problem,
  type Sharing,
  type Trust,
} from "../../shared/types.ts";
import { buildContext } from "./context.ts";
import { type ScanEnv } from "./env.ts";
import {
  gitRoot,
  isDir,
  isFile,
  isRecord,
  mainWorktreeRoot,
  readJsonObject,
  stringsIn,
  visibilityOf,
} from "./files.ts";
import { AGENTS_MD_MODES, resolveInstructions } from "./instructions.ts";
import { readInventory } from "./inventory.ts";
import { readMemoryStore, storeDirName } from "./memory.ts";
import { permissionsOf, type Options as TrustOptions, trustWaits } from "./permissions.ts";
import { listProjects } from "./projects.ts";
import { effectiveSettings, readSettingsLayers } from "./settings.ts";
import { builtinTools } from "./tools.ts";

async function readClaudeJson(env: ScanEnv): Promise<Record<string, unknown> | null> {
  const result = await readJsonObject(env.claudeJson);
  return result.ok ? result.data : null;
}

export async function scanOverview(env: ScanEnv, launchDir: string): Promise<Overview> {
  const claudeJson = await readClaudeJson(env);
  const projects = await listProjects(env, claudeJson, launchDir);

  const hashesByName = new Map<string, Array<{ projectPath: string; hash: string }>>();
  const memoryCatalog: Overview["memoryCatalog"] = [];
  for (const project of projects) {
    for (const memory of project.store?.memories ?? []) {
      memoryCatalog.push({
        projectPath: project.path,
        path: memory.path,
        name: memory.name,
        description: memory.description,
        type: memory.type,
      });
      const list = hashesByName.get(memory.name) ?? [];
      list.push({ projectPath: project.path, hash: memory.hash });
      hashesByName.set(memory.name, list);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    home: env.home,
    claudeDir: env.claudeDir,
    launchDir: resolve(launchDir),
    platform: env.platform,
    projects: projects.map(({ store: _store, ...summary }) => summary),
    sharedMemories: [...hashesByName.entries()]
      .filter(([, stores]) => stores.length > 1)
      .map(([name, stores]) => ({ name, stores }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    memoryCatalog,
  };
}

/** Everything Claude Code reads when started in `dir`. */
export async function scanDirectory(env: ScanEnv, dir: string): Promise<DirectoryView> {
  const path = resolve(dir);
  const exists = await isDir(path);
  const claudeJson = await readClaudeJson(env);
  const root = exists ? await gitRoot(path) : null;

  const settings = await readSettingsLayers(env, path);
  const effective = effectiveSettings(settings);
  const mode = agentsMdMode(settings);
  const excludes = effective.find((s) => s.key === "claudeMdExcludes")?.value;
  const mainRoot = exists ? await mainWorktreeRoot(path) : null;
  const trust = trustOf(env, claudeJson, path, mainRoot ?? root);
  const managedLayer = settings.find((l) => l.scope === "managed");
  const managedClaudeMd = managedLayer?.data?.claudeMd;
  const problems: Problem[] = [];
  const instructions = await resolveInstructions({
    env,
    cwd: path,
    mode,
    excludes: stringsIn(excludes),
    externalImports: trust.externalImports,
    managedClaudeMd:
      managedLayer && typeof managedClaudeMd === "string"
        ? { path: `${managedLayer.path}#claudeMd`, text: managedClaudeMd }
        : null,
    problems,
  });

  const inventory = await readInventory({
    env,
    projectDir: path,
    gitRoot: root,
    layers: settings,
    claudeJson,
    trust,
  });

  // Every project file that shapes Claude here, so the UI can say who sees each one.
  const mcpJson = join(path, ".mcp.json");
  const projectFiles = [
    ...instructions.filter((i) => i.scope === "project" || i.scope === "local").map((i) => i.path),
    ...settings
      .filter((s) => s.exists && (s.scope === "project" || s.scope === "local"))
      .map((s) => s.path),
    ...((await isFile(mcpJson)) ? [mcpJson] : []),
    ...[...inventory.agents, ...inventory.skills, ...inventory.commands, ...inventory.outputStyles]
      .filter((e) => e.scope === "project" || e.scope === "local")
      .map((e) => e.path),
  ];
  const visibility = await visibilityOf(root, projectFiles);
  for (const item of [...instructions, ...settings]) {
    const v = visibility.get(item.path);
    if (v) item.visibility = v;
  }
  let sharing: Sharing | null = null;
  if (root) {
    sharing = { tracked: [], untracked: [], ignored: [] };
    for (const file of new Set(projectFiles)) {
      const v = visibility.get(file);
      // Shown as repository paths, with forward slashes on every platform.
      const rel = relative(root, file).replaceAll("\\", "/");
      if (v === "tracked") sharing.tracked.push(rel);
      else if (v === "untracked") sharing.untracked.push(rel);
      else if (v === "ignored") sharing.ignored.push(rel);
    }
  }

  // docs: permissions#when-your-local-settings-file-needs-trust
  const localFromRepository = settings.some(
    (l) => l.scope === "local" && l.visibility === "tracked"
  );
  const trustOptions = { trust, inConfigHome: isConfigHome(env, path), localFromRepository };
  const memory = await readMemory(env, mainRoot, path, effective, trustOptions);
  const permissions = permissionsOf(settings, trustOptions);

  for (const l of settings) if (l.error) problems.push({ path: l.path, error: l.error });
  const mcp = await readJsonObject(mcpJson);
  if (!mcp.ok && !mcp.missing) problems.push({ path: mcpJson, error: mcp.error });

  return {
    path,
    exists,
    gitRoot: root,
    agentsMdMode: mode,
    instructions,
    settings,
    effective,
    memory,
    inventory,
    context: await buildContext({
      env,
      projectRoot: root ?? path,
      instructions,
      memory,
      inventory,
      effective,
    }),
    permissions,
    tools: builtinTools(permissions, inventory.hooks),
    trust,
    problems,
    sharing,
  };
}

/** Your home directory, or the folder whose .claude is CLAUDE_CONFIG_DIR. */
function isConfigHome(env: ScanEnv, path: string): boolean {
  return path === env.home || join(path, ".claude") === env.claudeDir;
}

/**
 * Your answers to Claude Code's trust dialogs, from ~/.claude.json (docs: permissions#project-allow-rules-and-workspace-trust).
 * In a repository the key is the main checkout's root; outside one it is the folder, and a trusted
 * parent folder covers it. In your home directory trust lasts one session and is never saved.
 */
function trustOf(
  env: ScanEnv,
  claudeJson: Record<string, unknown> | null,
  path: string,
  repositoryRoot: string | null
): Trust {
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {};
  const entry = (key: string) => (isRecord(projects[key]) ? projects[key] : {});
  const root = repositoryRoot ?? path;
  const own = entry(root);
  const trust: Trust = {
    root,
    trusted: own.hasTrustDialogAccepted === true,
    sessionOnly: path === env.home,
    // These two keys are not documented; they are what Claude Code writes for the import dialog.
    externalImports:
      own.hasClaudeMdExternalIncludesApproved === true
        ? "approved"
        : own.hasClaudeMdExternalIncludesWarningShown === true
          ? "declined"
          : "not-asked",
  };
  if (!trust.trusted && !repositoryRoot)
    for (let d = dirname(path); d !== dirname(d); d = dirname(d))
      if (entry(d).hasTrustDialogAccepted === true) {
        trust.inheritedFrom = d;
        break;
      }
  return trust;
}

/**
 * The auto memory Claude Code uses here (docs: memory#storage-location, settings-reference#automemoryenabled).
 * Worktrees and subdirectories of one repository share one store. The store is returned even
 * when its folder does not exist yet, so a note about memory being off still shows.
 */
async function readMemory(
  env: ScanEnv,
  mainRoot: string | null,
  path: string,
  effective: EffectiveSetting[],
  trustOptions: TrustOptions
): Promise<MemoryStore> {
  const key = mainRoot ?? path;
  const setting = effective.find((s) => s.key === "autoMemoryDirectory");
  // A value from a repository file counts once the folder is trusted, like hooks (docs:
  // settings-reference#automemorydirectory); until then the next file down that sets it decides.
  const waitsForTrust = trustWaits(trustOptions);
  const candidates = setting
    ? [{ scope: setting.from[0], value: setting.value }, ...setting.overridden]
    : [];
  const waiting = candidates.find((c) => c.scope && waitsForTrust(c.scope));
  const custom = candidates.find((c) => c.scope && !waitsForTrust(c.scope));
  const customDir = typeof custom?.value === "string" ? expandHome(env, custom.value) : null;
  const storeName = env.projectDirName ?? storeDirName(key);
  const dir = customDir ?? join(env.claudeDir, "projects", storeName, "memory");
  const store: MemoryStore = (await readMemoryStore(dir, key)) ?? {
    dir,
    loaded: true,
    projectPath: key,
    index: null,
    memories: [],
  };
  if (customDir) store.custom = true;

  const disable = env.disableAutoMemory;
  const enabled = effective.find((s) => s.key === "autoMemoryEnabled");
  const fromRepository =
    custom?.scope === "project" || (custom?.scope === "local" && trustOptions.localFromRepository);
  if (disable === "1" || disable === "true") {
    store.loaded = false;
    store.note = "CLAUDE_CODE_DISABLE_AUTO_MEMORY turns auto memory off in this shell";
  } else if (disable === undefined && enabled?.value === false) {
    store.loaded = false;
    store.note = `autoMemoryEnabled is false in ${enabled.from.join(", ")} settings`;
  } else if (customDir && custom && fromRepository && blocksOutsideReads(effective)) {
    // docs: settings-reference#permissions-blockreadsoutsideworkingdirectories
    store.loaded = false;
    store.note =
      "autoMemoryDirectory comes from repository settings and blockReadsOutsideWorkingDirectories is on, so Claude Code loads no auto memory from it";
  } else if (customDir && custom) {
    store.note = `autoMemoryDirectory in ${custom.scope} settings points here; ccdesk only changes stores under ~/.claude/projects`;
  } else if (waiting) {
    store.note = `autoMemoryDirectory in ${waiting.scope} settings takes over once you trust this folder; until then Claude Code uses this store`;
  } else if (env.projectDirName) {
    store.note = `CLAUDE_CODE_PROJECT_DIR_NAME names this store "${env.projectDirName}" in every project`;
  }
  return store;
}

function blocksOutsideReads(effective: EffectiveSetting[]): boolean {
  const permissions = effective.find((s) => s.key === "permissions")?.value;
  return isRecord(permissions) && permissions.blockReadsOutsideWorkingDirectories === true;
}

/** autoMemoryDirectory takes an absolute or ~/ path; anything else is not a valid value. */
function expandHome(env: ScanEnv, path: string): string | null {
  if (path.startsWith("~/")) return join(env.home, path.slice(2));
  return isAbsolute(path) ? path : null;
}

/** Read from user, --settings or managed settings only; project and local files are ignored for it. */
function agentsMdMode(layers: DirectoryView["settings"]): AgentsMdMode {
  for (const scope of ["managed", "user"] as const) {
    const configs = layers.find((l) => l.scope === scope)?.data?.pluginConfigs;
    if (!isRecord(configs)) continue;
    for (const id of ["cc-plugin-agents-md@builtin", "agents-md@builtin"]) {
      const entry = configs[id];
      const value =
        isRecord(entry) && isRecord(entry.options) ? entry.options.instructionFiles : undefined;
      if (typeof value === "string" && AGENTS_MD_MODES.includes(value as AgentsMdMode))
        return value as AgentsMdMode;
    }
  }
  return "claude-md-or-agents-md";
}
