import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

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
  platform: NodeJS.Platform;
  /**
   * The environment ccdesk runs in: where it finds an editor and `claude` (PATH, VISUAL, EDITOR,
   * CCDESK_EDITOR), and what the programs it starts inherit.
   */
  processEnv: NodeJS.ProcessEnv;
  /** CLAUDE_CODE_DISABLE_AUTO_MEMORY from the shell ccdesk runs in; it outranks autoMemoryEnabled. */
  disableAutoMemory?: string | undefined;
  /** CLAUDE_CODE_PROJECT_DIR_NAME, read only beside CLAUDE_CONFIG_DIR: one memory store for every project. */
  projectDirName?: string | undefined;
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
    platform: process.platform,
    processEnv,
    disableAutoMemory: processEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    projectDirName: configDir ? processEnv.CLAUDE_CODE_PROJECT_DIR_NAME || undefined : undefined,
  };
}

/** Your configuration home: your home directory, or the folder whose .claude is CLAUDE_CONFIG_DIR. */
export function isConfigHome(env: ScanEnv, path: string): boolean {
  return path === env.home || join(path, ".claude") === env.claudeDir;
}

/** Where macOS puts the com.anthropic.claudecode profile: for this user, then for the device. */
function managedProfiles(): string[] {
  const dir = "/Library/Managed Preferences";
  const profile = "com.anthropic.claudecode.plist";
  return [join(dir, userInfo().username, profile), join(dir, profile)];
}

function managedDirFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}
