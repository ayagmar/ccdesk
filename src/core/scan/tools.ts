import table from "../../shared/builtin-tools.json" with { type: "json" };
import {
  type BuiltinTool,
  type Hook,
  type Permission,
  type PermissionList,
  type ToolRule,
} from "../../shared/types.ts";
import { wildcard } from "./files.ts";
import { CHECK_ORDER } from "./permissions.ts";

/**
 * The other tools a rule for some uses covers: Bash rules apply to Monitor, Claude Code checks file
 * paths against Edit and Read rules only, and a Read deny also blocks Edit and Write on that path
 * (docs: tools-reference#configure-tools-with-permission-rules-and-hooks, permissions#read-and-edit).
 */
function coveredTools(tool: string, list: PermissionList): string[] {
  if (tool === "Bash") return ["Bash", "Monitor"];
  if (tool === "Edit") return ["Edit", "Write", "NotebookEdit"];
  if (tool === "Read")
    return list === "deny"
      ? ["Read", "Grep", "Glob", "LSP", "Edit", "Write"]
      : ["Read", "Grep", "Glob", "LSP"];
  return [];
}

/** Path rules Claude Code accepts but never consults; Edit and Read rules do the job instead. */
const UNCHECKED_PATH_RULE_TOOLS = new Set(["Write", "NotebookEdit", "Glob", "MultiEdit"]);

/**
 * No deny or ask rule and no PreToolUse hook applies to it while any other tool remains
 * (docs: tools-reference#endconversation-tool-behavior).
 */
const EXEMPT = "EndConversation";

/** `Tool` or `Tool(specifier)`; `Tool(*)` names the whole tool too (docs: permissions#permission-rule-syntax). */
export function parseRule(rule: string): { tool: string; specifier: string | null } {
  const open = rule.indexOf("(");
  if (open === -1 || !rule.endsWith(")")) return { tool: rule.trim(), specifier: null };
  const specifier = rule.slice(open + 1, -1);
  return { tool: rule.slice(0, open).trim(), specifier: specifier === "*" ? null : specifier };
}

/** Deny and ask rules may glob the tool name; allow rules name it exactly (docs: permissions#tool-name-wildcards). */
export function namesTool(list: PermissionList, tool: string, name: string): boolean {
  return list === "allow" || !tool.includes("*") ? tool === name : wildcard(tool).test(name);
}

/** A hook matcher, evaluated as the docs describe (docs: hooks#matcher-patterns). */
function matcherCovers(matcher: string | undefined, name: string): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (/^[\w\s,|-]+$/.test(matcher))
    return matcher.split(/[|,]/).some((part) => part.trim() === name);
  try {
    return new RegExp(matcher).test(name);
  } catch {
    return false;
  }
}

/**
 * The rules about one tool: `whole` name the tool itself and decide it, `scoped` apply to some of
 * its calls only. EndConversation ignores rules (see builtinTools).
 */
function rulesFor(name: string, rules: ToolRule[]): { whole: ToolRule[]; scoped: ToolRule[] } {
  const whole: ToolRule[] = [];
  const scoped: ToolRule[] = [];
  if (name === EXEMPT) return { whole, scoped };
  for (const r of rules) {
    const { tool, specifier } = parseRule(r.rule);
    if (specifier === null) {
      if (namesTool(r.list, tool, name)) whole.push(r);
      // Monitor's commands follow the Bash rules; its WebSocket watches do not
      // (docs: tools-reference#monitor-tool).
      else if (name === "Monitor" && namesTool(r.list, tool, "Bash")) scoped.push(r);
    } else if (tool === name && UNCHECKED_PATH_RULE_TOOLS.has(tool)) {
      scoped.push({ ...r, unchecked: true });
    } else if (tool === name || coveredTools(tool, r.list).includes(name)) scoped.push(r);
  }
  return { whole, scoped };
}

/** Every built-in tool, with the rules and hooks that apply to it here. */
export function builtinTools(permissions: Permission[], hooks: Hook[]): BuiltinTool[] {
  const rules: ToolRule[] = permissions.flatMap((p) =>
    p.kind === "rule" && p.inEffect ? [{ list: p.list, rule: p.rule, scope: p.scope }] : []
  );
  const preToolUse = hooks.filter((h) => h.active && h.event === "PreToolUse");
  const tools = table.tools.map(({ name, description, asks }) => {
    const { whole, scoped } = rulesFor(name, rules);
    const decidedBy = CHECK_ORDER.map((list) => whole.find((r) => r.list === list)).find(Boolean);
    const tool: BuiltinTool = {
      name,
      description,
      asks,
      verdict: decidedBy
        ? ({ deny: "denied", ask: "asks", allow: "allowed" } as const)[decidedBy.list]
        : "default",
      scoped: scoped.sort((a, b) => CHECK_ORDER.indexOf(a.list) - CHECK_ORDER.indexOf(b.list)),
      hooks: name === EXEMPT ? 0 : preToolUse.filter((h) => matcherCovers(h.matcher, name)).length,
    };
    if (decidedBy) tool.decidedBy = decidedBy;
    const removedBy = whole.filter((r) => r.list === "deny");
    if (removedBy.length > 0) tool.removedBy = removedBy;
    return tool;
  });
  // EndConversation ignores rules while any other tool remains. When deny rules remove every other
  // tool and match it too, as "*" does, it goes as well, unless an allow rule names it.
  const exempt = tools.find((t) => t.name === EXEMPT);
  const othersGone = tools.every((t) => t.name === EXEMPT || t.verdict === "denied");
  const denies = rules.filter((r) => {
    const { tool, specifier } = parseRule(r.rule);
    return r.list === "deny" && specifier === null && namesTool("deny", tool, EXEMPT);
  });
  const kept = rules.some((r) => r.list === "allow" && r.rule === EXEMPT);
  if (exempt && othersGone && denies[0] && !kept) {
    exempt.verdict = "denied";
    exempt.decidedBy = denies[0];
    exempt.removedBy = denies;
  }
  return tools;
}
