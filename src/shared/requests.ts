// What each API request sends, as JSON Schema. The server checks bodies against these, and each
// type is read from its schema. The page imports only the types, re-exported from types.ts, so
// TypeBox stays out of its bundle.
import { type Static, Type } from "typebox";
import { EVERY_FILE, PERMISSION_LISTS } from "./scopes.ts";

/** Set one top-level key in one settings file; `value` undefined removes the key. */
export const SettingsEditBody = Type.Object({
  dir: Type.String(),
  scope: Type.Enum(EVERY_FILE),
  key: Type.String(),
  value: Type.Optional(Type.Unknown()),
});
export type SettingsEdit = Static<typeof SettingsEditBody>;

/** One permission rule. */
const Rule = Type.Object({ list: Type.Enum(PERMISSION_LISTS), rule: Type.String() });

/** Take one permission rule out of its list and/or add one, in one settings file. */
export const PermissionEditBody = Type.Object({
  dir: Type.String(),
  file: Type.String(),
  remove: Type.Optional(Rule),
  add: Type.Optional(Rule),
});
export type PermissionEdit = Static<typeof PermissionEditBody>;

const place = Type.Integer({ minimum: 0 });

/**
 * One hook change to a settings file. With both, the hook is replaced in place when it stays in
 * the same event and matcher, and moved otherwise.
 */
export const HookEditBody = Type.Object({
  dir: Type.String(),
  file: Type.String(),
  /** The hook to take out, as the scan showed it; refused when the file no longer has it there. */
  remove: Type.Optional(
    Type.Object({
      event: Type.String(),
      at: Type.Object({ group: place, index: place }),
      definition: Type.Unknown(),
    })
  ),
  /** The hook to write: the matcher group it goes in, and the hook itself. */
  add: Type.Optional(
    Type.Object({
      event: Type.String(),
      /** Empty or absent for a group without a matcher, which matches everything. */
      matcher: Type.Optional(Type.String()),
      definition: Type.Unknown(),
    })
  ),
});
export type HookEdit = Static<typeof HookEditBody>;

/** One subagent file change: a new agent, a changed one, or one deleted. */
export const AgentEditBody = Type.Object({
  dir: Type.String(),
  /** An agent the scan shows here; absent when creating one. */
  path: Type.Optional(Type.String()),
  /** Where a new agent goes, and its file name without .md. */
  create: Type.Optional(
    Type.Object({ scope: Type.Enum(["user", "project"]), file: Type.String() })
  ),
  /** The whole file; null deletes the agent. */
  text: Type.Union([Type.String(), Type.Null()]),
});
export type AgentEdit = Static<typeof AgentEditBody>;

/**
 * One MCP server change. Project servers are changed in .mcp.json; user and local ones through
 * `claude mcp`. With both, the server is replaced, keeping its place in .mcp.json.
 */
export const McpEditBody = Type.Object({
  dir: Type.String(),
  scope: Type.Enum(["user", "local", "project"]),
  /** The server to take out, as the scan showed it; refused when it changed since. */
  remove: Type.Optional(Type.Object({ name: Type.String(), definition: Type.Unknown() })),
  add: Type.Optional(Type.Object({ name: Type.String(), definition: Type.Unknown() })),
});
export type McpEdit = Static<typeof McpEditBody>;

/** A save's or restore's revision: the one its preview returned. */
export const RevisionBody = Type.Object({ revision: Type.String() });

/** Count which permission rules the transcripts under `path` used. */
export const UsageBody = Type.Object({ path: Type.String(), rules: Type.Array(Rule) });

/**
 * Preview a memory change; changing it also sends the revision, and the directory the store is
 * saved for so Recent changes can name it.
 */
export const MemoryBody = Type.Object({
  action: Type.String(),
  path: Type.String(),
  projectPath: Type.Optional(Type.String()),
});

export const OpenBody = Type.Object({ path: Type.String() });

/** Preview restoring a backup; restoring it also sends the revision. */
export const BackupBody = Type.Object({ id: Type.String() });
