// Shapes the server sends to the UI. Paths are absolute; the UI shortens them for display.

/** Where a piece of config comes from, in Claude Code's own terms. */
export type Scope = "managed" | "user" | "project" | "local";

/** Who can see a file: files tracked in git reach everyone who clones the repo. */
export type Visibility = "tracked" | "untracked" | "ignored" | "no-git";

interface FileRef {
  path: string;
  /** Where a symlinked file, or a rule in a linked folder outside the project, really is. */
  realPath?: string;
  mtime: string;
  bytes: number;
  lines: number;
  visibility?: Visibility;
}

export interface TextFile extends FileRef {
  text: string;
}

export type InstructionKind = "claude-md" | "claude-local-md" | "agents-md" | "rule";

export interface ImportRef {
  raw: string;
  resolved: string;
  /** The file that imports it: the instruction file, or an import of it. */
  via: string;
  exists: boolean;
  /** Resolves outside the working directory, so Claude Code asks once before loading it. */
  external: boolean;
  /** External import from a project file that waits for (or was refused) your approval. */
  pending?: boolean;
  /** Over 4 MiB, which Claude Code does not load. */
  tooLarge?: boolean;
}

/** Whether a file loads at session start, once Claude works with matching files, or not at all. */
type InstructionStatus = "loaded" | "on-match" | "skipped";

export interface Instruction extends TextFile {
  kind: InstructionKind;
  scope: Scope;
  /** Directory the file belongs to (the one Claude Code walked through). */
  dir: string;
  status: InstructionStatus;
  /** Why the file loads or not, in plain words. */
  reason: string;
  imports: ImportRef[];
  /** `paths:` globs on a rule; such rules load only when Claude touches matching files. */
  paths?: string[];
  /** Upkeep notes from ccdesk, such as a file longer than Claude Code's docs recommend. */
  checks: string[];
}

export type AgentsMdMode =
  | "claude-md-or-agents-md"
  | "claude-md-and-agents-md"
  | "claude-md"
  | "managed-only";

export type MemoryType = "user" | "feedback" | "project" | "reference" | "unknown";

export interface Memory {
  file: string;
  path: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  mtime: string;
  bytes: number;
  /** Fingerprint of the file; deleting it requires it to be unchanged. */
  revision: string;
  inIndex: boolean;
  /** Short content hash, used to spot the same memory in several directories. */
  hash: string;
  links: string[];
  brokenLinks: string[];
  /** Other memory names in this store that link here. */
  linkedFrom: string[];
}

export interface MemoryIndex extends TextFile {
  revision: string;
  /** Claude Code loads only the first 200 lines or 25KB of MEMORY.md. */
  truncated: boolean;
  loadedLines: number;
  /** Index lines pointing at a file that does not exist. */
  missingFiles: string[];
}

export interface MemoryStore {
  dir: string;
  /** False when auto memory is turned off here; the files are still shown. */
  loaded: boolean;
  /** Why memory is off, or that it comes from autoMemoryDirectory. */
  note?: string;
  /** Set by autoMemoryDirectory; ccdesk only changes stores under ~/.claude/projects. */
  custom?: boolean;
  /** The directory the store is keyed by (git repository root or project root). */
  projectPath: string | null;
  index: MemoryIndex | null;
  memories: Memory[];
}

export interface SettingsLayer {
  scope: Scope;
  path: string;
  exists: boolean;
  /** A local file an older Claude Code left in the start directory; the repository root's file wins. */
  legacy?: boolean;
  /** For managed settings: every file merged into this layer, managed-settings.d drop-ins included. */
  sources?: string[];
  visibility?: Visibility;
  /** Parsed JSON with `env` and `headers` values redacted. */
  data: Record<string, unknown> | null;
  error?: string;
}

export interface EffectiveSetting {
  key: string;
  value: unknown;
  /** Scopes that contribute: one for a plain override, several for merged lists. */
  from: Scope[];
  merged: boolean;
  /** Values from lower layers that lost to `from`. */
  overridden: Array<{ scope: Scope; value: unknown }>;
  /** Values in files Claude Code does not read this key from. `from` is empty when all are. */
  ignored: Array<{ scope: Scope; value: unknown; reason: string }>;
  /** How this key resolves when that differs from plain precedence. */
  note?: string;
}

export type BackupKind = "settings" | "mcp" | "memory-index" | "memory-delete" | "memory-restore";

/** One change ccdesk made, from its backup folder. */
export interface BackupSummary {
  id: string;
  kind: BackupKind;
  /** The file that was changed (for a deleted memory: the memory file). */
  target: string;
  createdAt: string;
  /** The change created the file, so there is no earlier version to restore. */
  created: boolean;
  /** The change was interrupted or failed halfway; the backup still holds the earlier text. */
  incomplete?: boolean;
}

/** A change ccdesk made; Recent changes lists it under `id` and can undo it. */
export interface Change {
  id: string;
  target: string;
  /** The file's revision right after the change, which an undo requires. */
  revision: string;
}

/** What ccdesk can change in auto memory: delete a memory, add one to MEMORY.md, or drop dead index lines. */
export type MemoryAction = "delete" | "add" | "remove-dead";

/** What a memory change would do to each file it touches, reviewed before anything is written. */
export interface MemoryChangePreview {
  files: Array<{
    path: string;
    before: string | null;
    /** null when the change deletes the file. */
    after: string | null;
  }>;
  /** Fingerprint of everything the change was worked out from; saving requires it unchanged. */
  revision: string;
}

/** What restoring a backup would change, shown as a diff before anything is written. */
export interface RestorePreview {
  id: string;
  kind: BackupKind;
  target: string;
  /** The file now; null when it does not exist. Settings are shown with secrets hidden. */
  before: string | null;
  /** The file as the backup holds it. */
  after: string;
  /** Fingerprint of the file now (and of MEMORY.md, for a deleted memory); restoring requires it unchanged. */
  revision: string;
  /** Why this backup cannot be restored right now. */
  blocked?: string;
  /** For a deleted memory: the lines put back into MEMORY.md. */
  indexLines?: string[];
}

export interface Entry {
  name: string;
  description: string;
  /** The file Claude Code reads (SKILL.md for a skill). */
  path: string;
  /** A skill's folder. */
  folder?: string;
  /** False for a skill Claude cannot invoke itself, which is left out of the skill listing. */
  listed?: boolean;
  /** The skillOverrides state set for this skill or command in settings, when not "on". */
  override?: "name-only" | "user-invocable-only" | "off";
  /** A subagent whose name a higher-priority definition also uses: that definition's file. */
  shadowedBy?: string;
  /** A plugin subagent's scoped name, with its plugin and subfolders, such as `my-plugin:review:security`. */
  id?: string;
  /** A skill's `when_to_use`, appended to its description in the listing. */
  whenToUse?: string;
  /** A skill's `paths:` globs: Claude loads it on its own only for matching files. */
  paths?: string[];
  realPath?: string;
  scope: Scope | "plugin";
  plugin?: string;
  model?: string;
  text: string;
}

export interface Hook {
  event: string;
  matcher?: string;
  type: string;
  command: string;
  source: Scope | "plugin";
  sourcePath: string;
  plugin?: string;
  /** False when disableAllHooks or allowManagedHooksOnly turns it off. */
  active: boolean;
  note?: string;
  /** Where it is in its file: the matcher group under `event`, and the hook within the group. */
  at: { group: number; index: number };
  /** The hook as written, with header values hidden. */
  definition: unknown;
}

export type McpStatus =
  | "active"
  | "shadowed"
  | "disabled"
  | "rejected"
  | "pending"
  | "blocked"
  | "invalid";

export interface McpServer {
  name: string;
  scope: Scope | "plugin";
  transport: string;
  target: string;
  sourcePath: string;
  status: McpStatus;
  plugin?: string;
  /** Why the server is not started, in plain words. */
  note?: string;
  /** The server as written, with env, header and URL secrets hidden. */
  definition: unknown;
}

export interface Plugin {
  id: string;
  version: string;
  scope: string;
  installPath: string;
  updated: string | null;
  enabled: boolean;
  /** The settings file whose enabledPlugins entry decides it; unset when the default does. */
  enabledIn?: Scope;
  /** Where the enabled state comes from: a settings file or the plugin's default. */
  note: string;
}

export interface ProjectSummary {
  path: string;
  exists: boolean;
  sessions: number;
  lastActive: string | null;
  memories: number;
  /** /tmp, test runs, scratch workspaces. */
  ephemeral: boolean;
}

export interface Overview {
  generatedAt: string;
  home: string;
  claudeDir: string;
  launchDir: string;
  platform: NodeJS.Platform;
  projects: ProjectSummary[];
  /** Memory names found in more than one store, with each store's content hash. */
  sharedMemories: Array<{ name: string; stores: Array<{ projectPath: string; hash: string }> }>;
  /** Every memory in every directory, for search. */
  memoryCatalog: Array<{
    projectPath: string;
    path: string;
    name: string;
    description: string;
    type: MemoryType;
  }>;
}

export interface Inventory {
  agents: Entry[];
  skills: Entry[];
  commands: Entry[];
  outputStyles: Entry[];
  hooks: Hook[];
  mcpServers: McpServer[];
  plugins: Plugin[];
}

/** One piece of what Claude Code puts in context at session start, in load order. */
export interface ContextBlock {
  kind:
    | "instruction"
    | "import"
    | "memory-index"
    | "output-style"
    | "skills"
    | "agents"
    | "not-counted";
  /** A file, or a label for a listing ccdesk assembled. */
  path: string;
  scope: Scope | "memory" | "plugin";
  /** For an import: the file that imports it. */
  via?: string;
  /** Null when ccdesk does not show or count this block; `note` says why. */
  text: string | null;
  lines: number;
  bytes: number;
  note?: string;
}

export type PermissionList = "allow" | "ask" | "deny";

/** One entry of a settings file's `permissions`, with whether Claude Code applies it here. */
export type Permission =
  | {
      kind: "rule";
      list: PermissionList;
      rule: string;
      scope: Scope;
      /** The settings file the rule is in. */
      path: string;
      inEffect: boolean;
      /** Why the rule does not apply, or which identical rule decides it first. */
      note?: string;
      /** The same rule in a list checked first (deny, then ask), which decides it. */
      decidedBy?: { list: PermissionList; scope: Scope };
    }
  | {
      kind: "defaultMode" | "additionalDirectories";
      value: string;
      scope: Scope;
      inEffect: boolean;
      note?: string;
    };

/** A permission rule as it applies to one built-in tool. */
export interface ToolRule {
  list: PermissionList;
  rule: string;
  scope: Scope;
  /** A path rule on a tool Claude Code never checks paths for, such as Write(docs/**). */
  unchecked?: true;
}

/** One of Claude Code's built-in tools and what the permission rules here make of it. */
export interface BuiltinTool {
  name: string;
  description: string;
  /** Manual mode asks before using it (file tools: only outside the working directories). */
  asks: boolean;
  /**
   * What happens when Claude wants it in Manual mode: a rule naming the whole tool decides, else
   * the tool's default. A denied tool is removed from Claude's context.
   */
  verdict: "denied" | "asks" | "allowed" | "default";
  decidedBy?: ToolRule;
  /** Every deny rule in effect that removes the whole tool; all must go to turn it back on. */
  removedBy?: ToolRule[];
  /** Rules for some uses only, such as Bash(npm test *) or Edit(docs/**). */
  scoped: ToolRule[];
  /** Active PreToolUse hooks whose matcher covers this tool. */
  hooks: number;
}

/**
 * How Claude used tools in the sessions started in a directory, counted from Claude Code's
 * transcripts. Only counts and rule patterns leave the server, never commands or text.
 */
export interface Usage {
  /** Sessions counted; their subagents' calls count too. */
  sessions: number;
  /** Counted across the repository and its worktrees, not only this folder. */
  repository: boolean;
  /** When the earliest call counted was made; Claude Code deletes old transcripts. */
  since: string | null;
  tools: ToolUsage[];
  /** Calls you approved by hand, grouped by the allow rule that would cover them, most first. */
  approvals: Approval[];
  /** For each rule asked about, how many calls it covers; null when ccdesk cannot match its kind. */
  matches: Record<string, number | null>;
}

export interface ToolUsage {
  tool: string;
  calls: number;
  /** Calls Claude Code asked you about and you allowed. */
  approved: number;
  /** Calls you refused when asked. */
  refused: number;
}

export interface Approval {
  rule: string;
  approved: number;
  last: string;
}

/** What Claude Code records in ~/.claude.json about this project. */
export interface Trust {
  /** The ~/.claude.json project key: the repository root, or the folder outside git. */
  root: string;
  /** You accepted the workspace trust dialog for it. */
  trusted: boolean;
  /** Outside git: a parent folder you trusted, which covers this one for some things but not grants. */
  inheritedFrom?: string;
  /** In your home directory Claude Code asks every session and saves no answer. */
  sessionOnly: boolean;
  /** Your answer to the dialog about imports from outside the project. */
  externalImports: "approved" | "declined" | "not-asked";
}

export interface Problem {
  path: string;
  error: string;
}

/** Something Claude Code adds to context once Claude reads or edits a file. */
export interface PathMatch {
  kind: "rule" | "skill" | "nested";
  path: string;
  scope: Scope | "plugin";
  /** The `paths` glob that matched; absent for a nested file that loads for any file in its folder. */
  glob?: string;
  /** A skill's name. */
  name?: string;
}

export interface PathTest {
  file: string;
  /** False when the file is outside the start directory, where nothing here applies. */
  inside: boolean;
  exists: boolean;
  matches: PathMatch[];
}

/** Project files that shape Claude Code here, by who can see them. */
export interface Sharing {
  tracked: string[];
  untracked: string[];
  ignored: string[];
}

/** Everything that applies when Claude Code starts in one directory. */
export interface DirectoryView {
  path: string;
  exists: boolean;
  gitRoot: string | null;
  agentsMdMode: AgentsMdMode;
  instructions: Instruction[];
  settings: SettingsLayer[];
  effective: EffectiveSetting[];
  memory: MemoryStore;
  inventory: Inventory;
  context: ContextBlock[];
  permissions: Permission[];
  tools: BuiltinTool[];
  trust: Trust;
  /** Files ccdesk could not read or parse. */
  problems: Problem[];
  /** Null outside a git repository. */
  sharing: Sharing | null;
  /**
   * Filled in by the UI once the transcripts are counted, which the scan does not wait for;
   * null when counting failed.
   */
  usage?: Usage | null;
}

/** Set one top-level key in one settings file; `value` undefined removes the key. */
export interface SettingsEdit {
  dir: string;
  scope: Scope;
  key: string;
  value?: unknown;
}

/** Take one permission rule out of its list and/or add one, in one settings file. */
export interface PermissionEdit {
  dir: string;
  file: string;
  remove?: { list: PermissionList; rule: string };
  add?: { list: PermissionList; rule: string };
}

/** A hook as a HookEdit writes it: the matcher group it goes in, and the hook itself. */
export interface HookPlacement {
  event: string;
  /** Empty or absent for a group without a matcher, which matches everything. */
  matcher?: string;
  definition: unknown;
}

/**
 * One hook change to a settings file. With both, the hook is replaced in place when it stays in
 * the same event and matcher, and moved otherwise.
 */
export interface HookEdit {
  dir: string;
  file: string;
  /** The hook to take out, as the scan showed it; refused when the file no longer has it there. */
  remove?: { event: string; at: { group: number; index: number }; definition: unknown };
  add?: HookPlacement;
}

export interface SettingsEditPreview {
  path: string;
  /** The file as JSON with env and header values hidden; null when the file does not exist yet. */
  before: string | null;
  /** The file after the edit, shown the same way. */
  after: string;
  /** Fingerprint of the file on disk; saving requires it to be unchanged. */
  revision: string;
  /** The file is not laid out as ccdesk writes it (2-space JSON), so saving reformats it. */
  reformats: boolean;
  /** Schema errors; when present nothing can be saved. */
  errors: string[];
  /**
   * For a file ccdesk does not write itself (~/.claude.json): the Claude Code commands it runs
   * instead, with secrets hidden. Such a change is not backed up or listed in Recent changes.
   */
  commands?: string[];
}

/**
 * One MCP server change. Project servers are changed in .mcp.json; user and local ones through
 * `claude mcp`. With both, the server is replaced, keeping its place in .mcp.json.
 */
export interface McpEdit {
  dir: string;
  scope: "user" | "local" | "project";
  /** The server to take out, as the scan showed it; refused when it changed since. */
  remove?: { name: string; definition: unknown };
  add?: { name: string; definition: unknown };
}
