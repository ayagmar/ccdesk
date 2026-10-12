import { type ComponentType, type ReactNode } from "react";
import {
  type Approval,
  type BuiltinTool,
  type Change,
  type DirectoryView,
  type EffectiveSetting,
  type Entry,
  type Hook,
  type Instruction,
  type McpServer,
  type Memory,
  type Overview,
  type Permission,
  type Plugin,
} from "../../shared/types.ts";
import { type Line } from "../lines.ts";
import { type Saved } from "../SettingEditor.tsx";
import { type CatalogSetting } from "../settingsCatalog.ts";

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

/** What the inspector's add form adds. */
export type Adding = "setting" | "permission" | "hook" | "mcp" | "agent";

/** What the page can do for a section: change files, open other directories. */
export interface Actions {
  view: DirectoryView;
  overview: Overview | null;
  /** Memory names saved in other directories too. */
  sharedNames: Set<string>;
  onOpenDirectory: (path: string) => void;
  onAdd: (what: Adding) => void;
  onSaved: (saved: Saved) => void;
  /** Runs one change and reports it; `select` is the row to show afterwards, null for none. */
  onChange: (run: () => Promise<Change>, message: string, select?: string | null) => Promise<void>;
}

export interface Column<R> {
  label: string;
  /** Sort key; columns without one cannot be sorted. */
  sort?: (row: R) => string | number;
}

/** Rows of one section narrowed by a value, such as memory by type. */
interface Facet<R> {
  label: string;
  of: (row: R) => string;
  /** The order values are offered in; values not listed come after, by name. */
  order?: string[];
  /** How a value is shown on its button; defaults to the value. */
  render?: (value: string) => ReactNode;
}

/** Everything ccdesk knows about showing one kind of row. */
export interface Section<R extends Row> {
  id: R["section"];
  title: string;
  /** A shorter title for the section index, when the title is long. */
  short?: string;
  rows: (view: DirectoryView) => R[];
  columns: Array<Column<R>>;
  /** The row's cells, in column order; the name cell holds the row's button. */
  cells: (row: R, actions: Actions, select: () => void) => ReactNode;
  empty: (view: DirectoryView) => string;
  /** Rows that exist but do not take effect are drawn faded. */
  dimmed?: (row: R) => boolean;
  /** Text the filter box and the palette search. */
  text: (row: R) => string;
  /** One line naming the row in the palette. */
  label: (row: R) => string;
  /** The inspector's heading for a row. */
  heading: (row: R) => string;
  facet?: Facet<R>;
  /** An extra class for the table, from the rows on it. */
  tableClass?: (rows: R[]) => string;
  /** Notes and buttons beside the section heading. */
  Head?: ComponentType<{ actions: Actions }>;
  Details: ComponentType<{ row: R; actions: Actions }>;
}

/**
 * Lets the registry hold every section in one list. Sound because a row is only ever handed to
 * the section that made it, looked up by `row.section`.
 */
export function defineSection<R extends Row>(section: Section<R>): Section<Row> {
  return section as unknown as Section<Row>;
}
