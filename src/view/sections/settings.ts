import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type Scope } from "../../shared/types.ts";
import { LINES, type Line, lineName } from "../lines.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"settings">;

export const settings = defineSection<R>({
  id: "settings",
  title: "Settings",
  rows: (view) =>
    view.effective.map((item) => {
      const lines = item.from as Line[];
      return {
        id: `set:${item.key}`,
        section: "settings",
        line: lines[lines.length - 1] ?? "user",
        item,
        lines,
      };
    }),
  columns: [
    { label: "", sort: (r) => HIGHEST_FIRST.indexOf((r.item.from[0] ?? "user") as Scope) },
    { label: "Key", sort: (r) => r.item.key },
    { label: "Value" },
    { label: "Overrides" },
  ],
  empty: () => "No settings files set anything here.",
  // The Overrides column only earns its space when some value beats or merges with another file.
  tableClass: (rows) =>
    rows.some((r) => r.item.merged || r.item.overridden.length > 0 || r.item.ignored.length > 0)
      ? ""
      : "no-overrides",
  dimmed: (row) => row.item.from.length === 0,
  text: (row) => `${row.item.key} ${JSON.stringify(row.item.value)}`,
  label: (row) => ({ kind: "setting", name: row.item.key }),
  heading: (row) => row.item.key,
  facet: {
    label: "Filter settings by the file that decides them",
    // A merged value is decided by its highest file, the one the row's line shows.
    of: (row) => (row.item.from.length === 0 ? "Ignored" : lineName(row.line)),
    order: () => [...LINES.map((l) => l.name), "Ignored"],
  },
});
