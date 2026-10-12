import scopeTable from "./settings-scopes.json" with { type: "json" };
import { type PermissionList, type Scope } from "./types.ts";

export const EVERY_FILE: Scope[] = ["user", "project", "local", "managed"];

/** Settings files by precedence: managed beats local beats project beats user. */
export const HIGHEST_FIRST: Scope[] = ["managed", "local", "project", "user"];

/** The settings files ccdesk writes to; managed settings belong to your organisation. */
export const EDITABLE_SCOPES: Scope[] = ["user", "project", "local"];

/** The permission lists, in the order ccdesk shows them. */
export const PERMISSION_LISTS: PermissionList[] = ["allow", "ask", "deny"];

/** Keys Claude Code reads only from some files, from the settings index (`pnpm scopes`). */
const SCOPE_LIMITED_KEYS = scopeTable.limited as Record<string, Scope[]>;

export function allowedScopes(key: string): Scope[] {
  return Object.hasOwn(SCOPE_LIMITED_KEYS, key) ? (SCOPE_LIMITED_KEYS[key] as Scope[]) : EVERY_FILE;
}

export function ignoredReason(key: string): string {
  const allowed = allowedScopes(key);
  if (allowed.length === 0)
    return "Claude Code reads this key from ~/.claude.json, not from settings files";
  return `Claude Code reads this key only from ${allowed.join(" or ")} settings`;
}
