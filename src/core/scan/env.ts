import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { resolvedPath } from "./files.ts";

/** Every location ccdesk reads, resolved once so tests can point it at a sandbox. */
export interface ScanEnv {
  home: string;
  /** `~/.claude`, or `--config-dir` or `CLAUDE_CONFIG_DIR` when set. */
  claudeDir: string;
  /** CLAUDE_CONFIG_DIR for the claude commands ccdesk runs: `--config-dir` or the shell's; unset for ~/.claude. */
  configDir?: string | undefined;
  /** Claude Code's own state file: OAuth, trust decisions, user MCP servers. Read-only for ccdesk. */
  claudeJson: string;
  /** System directory for organisation-managed CLAUDE.md and managed-settings.json. */
  managedDir: string;
  /** macOS configuration profiles that deliver managed settings (MDM), which outrank managedDir's files. */
  managedProfiles?: string[] | undefined;
  /**
   * On Windows: whether a registry key holds the `Settings` value Claude Code reads managed policy
   * from. ccdesk asks only whether it is there and drops what reg.exe prints of the value.
   */
  hasRegistryPolicy?: ((key: string) => Promise<boolean>) | undefined;
  platform: NodeJS.Platform;
  /**
   * The environment ccdesk runs in: where it finds an editor and `claude` (PATH, VISUAL, EDITOR,
   * CCDESK_EDITOR), and what the programs it starts inherit.
   */
  processEnv: NodeJS.ProcessEnv;
  /** CLAUDE_CODE_DISABLE_AUTO_MEMORY from the shell ccdesk runs in; it outranks autoMemoryEnabled. */
  disableAutoMemory?: string | undefined;
  /**
   * CLAUDE_CODE_PROJECT_DIR_NAME, read only beside CLAUDE_CONFIG_DIR and only when Claude Code
   * accepts the name: one store for every project's memory and transcripts.
   */
  projectDirName?: string | undefined;
  /** CLAUDE_CODE_PLUGIN_CACHE_DIR: the plugins root, in place of `<claudeDir>/plugins` (see pluginsRoot). */
  pluginsDir?: string | undefined;
}

/** `configDirFlag`, from `--config-dir`, stands in for CLAUDE_CONFIG_DIR and wins over it. */
export function scanEnvFromProcess(configDirFlag?: string): ScanEnv {
  const home = homedir();
  // Kept as the object itself: on Windows it reads PATH and Path alike, which a copy would not.
  // biome-ignore lint/style/noProcessEnv: building a ScanEnv from the real process is this function's job.
  const processEnv = process.env;
  // Made absolute here, from the folder ccdesk started in, because claude runs elsewhere.
  const chosen = configDirFlag ?? (processEnv.CLAUDE_CONFIG_DIR || undefined);
  const configDir = chosen === undefined ? undefined : resolve(chosen);
  return {
    home,
    claudeDir: configDir ?? join(home, ".claude"),
    configDir,
    // Claude Code keeps .claude.json beside the config dir it was given.
    claudeJson: configDir ? join(configDir, ".claude.json") : join(home, ".claude.json"),
    managedDir: managedDirFor(process.platform),
    managedProfiles: process.platform === "darwin" ? managedProfiles() : undefined,
    hasRegistryPolicy: process.platform === "win32" ? registryQuery(regExe(processEnv)) : undefined,
    platform: process.platform,
    processEnv,
    disableAutoMemory: processEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    projectDirName: configDir ? projectDirName(processEnv.CLAUDE_CODE_PROJECT_DIR_NAME) : undefined,
    pluginsDir: pluginsDir(processEnv.CLAUDE_CODE_PLUGIN_CACHE_DIR, home),
  };
}

/**
 * CLAUDE_CODE_PROJECT_DIR_NAME if Claude Code accepts it: 1-64 letters, digits, `-` or `_`, and not
 * a Windows device name. Claude Code ignores any other value and uses the derived name
 * (docs: sessions#name-the-project-directory-yourself).
 */
function projectDirName(name: string | undefined): string | undefined {
  if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) return undefined;
  return /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name) ? undefined : name;
}

/** CLAUDE_CODE_PLUGIN_CACHE_DIR as Claude Code reads it: a leading ~ is your home folder (observed in v2.1.296). */
function pluginsDir(value: string | undefined, home: string): string | undefined {
  if (!value) return undefined;
  return value === "~" || /^~[/\\]/.test(value) ? join(home, value.slice(1)) : resolve(value);
}

/** Your configuration home: your home directory, or the folder whose .claude is CLAUDE_CONFIG_DIR. */
export function isConfigHome(env: ScanEnv, path: string): boolean {
  return path === env.home || join(path, ".claude") === env.claudeDir;
}

/**
 * Whether the local settings file at `file` is your configuration home's own, read in a session
 * started there: only then does it apply before the trust step (docs:
 * permissions#when-your-local-settings-file-needs-trust).
 */
export function localInConfigHome(env: ScanEnv, startDir: string, file: string): boolean {
  return isConfigHome(env, startDir) && dirname(dirname(file)) === startDir;
}

/** Where macOS puts the com.anthropic.claudecode profile: for this user, then for the device. */
function managedProfiles(): string[] {
  const dir = "/Library/Managed Preferences";
  const profile = "com.anthropic.claudecode.plist";
  return [join(dir, userInfo().username, profile), join(dir, profile)];
}

/** The machine's and the user's registry keys for managed policy (docs: managed-settings#where-each-mechanism-stores-the-policy). */
export const HKLM_POLICY = "HKLM\\SOFTWARE\\Policies\\ClaudeCode";
export const HKCU_POLICY = "HKCU\\SOFTWARE\\Policies\\ClaudeCode";

/** reg.exe in the Windows folder, never one found on PATH. */
function regExe(processEnv: NodeJS.ProcessEnv): string {
  const root = processEnv.SystemRoot ?? "";
  return join(/^[A-Za-z]:[\\/]/.test(root) ? root : "C:\\Windows", "System32", "reg.exe");
}

/**
 * Asks `<program> query <key> /v Settings`, which exits 0 when the value is there; `leading`
 * arguments go before the query. Only the exit status is read: what it prints, the value included,
 * goes nowhere, so a large value still counts. A failure or a query over `timeout` ms counts as no
 * value.
 */
export function registryQuery(
  program: string,
  leading: string[] = [],
  timeout = 5000
): (key: string) => Promise<boolean> {
  return (key) =>
    new Promise((done) => {
      const child = spawn(program, [...leading, "query", key, "/v", "Settings"], {
        stdio: "ignore",
        timeout,
        windowsHide: true,
      });
      child.on("error", () => done(false));
      child.on("close", (code) => done(code === 0));
    });
}

function managedDirFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}

/**
 * Whether `dir/.claude` is the user's Claude folder, as it is in the home folder. Compared by where
 * the folders really are, so `dir/.claude` linking to a relocated Claude folder counts. Before
 * `.claude` exists, `dir` is compared with the Claude folder's parent, so a link to the home folder
 * counts as the home folder and a Project change there is not one.
 */
export async function isUserClaudeFolder(env: ScanEnv, dir: string): Promise<boolean> {
  if ((await resolvedPath(join(dir, ".claude"))) === (await resolvedPath(env.claudeDir)))
    return true;
  if (basename(env.claudeDir) !== ".claude") return false;
  return (await resolvedPath(dir)) === (await resolvedPath(dirname(env.claudeDir)));
}
