import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"instructions">;

export const STATUS = { loaded: "loaded", "on-match": "on match", skipped: "skipped" } as const;

export const instructions = defineSection<R>({
  id: "instructions",
  title: "Instructions",
  rows: (view) =>
    view.instructions.map((item, index) => ({
      id: `ins:${item.path}`,
      section: "instructions",
      line: item.scope,
      item,
      order: index + 1,
    })),
  columns: [
    { label: "#", sort: (r) => r.order },
    { label: "" },
    { label: "File", sort: (r) => r.item.path },
    { label: "Status", sort: (r) => r.item.status },
    { label: "Why" },
    { label: "Lines", sort: (r) => r.item.lines },
    { label: "Visibility", sort: (r) => r.item.visibility ?? "" },
  ],
  empty: () => "No CLAUDE.md, AGENTS.md or rules apply here.",
  dimmed: (row) => row.item.status === "skipped",
  text: (row) => `${row.item.path} ${row.item.reason}`,
  label: (row, { format }) => ({
    kind: "instruction",
    name: format.tilde(row.item.path),
    path: true,
  }),
  // The path exactly as the row shows it: inside the directory relative to it, outside it with ~.
  // In your home folder that makes your user file .claude/CLAUDE.md, as its row says too.
  heading: (row, { format }, view) => format.relativeTo(row.item.path, view.path),
  facet: {
    label: "Filter instructions by status",
    of: (row) => STATUS[row.item.status],
    order: () => Object.values(STATUS),
  },
});
