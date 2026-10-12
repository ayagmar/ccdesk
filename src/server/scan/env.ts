import { homedir } from "node:os";
import { join } from "node:path";

/** Every location ccdesk reads, resolved once so tests can point it at a sandbox. */
export interface ScanEnv {
  home: string;
  /** `~/.claude`, or `CLAUDE_CONFIG_DIR` when set. */
  claudeDir: string;
  /** Claude Code's own state file: OAuth, trust decisions, user MCP servers. Read-only for ccdesk. */
  claudeJson: string;
  /** System directory for organisation-managed CLAUDE.md and managed-settings.json. */
  managedDir: string;
  platform: NodeJS.Platform;
  /** CLAUDE_CODE_DISABLE_AUTO_MEMORY from the shell ccdesk runs in; it outranks autoMemoryEnabled. */
  disableAutoMemory?: string | undefined;
  /** CLAUDE_CODE_PROJECT_DIR_NAME, read only beside CLAUDE_CONFIG_DIR: one memory store for every project. */
  projectDirName?: string | undefined;
}

export function scanEnvFromProcess(): ScanEnv {
  const home = homedir();
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  return {
    home,
    claudeDir: configDir ?? join(home, ".claude"),
    // Claude Code keeps .claude.json beside the config dir it was given.
    claudeJson: configDir ? join(configDir, ".claude.json") : join(home, ".claude.json"),
    managedDir: managedDirFor(process.platform),
    platform: process.platform,
    disableAutoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    projectDirName: configDir ? process.env.CLAUDE_CODE_PROJECT_DIR_NAME || undefined : undefined,
  };
}

/** Your configuration home: your home directory, or the folder whose .claude is CLAUDE_CONFIG_DIR. */
export function isConfigHome(env: ScanEnv, path: string): boolean {
  return path === env.home || join(path, ".claude") === env.claudeDir;
}

function managedDirFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}
