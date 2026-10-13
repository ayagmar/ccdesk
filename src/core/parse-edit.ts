import { Compile } from "typebox/compile";
import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import {
  AgentEditBody,
  HookEditBody,
  McpEditBody,
  PermissionEditBody,
  SettingsEditBody,
} from "../shared/requests.ts";
import {
  type AgentEdit,
  type HookEdit,
  type McpEdit,
  type PermissionEdit,
  type SettingsEdit,
} from "../shared/types.ts";
import { isRecord } from "./scan/data.ts";
import { firstError } from "./schema.ts";

/**
 * An edit that is not well formed, such as an unknown scope or a missing field: the caller sent
 * something no review could have produced. The edit modules trust the edits these parsers return.
 */
export class InvalidEditError extends Error {}

const settingsEdit = Compile(SettingsEditBody);
const permissionEdit = Compile(PermissionEditBody);
const hookEdit = Compile(HookEditBody);
const agentEdit = Compile(AgentEditBody);
const mcpEdit = Compile(McpEditBody);

export function parseSettingsEdit(body: unknown): SettingsEdit {
  if (!settingsEdit.Check(body)) throw new InvalidEditError(firstError(settingsEdit, body));
  return body;
}

export function parsePermissionEdit(body: unknown): PermissionEdit {
  if (!permissionEdit.Check(body)) throw new InvalidEditError(firstError(permissionEdit, body));
  if (!body.remove && !body.add) throw new InvalidEditError("remove or add is required");
  if (body.remove?.rule.trim() === "" || body.add?.rule.trim() === "")
    throw new InvalidEditError("a rule needs a list (allow, ask or deny) and text");
  return body;
}

export function parseHookEdit(body: unknown): HookEdit {
  if (!hookEdit.Check(body)) throw new InvalidEditError(firstError(hookEdit, body));
  if (!body.remove && !body.add) throw new InvalidEditError("remove or add is required");
  if (body.add) {
    if (!HOOK_EVENTS.includes(body.add.event))
      throw new InvalidEditError(`${body.add.event} is not a hook event Claude Code knows`);
    if (!isRecord(body.add.definition)) throw new InvalidEditError("a hook must be a JSON object");
  }
  return body;
}

export function parseAgentEdit(body: unknown): AgentEdit {
  if (!agentEdit.Check(body)) throw new InvalidEditError(firstError(agentEdit, body));
  if (body.path !== undefined) return body;
  if (!body.create) throw new InvalidEditError("path or create is required");
  if (body.text === null) throw new InvalidEditError("a new agent needs its text");
  return body;
}

export function parseMcpEdit(body: unknown): McpEdit {
  if (!mcpEdit.Check(body)) throw new InvalidEditError(firstError(mcpEdit, body));
  if (!body.remove && !body.add) throw new InvalidEditError("remove or add is required");
  if (body.add && !isRecord(body.add.definition))
    throw new InvalidEditError("a server must be a JSON object");
  return body;
}
