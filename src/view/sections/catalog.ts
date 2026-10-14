import { type DirectoryView, type EffectiveSetting } from "../../shared/types.ts";
import { type Line } from "../lines.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"catalog">;

/** The value a key has here: a top-level setting, or a field inside one such as sandbox.network.allowedDomains. */
export function valueHere(
  view: DirectoryView,
  key: string
): { set?: EffectiveSetting; value?: unknown } {
  const [top = "", ...path] = key.split(".");
  const set = view.effective.find((s) => s.key === top && s.from.length > 0);
  if (!set) return {};
  let value: unknown = set.value;
  for (const field of path)
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[field]
        : undefined;
  return value === undefined ? {} : { set, value };
}

/**
 * Docs Markdown kept to one line of plain text, for a table cell. A code span loses only its
 * backticks, so a pattern such as `*.example.com` keeps its asterisk.
 */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part.slice(1, -1) : part.replace(/\*/g, "")))
    .join("");
}

export const catalog = defineSection<R>({
  id: "catalog",
  title: "All settings",
  rows: (view, { reference }) =>
    reference.catalog.map((item) => {
      const { set } = valueHere(view, item.key);
      const line = (set?.from.at(-1) as Line | undefined) ?? null;
      return { id: `cat:${item.key}`, section: "catalog", line, item, ...(set ? { set } : {}) };
    }),
  columns: [
    { label: "", sort: (r) => (r.set ? 0 : 1) },
    { label: "Setting", sort: (r) => r.item.key },
    { label: "What it does" },
    { label: "Files", sort: (r) => -r.item.scopes.length },
    { label: "Here", sort: (r) => (r.set ? 0 : 1) },
  ],
  empty: () => "ccdesk has no list of Claude Code's settings.",
  text: (row) => `${row.item.key} ${plain(row.item.summary)} ${row.item.category}`,
  label: (row) => ({ kind: "all settings", name: row.item.key }),
  heading: (row) => row.item.key,
  facet: {
    label: "Filter settings by area",
    of: (row) => row.item.category,
    // Categories in the order the settings reference lists them.
    order: ({ reference }) => [...new Set(reference.catalog.map((s) => s.category))],
  },
});
