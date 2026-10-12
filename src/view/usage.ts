import { type DirectoryView, type Usage } from "../shared/types.ts";
import { plural } from "./format.ts";

/** "the 12 sessions started in this repository since 3 Oct", for sentences about counted calls. */
export function sessionsHere(usage: Usage): string {
  const since = usage.since
    ? ` since ${new Date(usage.since).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
    : "";
  const where = usage.repository ? "in this repository" : "here";
  return `${usage.sessions === 1 ? "the session" : `the ${plural(usage.sessions, "session")}`} started ${where}${since}`;
}

/**
 * Suggested allow rules, most approved first. The server leaves out rules that would change
 * nothing; this also drops one saved since the counts were taken, until they are taken again.
 */
export function suggestedRules(view: DirectoryView): Usage["approvals"] {
  const decided = new Set(
    view.permissions.flatMap((p) => (p.kind === "rule" && p.inEffect ? [p.rule] : []))
  );
  return (view.usage?.approvals ?? []).filter((a) => !decided.has(a.rule));
}
