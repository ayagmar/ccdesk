import {
  type Approval,
  type BuiltinTool,
  type CatalogSetting,
  type DirectoryView,
  type EffectiveSetting,
  type Entry,
  type Hook,
  type Instruction,
  type McpServer,
  type Memory,
  type Permission,
  type Plugin,
  type Reference,
} from "../../shared/types.ts";
import { type Formatter } from "../format.ts";
import { type Line } from "../lines.ts";

export type EntryKind = "agent" | "skill" | "command" | "output style";

/** One table row; `id` stays the same across reloads so a selection survives them. */
export type Row =
  | { id: string; section: "instructions"; line: Line; item: Instruction; order: number }
  | { id: string; section: "settings"; line: Line; item: EffectiveSetting; lines: Line[] }
  | { id: string; section: "permissions"; line: Line; item: Permission }
  /** Calls you approved by hand that an allow rule not yet in any file would cover. */
  | { id: string; section: "permissions"; line: null; item: Approval; suggested: true }
  /** A tool no rule names as a whole belongs to no scope. */
  | {
      id: string;
      section: "tools";
      line: Line | null;
      item: BuiltinTool;
      /** Calls in the sessions started here; undefined while counting, null if counting failed. */
      calls: number | null | undefined;
    }
  | { id: string; section: "memory"; line: Line; item: Memory }
  | { id: string; section: "hooks"; line: Line; item: Hook }
  | { id: string; section: "mcp"; line: Line; item: McpServer }
  /** A documented setting; its line is the file that sets it here, if any. */
  | {
      id: string;
      section: "catalog";
      line: Line | null;
      item: CatalogSetting;
      set?: EffectiveSetting;
    }
  | { id: string; section: "extensions"; line: Line; item: Entry; kind: EntryKind }
  | { id: string; section: "extensions"; line: Line; item: Plugin; kind: "plugin" };

export type SectionId = Row["section"];
export type RowOf<S extends SectionId> = Extract<Row, { section: S }>;

/** What sections need besides the directory: how to show paths, and Claude Code's settings data. */
export interface ViewContext {
  format: Formatter;
  /** From `REFERENCE` in the core, or `/api/reference` in the page. */
  reference: Reference;
}

export interface Column<R> {
  label: string;
  /** Sort key; columns without one cannot be sorted. */
  sort?: (row: R) => string | number;
}

/** Rows of one section narrowed by a value, such as memory by type. */
export interface Facet<R> {
  label: string;
  of: (row: R) => string;
  /** The order values are offered in; values not listed come after, by name. */
  order?: (context: ViewContext) => string[];
}

/** How one kind of row is listed: its rows, columns and the text that names them. */
export interface ViewSection<R extends Row> {
  id: R["section"];
  title: string;
  /** A shorter title for the section index, when the title is long. */
  short?: string;
  rows: (view: DirectoryView, context: ViewContext) => R[];
  columns: Column<R>[];
  empty: (view: DirectoryView) => string;
  /** Rows that exist but do not take effect are drawn faded. */
  dimmed?: (row: R) => boolean;
  /** Text the filter box and the palette search. */
  text: (row: R) => string;
  /**
   * What the palette calls the row: its kind, such as "tool", and its name; `path` when the name is
   * a path, so a long one keeps its end.
   */
  label: (row: R, context: ViewContext) => { kind: string; name: string; path?: boolean };
  /** The inspector's heading for a row: the name the row shows, so the two read as one thing. */
  heading: (row: R, context: ViewContext, view: DirectoryView) => string;
  facet?: Facet<R>;
  /** An extra class for the table, from the rows on it. */
  tableClass?: (rows: R[]) => string;
}

/**
 * Lets the registry hold every section in one list. Sound because a row is only ever handed to
 * the section that made it, looked up by `row.section`.
 */
export function defineSection<R extends Row>(section: ViewSection<R>): ViewSection<Row> {
  return section as unknown as ViewSection<Row>;
}
