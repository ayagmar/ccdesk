import { type Row, type SectionId } from "../view/sections/types.ts";
import { type Section } from "./sections/types.ts";
import { type ListState } from "./url.ts";

/** Rows shown per section before "Show more". */
export const PAGE = 50;

export interface Group {
  section: Section<Row>;
  /** Every row of the section. */
  all: Row[];
  /** Rows that pass the filters, in display order. */
  matching: Row[];
  /** The part of `matching` on screen. */
  shown: Row[];
}

function compare(a: string | number, b: string | number): number {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Each section's rows, filtered, sorted and cut to the number shown. */
export function groupRows(
  sections: Section<Row>[],
  rows: Row[],
  state: ListState,
  shown: Partial<Record<SectionId, number>>
): Group[] {
  const q = state.query.trim().toLowerCase();
  return sections.map((section) => {
    const all = rows.filter((r) => r.section === section.id);
    const only = state.only[section.id];
    const matching = all.filter(
      (r) =>
        (!state.line ||
          r.line === state.line ||
          (r.section === "settings" && r.lines.includes(state.line))) &&
        (!only || section.facet?.of(r) === only) &&
        (!q || section.text(r).toLowerCase().includes(q))
    );
    const sort = state.sort[section.id];
    const key = sort ? section.columns[sort.column]?.sort : undefined;
    if (sort && key)
      // Array.prototype.sort is stable, so equal keys keep the section's own order.
      matching.sort((a, b) => compare(key(a), key(b)) * (sort.descending ? -1 : 1));
    return { section, all, matching, shown: matching.slice(0, shown[section.id] ?? PAGE) };
  });
}

/** True when any filter narrows the lists. */
export function isFiltered(state: ListState): boolean {
  return Boolean(state.query.trim() || state.line || Object.values(state.only).some(Boolean));
}
