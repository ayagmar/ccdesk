import { type ComponentType, type ReactNode } from "react";
import { type Change, type DirectoryView, type Overview } from "../../shared/types.ts";
import { type Row, type ViewSection } from "../../view/sections/types.ts";
import { type Saved } from "../useReviewedChange.tsx";

/** What the inspector's add form adds. */
export type Adding = "setting" | "permission" | "hook" | "mcp" | "agent";

/** What the page can do for a section: change files, open other directories. */
export interface Actions {
  view: DirectoryView;
  overview: Overview | null;
  /** Memory names saved in other directories too. */
  sharedNames: Set<string>;
  onOpenDirectory: (path: string) => void;
  /** Asks for another directory to compare this one's settings with. */
  onCompare: () => void;
  onAdd: (what: Adding) => void;
  onSaved: (saved: Saved) => void;
  /** Runs one change and reports it; `select` is the row to show afterwards, null for none. */
  onChange: (run: () => Promise<Change>, message: string, select?: string | null) => Promise<void>;
}

/** What a row's NameButton needs: how to select the row, and whether it is the selected one. */
export interface RowName {
  onClick: () => void;
  current: boolean;
}

/** The page's half of a section: its cells, the notes beside its heading, and its inspector. */
export interface SectionUi<R extends Row> {
  /** The row's cells, in column order; the name cell holds the row's NameButton, given `name`. */
  cells: (row: R, actions: Actions, name: RowName) => ReactNode;
  /** How a facet value is shown on its button; defaults to the value. */
  renderFacet?: (value: string) => ReactNode;
  /** Notes and buttons beside the section heading. */
  Head?: ComponentType<{ actions: Actions }>;
  Details: ComponentType<{ row: R; actions: Actions }>;
}

/** Everything ccdesk knows about showing one kind of row. */
export type Section<R extends Row> = ViewSection<R> & SectionUi<R>;
