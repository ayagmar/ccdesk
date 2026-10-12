import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import { EVERY_FILE, PERMISSION_LISTS } from "../shared/scopes.ts";
import {
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type PermissionEdit,
  type PermissionList,
  type Scope,
  type SettingsEdit,
} from "../shared/types.ts";
import { isRecord } from "./scan/data.ts";

/**
 * An edit that is not well formed, such as an unknown scope or a missing field: the caller sent
 * something no review could have produced. The edit modules trust the edits these parsers return.
 */
export class InvalidEditError extends Error {}

/** The named string fields of an object; anything else is an InvalidEditError. */
export function stringFields<K extends string>(body: unknown, names: K[]): Record<K, string> {
  if (!isRecord(body) || names.some((n) => typeof body[n] !== "string"))
    throw new InvalidEditError(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} required`);
  return body as Record<K, string>;
}

export function parseSettingsEdit(body: unknown): SettingsEdit {
  const { dir, scope, key } = stringFields(body, ["dir", "scope", "key"]);
  if (!EVERY_FILE.includes(scope as Scope)) throw new InvalidEditError("unknown scope");
  const value = (body as Record<string, unknown>).value;
  return { dir, scope: scope as Scope, key, ...(value === undefined ? {} : { value }) };
}

export function parsePermissionEdit(body: unknown): PermissionEdit {
  const { dir, file } = stringFields(body, ["dir", "file"]);
  const rule = (value: unknown) => {
    if (value === undefined) return undefined;
    const { list, rule } = stringFields(value, ["list", "rule"]);
    if (!PERMISSION_LISTS.includes(list as PermissionList) || rule.trim() === "")
      throw new InvalidEditError("a rule needs a list (allow, ask or deny) and text");
    return { list: list as PermissionList, rule };
  };
  const { remove, add } = body as Record<string, unknown>;
  const edit: PermissionEdit = { dir, file };
  const removed = rule(remove);
  const added = rule(add);
  if (removed) edit.remove = removed;
  if (added) edit.add = added;
  if (!removed && !added) throw new InvalidEditError("remove or add is required");
  return edit;
}

export function parseHookEdit(body: unknown): HookEdit {
  const { dir, file } = stringFields(body, ["dir", "file"]);
  const { remove, add } = body as Record<string, unknown>;
  const edit: HookEdit = { dir, file };
  if (remove !== undefined) {
    const { event } = stringFields(remove, ["event"]);
    const { at, definition } = remove as Record<string, unknown>;
    const index = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : -1);
    const group = isRecord(at) ? index(at.group) : -1;
    const hook = isRecord(at) ? index(at.index) : -1;
    if (group < 0 || hook < 0) throw new InvalidEditError("remove needs the hook's place");
    edit.remove = { event, at: { group, index: hook }, definition };
  }
  if (add !== undefined) {
    const { event } = stringFields(add, ["event"]);
    if (!HOOK_EVENTS.includes(event))
      throw new InvalidEditError(`${event} is not a hook event Claude Code knows`);
    const { matcher, definition } = add as Record<string, unknown>;
    if (matcher !== undefined && typeof matcher !== "string")
      throw new InvalidEditError("matcher must be text");
    if (!isRecord(definition)) throw new InvalidEditError("a hook must be a JSON object");
    edit.add = { event, ...(matcher ? { matcher } : {}), definition };
  }
  if (!edit.remove && !edit.add) throw new InvalidEditError("remove or add is required");
  return edit;
}

export function parseAgentEdit(body: unknown): AgentEdit {
  const { dir } = stringFields(body, ["dir"]);
  const { path, create, text } = body as Record<string, unknown>;
  if (text !== null && typeof text !== "string")
    throw new InvalidEditError("text must be the agent file, or null to delete it");
  const edit: AgentEdit = { dir, text };
  if (typeof path === "string") edit.path = path;
  else if (create !== undefined) {
    const { scope, file } = stringFields(create, ["scope", "file"]);
    if (scope !== "user" && scope !== "project")
      throw new InvalidEditError("a new agent goes in user or project scope");
    if (text === null) throw new InvalidEditError("a new agent needs its text");
    edit.create = { scope, file };
  } else throw new InvalidEditError("path or create is required");
  return edit;
}

export function parseMcpEdit(body: unknown): McpEdit {
  const { dir, scope } = stringFields(body, ["dir", "scope"]);
  if (scope !== "user" && scope !== "local" && scope !== "project")
    throw new InvalidEditError("scope must be user, local or project");
  const { remove, add } = body as Record<string, unknown>;
  const edit: McpEdit = { dir, scope };
  if (remove !== undefined) {
    const { name } = stringFields(remove, ["name"]);
    edit.remove = { name, definition: (remove as Record<string, unknown>).definition };
  }
  if (add !== undefined) {
    const { name } = stringFields(add, ["name"]);
    const { definition } = add as Record<string, unknown>;
    if (!isRecord(definition)) throw new InvalidEditError("a server must be a JSON object");
    edit.add = { name, definition };
  }
  if (!edit.remove && !edit.add) throw new InvalidEditError("remove or add is required");
  return edit;
}
