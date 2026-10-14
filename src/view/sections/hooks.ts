import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"hooks">;

export const hooks = defineSection<R>({
  id: "hooks",
  title: "Hooks",
  rows: (view) => {
    // Named by what the hook is, so a selection survives hooks added above it.
    const seen = new Map<string, number>();
    return view.inventory.hooks.map((item) => {
      const key = `hook:${item.sourcePath}:${item.event}:${item.matcher ?? ""}:${item.command}`;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return {
        id: count === 0 ? key : `${key}:${count}`,
        section: "hooks",
        line: item.source,
        item,
      };
    });
  },
  columns: [
    { label: "", sort: (r) => r.item.source },
    { label: "Event", sort: (r) => r.item.event },
    { label: "Matcher", sort: (r) => r.item.matcher ?? "" },
    { label: "Runs" },
  ],
  empty: () => "No hooks run here.",
  dimmed: (row) => !row.item.active,
  text: (row) => `${row.item.event} ${row.item.matcher ?? ""} ${row.item.command}`,
  label: (row) => ({ kind: `${row.item.event} hook`, name: row.item.command }),
  heading: (row) => `${row.item.event} hook`,
  facet: { label: "Filter hooks by event", of: (row) => row.item.event },
});
