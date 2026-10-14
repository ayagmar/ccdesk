import { type MemoryType } from "../../shared/types.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"memory">;

const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference", "unknown"];

export const memory = defineSection<R>({
  id: "memory",
  title: "Memory",
  rows: (view) =>
    view.memory.memories.map((item) => ({
      id: `mem:${item.path}`,
      section: "memory",
      line: "memory",
      item,
    })),
  columns: [
    { label: "" },
    { label: "Name", sort: (r) => r.item.name },
    { label: "Type", sort: (r) => MEMORY_TYPES.indexOf(r.item.type) },
    { label: "Description" },
    {
      label: "Checks",
      sort: (r) => Number(!r.item.inIndex) * 10 + r.item.brokenLinks.length,
    },
    { label: "Updated", sort: (r) => r.item.mtime },
  ],
  empty: (view) =>
    view.memory.index
      ? "MEMORY.md is here, but no memory files."
      : "Claude hasn't saved any memory for this directory yet.",
  text: (row) => `${row.item.name} ${row.item.description} ${row.item.type} ${row.item.body}`,
  label: (row) => ({ kind: "memory", name: row.item.name }),
  heading: (row) => row.item.name,
  facet: { label: "Filter memory by type", of: (row) => row.item.type, order: () => MEMORY_TYPES },
});
