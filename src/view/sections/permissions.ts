import { type Permission, type Usage } from "../../shared/types.ts";
import { suggestedRules } from "../usage.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"permissions">;
export type Suggested = Extract<R, { suggested: true }>;
export type Rule = Extract<Permission, { kind: "rule" }>;

export function isSuggested(row: R): row is Suggested {
  return "suggested" in row;
}

/**
 * An allow rule in effect that covered none of the calls counted here. Ask rules are not flagged:
 * they guard calls, so one that never fired is no reason to remove it.
 */
export function unused(rule: Permission, usage: Usage | null | undefined): rule is Rule {
  return (
    rule.kind === "rule" &&
    rule.list === "allow" &&
    rule.inEffect &&
    !rule.decidedBy &&
    (usage?.sessions ?? 0) > 0 &&
    usage?.matches[rule.rule] === 0
  );
}

const LIST_ORDER = ["deny", "ask", "allow"];

/** Rules in the order Claude Code checks their lists, then other settings, then suggestions. */
function listRank(row: R): number {
  if (isSuggested(row)) return 4;
  return row.item.kind === "rule" ? LIST_ORDER.indexOf(row.item.list) : 3;
}

/** A row as words: its list and rule, or the setting and its value. */
function words(row: R): string {
  if (isSuggested(row)) return `suggested allow ${row.item.rule}`;
  const { item } = row;
  return item.kind === "rule" ? `${item.list} ${item.rule}` : `${item.kind} ${item.value}`;
}

export const permissions = defineSection<R>({
  id: "permissions",
  title: "Permissions",
  rows: (view) => {
    const ids = new Set<string>();
    const set: R[] = view.permissions.map((item) => {
      // Keyed by content so a selection survives a refresh; a repeated entry gets a suffix.
      const base = `perm:${item.scope}:${item.kind === "rule" ? `${item.list}:${item.rule}` : `${item.kind}:${item.value}`}`;
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}#${n}`;
      ids.add(id);
      return { id, section: "permissions", line: item.scope, item };
    });
    const suggested: R[] = suggestedRules(view).map((item) => ({
      id: `perm:suggested:${item.rule}`,
      section: "permissions",
      line: null,
      item,
      suggested: true,
    }));
    return [...set, ...suggested];
  },
  columns: [
    { label: "", sort: (r) => (isSuggested(r) ? "~" : r.item.scope) },
    {
      label: "List",
      sort: listRank,
    },
    {
      label: "Rule",
      sort: (r) => ("rule" in r.item ? r.item.rule : r.item.value),
    },
    { label: "Outcome" },
  ],
  empty: () =>
    "No settings file sets permissions here, so Claude asks before using tools that need it.",
  dimmed: (row) =>
    !isSuggested(row) &&
    (!row.item.inEffect || (row.item.kind === "rule" && row.item.decidedBy !== undefined)),
  text: (row) => `permission ${words(row)}`,
  label: words,
  heading: (row) => {
    if ("rule" in row.item) return row.item.rule;
    return row.item.kind === "defaultMode" ? "Default permission mode" : "Extra folder";
  },
  facet: {
    label: "Filter permissions by list",
    of: (row) => {
      if (isSuggested(row)) return "suggested";
      return row.item.kind === "rule" ? row.item.list : "other";
    },
    order: () => ["deny", "ask", "allow", "other", "suggested"],
  },
});
