import { type BuiltinTool, type Usage } from "../../shared/types.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"tools">;

/** Calls counted here: undefined while counting, null when the transcripts could not be read. */
export function callsOf(usage: Usage | null | undefined, name: string): number | null | undefined {
  if (!usage) return usage;
  return usage.tools.find((t) => t.tool === name)?.calls ?? 0;
}

/** What happens when Claude wants the tool, in Manual mode. */
export function outcome(tool: BuiltinTool): string {
  switch (tool.verdict) {
    case "denied":
      return "removed";
    case "asks":
      return "asks every time";
    case "allowed":
      return "runs without asking";
    case "default":
      return tool.asks ? "asks first" : "no approval needed";
  }
}

export const tools = defineSection<R>({
  id: "tools",
  title: "Built-in tools",
  short: "Tools",
  rows: (view) =>
    view.tools.map((item) => ({
      id: `tool:${item.name}`,
      section: "tools",
      line: item.decidedBy?.scope ?? null,
      item,
      calls: callsOf(view.usage, item.name),
    })),
  columns: [
    { label: "" },
    { label: "Tool", sort: (r) => r.item.name },
    { label: "Outcome", sort: (r) => outcome(r.item) },
    { label: "Rules and hooks", sort: (r) => r.item.scoped.length + r.item.hooks },
    { label: "Used", sort: (r) => r.calls ?? -1 },
    { label: "Description" },
  ],
  empty: () => "ccdesk has no list of built-in tools.",
  dimmed: (row) => row.item.verdict === "denied",
  text: (row) => `tool ${row.item.name} ${outcome(row.item)} ${row.item.description}`,
  label: (row) => ({ kind: "tool", name: row.item.name }),
  heading: (row) => row.item.name,
  facet: {
    label: "Filter tools by outcome",
    of: (row) => outcome(row.item),
    order: () => [
      "removed",
      "asks every time",
      "asks first",
      "runs without asking",
      "no approval needed",
    ],
  },
});
