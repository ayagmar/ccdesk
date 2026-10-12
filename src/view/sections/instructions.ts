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
  label: (row, { format }) => format.tilde(row.item.path),
  // The file and its folder, or the whole ~ path when that is as short: ~/.claude/CLAUDE.md is
  // your user file, while .claude/CLAUDE.md would read as the project's.
  heading: (row, { format }) => {
    const short = format.tilde(row.item.path);
    const parts = short.split(/[/\\]/);
    return parts.length <= 3 ? short : parts.slice(-2).join("/");
  },
  facet: {
    label: "Filter instructions by status",
    of: (row) => STATUS[row.item.status],
    order: () => Object.values(STATUS),
  },
});
