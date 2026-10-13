import { stat } from "node:fs/promises";
import { Compile, type Validator } from "typebox/compile";
import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import { allowedScopes, ignoredReason } from "../shared/scopes.ts";
import schema from "../shared/settings.schema.json" with { type: "json" };
import {
  type Change,
  type HookEdit,
  type PermissionEdit,
  type Scope,
  type SettingsEdit,
  type SettingsEditPreview,
} from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { revisionOf } from "./scan/files.ts";
import { isRecord } from "./scan/data.ts";
import { isSkippedMcpRule } from "./scan/permissions.ts";
import { type SettingsFile, settingsFiles } from "./scan/settings.ts";
import { schemaErrors } from "./schema.ts";
import { hasHiddenValues, jsonSyntaxError, redactSecrets, shown } from "./secrets.ts";
import {
  RefusedError,
  readIfExists,
  recordChange,
  type Serially,
  serially,
  writeAtomic,
} from "./write.ts";

const properties: Record<string, object> = schema.definitions.ClaudeCodeSettings.properties;
const validators = new Map<string, Validator>();

function validatorFor(key: string): Validator | null {
  if (!Object.hasOwn(properties, key)) return null;
  let validate = validators.get(key);
  if (!validate) {
    validate = Compile(properties[key] as object);
    validators.set(key, validate);
  }
  return validate;
}

interface PlannedEdit {
  path: string;
  scope: Scope;
  raw: string | null;
  /** The text ccdesk would write; null when the value failed validation. */
  next: string | null;
  preview: SettingsEditPreview;
}

async function editableFile(
  env: ScanEnv,
  dir: string,
  pick: (file: SettingsFile) => boolean,
  missing = "That is not a settings file Claude Code reads here."
): Promise<SettingsFile> {
  const file = (await settingsFiles(env, dir)).find(pick);
  if (!file) throw new RefusedError(missing);
  if (file.scope === "managed")
    throw new RefusedError("Managed settings are set by your organisation.");
  if (file.scope !== "user" && !(await stat(dir).catch(() => null))?.isDirectory())
    throw new RefusedError(`${dir} is not a directory on this machine.`);
  return file;
}

async function readSettings(
  env: ScanEnv,
  path: string
): Promise<{ raw: string | null; data: Record<string, unknown> }> {
  const raw = await readIfExists(env, path);
  if (raw === null || raw.trim() === "") return { raw, data: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RefusedError(`${path} is ${jsonSyntaxError(error)}; fix it by hand first.`);
  }
  if (!isRecord(parsed)) throw new RefusedError(`${path} does not hold a JSON object.`);
  return { raw, data: parsed };
}

/**
 * Works out the file change that sets or removes one key, refusing what ccdesk cannot do safely.
 * `checksHiddenValues` is for a key whose edit checks the part it changes itself, so values it
 * leaves alone are written back exactly as they were.
 */
async function planKey(
  env: ScanEnv,
  file: SettingsFile,
  key: string,
  value: (data: Record<string, unknown>) => unknown,
  checksHiddenValues = false
): Promise<PlannedEdit> {
  if (!allowedScopes(key).includes(file.scope))
    throw new RefusedError(`${ignoredReason(key)}, so a ${file.scope} value would do nothing.`);
  const validate = validatorFor(key);
  if (!validate)
    throw new RefusedError(`${key} is not in Claude Code's settings schema (${schema.$comment}).`);

  const { path } = file;
  const { raw, data } = await readSettings(env, path);
  const nextValue = value(data);
  // ccdesk never shows hidden values, so it must not write them either.
  if (
    !checksHiddenValues &&
    (hasHiddenValues({ [key]: data[key] }) || hasHiddenValues({ [key]: nextValue }))
  )
    throw new RefusedError(`${key} holds hidden values; edit it in the file instead.`);
  if (raw !== null && JSON.stringify(nextValue) === JSON.stringify(data[key]))
    throw new RefusedError("This file already says that; there is nothing to change.");

  const before = raw === null ? null : shown(data);
  // The diff is rendered from the parsed file, so a file in another layout is reported as
  // reformatted instead of diffing its raw text.
  const reformats =
    raw !== null && raw.trim() !== "" && raw !== `${JSON.stringify(data, null, 2)}\n`;
  const base = { path, before, revision: revisionOf(raw), reformats };
  const errors =
    nextValue === undefined
      ? []
      : [...schemaErrors(validate, nextValue, key), ...newHookEvents(key, data[key], nextValue)];
  if (errors.length > 0)
    return {
      path,
      scope: file.scope,
      raw,
      next: null,
      preview: { ...base, after: before ?? "", errors },
    };
  const next = { ...data };
  if (nextValue === undefined) delete next[key];
  else next[key] = nextValue;
  return {
    path,
    scope: file.scope,
    raw,
    next: `${JSON.stringify(next, null, 2)}\n`,
    preview: { ...base, after: shown(next), errors: [] },
  };
}

async function planSettingsEdit(env: ScanEnv, edit: SettingsEdit): Promise<PlannedEdit> {
  const file = await editableFile(
    env,
    edit.dir,
    (f) => f.scope === edit.scope && !f.legacy,
    edit.scope === "project"
      ? "In your home directory this file is your user settings; edit it as User."
      : undefined
  );
  return planKey(env, file, edit.key, () => edit.value);
}

/** One rule taken out of its list and/or added to another, applied to the file as it is on disk. */
async function planPermissionEdit(env: ScanEnv, edit: PermissionEdit): Promise<PlannedEdit> {
  const file = await editableFile(env, edit.dir, (f) => f.path === edit.file);
  return planKey(env, file, "permissions", (data) => {
    const permissions = isRecord(data.permissions) ? { ...data.permissions } : {};
    const { remove, add } = edit;
    if (remove) {
      const list = Array.isArray(permissions[remove.list])
        ? (permissions[remove.list] as unknown[])
        : [];
      if (!list.includes(remove.rule))
        throw new RefusedError(`${remove.rule} is no longer in ${remove.list} in this file.`);
      const kept = list.filter((r) => r !== remove.rule);
      if (kept.length > 0) permissions[remove.list] = kept;
      else delete permissions[remove.list];
    }
    if (add) {
      if (isSkippedMcpRule(add.rule))
        throw new RefusedError(
          "Claude Code skips an MCP rule with parentheses in a settings file. To match a parameter of an MCP tool, pass a deny rule with --disallowedTools."
        );
      const list = Array.isArray(permissions[add.list]) ? (permissions[add.list] as unknown[]) : [];
      if (!list.includes(add.rule)) permissions[add.list] = [...list, add.rule];
    }
    return Object.keys(permissions).length > 0 ? permissions : undefined;
  });
}

/**
 * Hook events an edit brings in that Claude Code does not know, which the schema allows. Ones the
 * file already has stay, so a file written for another Claude Code version can still be edited.
 */
function newHookEvents(key: string, before: unknown, after: unknown): string[] {
  if (key !== "hooks" || !isRecord(after)) return [];
  const had = isRecord(before) ? Object.keys(before) : [];
  return Object.keys(after)
    .filter((event) => !HOOK_EVENTS.includes(event) && !had.includes(event))
    .map((event) => `${event} is not a hook event Claude Code knows.`);
}

/** The matcher a group is written with; a missing or empty one matches everything. */
function matcherOf(group: unknown): string {
  return isRecord(group) && typeof group.matcher === "string" ? group.matcher : "";
}

/** One hook taken out, replaced or added, applied to the file as it is on disk. */
async function planHookEdit(env: ScanEnv, edit: HookEdit): Promise<PlannedEdit> {
  const file = await editableFile(env, edit.dir, (f) => f.path === edit.file);
  return planKey(
    env,
    file,
    "hooks",
    (data) => {
      const hooks: Record<string, unknown> = isRecord(data.hooks)
        ? structuredClone(data.hooks)
        : {};
      const groupsOf = (event: string): unknown[] => {
        const groups = hooks[event];
        return Array.isArray(groups) ? groups : [];
      };
      const { remove, add } = edit;
      // Checked before any branch, so neither a new hook nor a replacement writes them.
      if (add && hasHiddenValues(add.definition))
        throw new RefusedError(
          "ccdesk does not write header values it would then hide; add this hook in the file instead."
        );
      if (remove) {
        const groups = groupsOf(remove.event);
        const group = groups[remove.at.group];
        const list = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : null;
        const hook = list?.[remove.at.index];
        if (!list || JSON.stringify(redactSecrets(hook)) !== JSON.stringify(remove.definition))
          throw new RefusedError(
            "This hook changed in the file since ccdesk read it; review it again."
          );
        // The page saw this hook with its header values hidden, so a changed copy would lose them.
        if (add && hasHiddenValues(hook))
          throw new RefusedError(
            "This hook sends header values ccdesk does not show; edit it in the file, or remove it and add it again."
          );
        const matcher = add?.matcher ?? "";
        // A hook alone in its group keeps the group when only its matcher changes, unless another
        // group already has that matcher.
        const inPlace =
          add?.event === remove.event &&
          (matcher === matcherOf(group) ||
            (list.length === 1 && !groups.some((g) => g !== group && matcherOf(g) === matcher)));
        if (add && inPlace && isRecord(group)) {
          list[remove.at.index] = add.definition;
          if (matcher) group.matcher = matcher;
          else delete group.matcher;
          return hooks;
        }
        list.splice(remove.at.index, 1);
        if (list.length === 0) groups.splice(remove.at.group, 1);
        if (groups.length === 0 && add?.event !== remove.event) delete hooks[remove.event];
      }
      if (add) {
        const groups = groupsOf(add.event);
        const matcher = add.matcher ?? "";
        const group = groups.find(
          (g) => matcherOf(g) === matcher && isRecord(g) && Array.isArray(g.hooks)
        );
        if (isRecord(group) && Array.isArray(group.hooks)) group.hooks.push(add.definition);
        else groups.push({ ...(matcher ? { matcher } : {}), hooks: [add.definition] });
        hooks[add.event] = groups;
      }
      return Object.keys(hooks).length > 0 ? hooks : undefined;
    },
    true
  );
}

/** Writes a planned edit, but only if the file is still the revision the preview was made from. */
async function commit(env: ScanEnv, plan: PlannedEdit, expectedRevision: string): Promise<Change> {
  if (plan.next === null) throw new RefusedError(plan.preview.errors.join("; "));
  if (plan.preview.revision !== expectedRevision)
    throw new RefusedError("The file changed since you reviewed this edit; review it again.");
  const next = plan.next;
  return recordChange(env, { kind: "settings", target: plan.path, before: plan.raw }, async () => {
    await writeAtomic(env, plan.path, next, expectedRevision);
    return { target: plan.path, revision: revisionOf(next) };
  });
}

export async function previewSettingsEdit(
  env: ScanEnv,
  edit: SettingsEdit
): Promise<SettingsEditPreview> {
  return (await planSettingsEdit(env, edit)).preview;
}

export function saveSettingsEdit(
  env: ScanEnv,
  edit: SettingsEdit,
  expectedRevision: string,
  queue: Serially = serially
): Promise<Change> {
  return queue(async () => commit(env, await planSettingsEdit(env, edit), expectedRevision));
}

export async function previewPermissionEdit(
  env: ScanEnv,
  edit: PermissionEdit
): Promise<SettingsEditPreview> {
  return (await planPermissionEdit(env, edit)).preview;
}

export function savePermissionEdit(
  env: ScanEnv,
  edit: PermissionEdit,
  expectedRevision: string,
  queue: Serially = serially
): Promise<Change> {
  return queue(async () => commit(env, await planPermissionEdit(env, edit), expectedRevision));
}

export async function previewHookEdit(env: ScanEnv, edit: HookEdit): Promise<SettingsEditPreview> {
  return (await planHookEdit(env, edit)).preview;
}

export function saveHookEdit(
  env: ScanEnv,
  edit: HookEdit,
  expectedRevision: string,
  queue: Serially = serially
): Promise<Change> {
  return queue(async () => commit(env, await planHookEdit(env, edit), expectedRevision));
}
