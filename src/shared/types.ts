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
  /** Not loaded: matched by claudeMdExcludes, or not a text file. */
  skipped?: "excluded" | "not-text";
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
  /** Entries Claude Code may skip while the rest of the file applies. */
  warning?: string;
  /** For managed settings: a file that is not a JSON object or fails to read, so Claude Code refuses to start. */
  blocksStart?: boolean;
  /**
   * For managed settings: managed sources that rank above these files and that ccdesk does not
   * read, such as the server-managed settings cache, a macOS configuration profile or the HKLM
   * registry key.
   */
  higherSources?: string[];
  /** For managed settings: the HKCU registry key, when it holds a policy ccdesk does not read. */
  lowerSources?: string[];
  /** For managed settings: entries that fail validation, which `data` holds as Claude Code reads them. */
  repairs?: ManagedRepair[];
}

/** A managed settings entry Claude Code reads other than as written. */
export interface ManagedRepair {
  /** Where it is, such as `sandbox.network.allowedDomains`. */
  field: string;
  /** The entry as written, nested under its field, with secrets hidden. */
  written: unknown;
  /** What Claude Code does with it. */
  note: string;
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
  ignored: Array<{
    scope: Scope;
    value: unknown;
    reason: string;
    waitsForTrust?: boolean;
    /** Ignored because of a value in another file, such as a managed lock, not the file it is in. */
    overruled?: boolean;
  }>;
  /** How this key resolves when that differs from plain precedence. */
  note?: string;
}

/** The kinds of change ccdesk records, one per kind of file it changes. */
export const BACKUP_KINDS = [
  "settings",
  "mcp",
  "agent",
  "memory-index",
  "memory-delete",
  "memory-restore",
  // A user or local MCP server change made through `claude mcp`, which ccdesk cannot undo.
  "mcp-claude",
  // A directory whose folder is gone, its store moved into the backup folder.
  "directory-forget",
] as const;

export type BackupKind = (typeof BACKUP_KINDS)[number];

/** One change ccdesk made, from its backup folder. */
export interface BackupSummary {
  id: string;
  kind: BackupKind;
  /** The file that was changed (for a deleted memory: the memory file). */
  target: string;
  createdAt: string;
  /** The change created the file, so restoring it removes the file. */
  created: boolean;
  /** The change was interrupted or failed halfway; the backup still holds the earlier text. */
  incomplete?: boolean;
  /**
   * For a memory change: the directory its store is saved for, when ccdesk recorded it. For a
   * forgotten directory: that directory.
   */
  projectPath?: string;
}

/** What one change in Recent changes did to its file, shown as the page shows files. */
export interface ChangeView {
  id: string;
  kind: BackupKind;
  target: string;
  /** The file before the change; null when the change created it. */
  before: string | null;
  /**
   * The file right after the change; null when the change deleted it. Absent when ccdesk cannot
   * know it: the file changed outside ccdesk since, and no later backup holds that text.
   */
  after?: string | null;
  /** For a deleted memory: the lines taken out of MEMORY.md with it. */
  removedIndexLines?: string[];
}

/** A change ccdesk made; Recent changes lists it under `id` and can undo it. */
export interface Change {
  id: string;
  target: string;
  /** The file's revision right after the change, which an undo requires. */
  revision: string;
  /** The change created the file, so there is nothing to undo it to. */
  created: boolean;
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

/**
 * What forgetting a directory whose folder is gone would take away, reviewed before anything moves.
 * Its store moves into the change's backup folder, so Recent changes can move it back.
 */
export interface ForgetPreview {
  /** The directory. */
  path: string;
  /** Its store folder under `<Claude folder>/projects`: sessions and auto memory. */
  store: string;
  sessions: number;
  memories: number;
  /** The size of everything in the store. */
  bytes: number;
  /**
   * `~/.claude.json` has an entry for the directory (its trust answer, local MCP servers). ccdesk
   * does not change that file, so the entry stays; with no store left the directory is not listed.
   */
  claudeJsonEntry: boolean;
  /**
   * A session was written in the last few minutes, so Claude Code may still be running in the
   * deleted folder; its next message would start a new store of the same name.
   */
  recentlyActive: boolean;
  /** Fingerprint of the store as reviewed; forgetting requires it unchanged. */
  revision: string;
}

/** What restoring a backup would change, shown as a diff before anything is written. */
export interface RestorePreview {
  id: string;
  kind: BackupKind;
  target: string;
  /** The file now; null when it does not exist. Settings are shown with secrets hidden. */
  before: string | null;
  /** The file as the backup holds it; empty when the restore removes the file. */
  after: string;
  /** Fingerprint of the file now (and of MEMORY.md, for a deleted memory); restoring requires it unchanged. */
  revision: string;
  /** The change created the file, so restoring removes it. */
  removes?: boolean;
  /** Why this backup cannot be restored right now. */
  blocked?: string;
  /**
   * The folder the restore creates again because it no longer exists, such as a deleted project
   * folder: the outermost one missing above the file.
   */
  createsFolder?: string;
  /** For a deleted memory: the lines put back into MEMORY.md. */
  indexLines?: string[];
  /**
   * For a forgotten directory: the store folder the restore moves back. `after` then says what it
   * holds, and `before` is null.
   */
  movesBack?: string;
  /**
   * For a change made through `claude mcp`, which ccdesk cannot undo: the commands that put it
   * back, values hidden. `before` and `after` are then the servers before and after the change.
   */
  undoCommands?: string[];
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
  /** A subagent, skill or command whose name a definition Claude Code prefers also uses: that file. */
  shadowedBy?: string;
  /**
   * Why Claude Code does not load it: a subagent file whose frontmatter falls short, or an entry
   * from your or the project's files that managed settings keep to plugins.
   */
  skipped?: string;
  /**
   * The name Claude Code calls it by when that is not `name`: a plugin's entries are prefixed with
   * the plugin, as in `my-plugin:review` or the subagent `my-plugin:review:security`.
   */
  id?: string;
  /** A skill synced from your claude.ai account into `~/.claude/skills/synced`. */
  synced?: true;
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
  /** False when disableAllHooks or allowManagedHooksOnly turns it off, or it waits for workspace trust. */
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

/** A setting or saved answer that approves or rejects a .mcp.json server. */
export interface McpApproval {
  key: "enableAllProjectMcpServers" | "enabledMcpjsonServers" | "disabledMcpjsonServers";
  /** A settings file, or your answers to Claude Code's prompt in ~/.claude.json. */
  source: Scope | "claude-json";
  path: string;
  /** False for an approval from repository settings that waits until the folder is trusted. */
  counts: boolean;
}

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
  /** For a .mcp.json server, every setting or saved answer that names it, highest file first. */
  approvals?: McpApproval[];
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
  /** Where it comes from; null for Claude Code's own part, or a listing gathered from several places. */
  scope: Scope | "memory" | "plugin" | null;
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
  /** For each memory file asked about, by its path, how often Claude read it. */
  memories: Record<string, MemoryReads>;
}

/** Read calls on one memory file. */
export interface MemoryReads {
  reads: number;
  /** When it was last read; null when it never was. */
  last: string | null;
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
  /** Claude Code refuses to start until this file is fixed, rather than skipping it. */
  blocksStart?: boolean;
  /** Only some entries are affected; the rest of the file applies. */
  partial?: boolean;
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
/**
 * The kind of session ccdesk describes: an interactive `claude`, or `claude -p` and the Agent SDK,
 * which never show the trust dialog.
 */
export type SessionProfile = "interactive" | "print";

export const SESSION_PROFILES: SessionProfile[] = ["interactive", "print"];

export interface DirectoryView {
  path: string;
  profile: SessionProfile;
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

// The edits a front end sends, each read from its schema.
export type {
  AgentEdit,
  HookEdit,
  McpEdit,
  PermissionEdit,
  SettingsEdit,
} from "./requests.ts";

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
  /** Why the edit cannot be saved, such as schema errors; when present nothing can be saved. */
  errors: string[];
  /**
   * For a file ccdesk does not write itself (~/.claude.json): the Claude Code commands it runs
   * instead, with secrets hidden. Such a change is listed in Recent changes with the commands that
   * reverse it, but is not backed up and cannot be undone from ccdesk.
   */
  commands?: string[];
}

/** A setting's entry in Claude Code's settings schema, as far as the editor reads it. */
export interface SettingSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: SettingSchema;
  anyOf?: SettingSchema[];
  properties?: Record<string, SettingSchema>;
  required?: string[];
  additionalProperties?: boolean | SettingSchema;
  description?: string;
  deprecated?: boolean;
  /** Set on a key whose schema comes from SchemaStore, saying so. */
  $comment?: string;
}

/** A setting as Claude Code's settings reference documents it. */
export interface CatalogSetting {
  key: string;
  summary: string;
  category: string;
  /** The files Claude Code reads it from; none for a key kept in ~/.claude.json. */
  scopes: Scope[];
  about?: string;
  type?: string;
  default?: string;
  docs: string;
}

/** The Claude Code data the page edits against, generated into src/shared and served once. */
export interface Reference {
  /** Where the settings schema came from, such as the SDK version. */
  schemaSource: string;
  /** The settings schema's top-level keys. */
  settings: Record<string, SettingSchema>;
  /** Every documented setting, in the order the settings reference lists them. */
  catalog: CatalogSetting[];
  hookEvents: string[];
}
