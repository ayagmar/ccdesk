import { type MemoryReads, type MemoryType, type Usage } from "../../shared/types.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"memory">;

const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference", "unknown"];

/** A memory not read for this long is flagged; it is still loaded through its index line. */
const UNREAD_DAYS = 30;

/**
 * Reads counted for a memory: undefined while counting, including a memory saved after the count
 * began, and null when the transcripts could not be read.
 */
export function readsOf(
  usage: Usage | null | undefined,
  path: string
): MemoryReads | null | undefined {
  if (!usage) return usage;
  return usage.memories[path];
}

/**
 * Why a memory looks unused, once the count is in and there are sessions to judge by: it was never
 * read in them, or not in the last 30 days.
 */
export function unreadOf(usage: Usage | null | undefined, reads: MemoryReads | null | undefined) {
  if (!usage || !reads || usage.sessions === 0) return null;
  if (!reads.last) return "never read";
  const days = (Date.now() - new Date(reads.last).getTime()) / 86_400_000;
  return days > UNREAD_DAYS ? `not read in ${UNREAD_DAYS} days` : null;
}

export const memory = defineSection<R>({
  id: "memory",
  title: "Memory",
  rows: (view) =>
    view.memory.memories.map((item) => {
      const reads = readsOf(view.usage, item.path);
      return {
        id: `mem:${item.path}`,
        section: "memory",
        line: "memory",
        item,
        reads,
        unread: unreadOf(view.usage, reads),
      };
    }),
  columns: [
    { label: "" },
    { label: "Name", sort: (r) => r.item.name },
    { label: "Type", sort: (r) => MEMORY_TYPES.indexOf(r.item.type) },
    { label: "Reads", sort: (r) => r.reads?.reads ?? -1 },
    { label: "Last read", sort: (r) => r.reads?.last ?? "" },
    {
      label: "Checks",
      sort: (r) => Number(!r.item.inIndex) * 10 + r.item.brokenLinks.length,
    },
    { label: "Description" },
  ],
  empty: (view) =>
    view.memory.index
      ? "MEMORY.md is here, but no memory files."
      : "Claude hasn't saved any memory for this directory yet.",
  text: (row) =>
    `${row.item.name} ${row.item.description} ${row.item.type} ${row.unread ?? ""} ${row.item.body}`,
  label: (row) => ({ kind: "memory", name: row.item.name }),
  heading: (row) => row.item.name,
  facet: { label: "Filter memory by type", of: (row) => row.item.type, order: () => MEMORY_TYPES },
});
