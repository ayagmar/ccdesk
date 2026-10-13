import { SECTIONS as VIEW_SECTIONS } from "../../view/sections/index.ts";
import {
  type Row,
  type RowOf,
  type SectionId,
  type ViewContext,
} from "../../view/sections/types.ts";
import { pageFormatter } from "../format.ts";
import { reference } from "../reference.ts";
import { catalog } from "./catalog.tsx";
import { extensions } from "./extensions.tsx";
import { hooks } from "./hooks.tsx";
import { instructions } from "./instructions.tsx";
import { mcp } from "./mcp.tsx";
import { memory } from "./memory.tsx";
import { permissions } from "./permissions.tsx";
import { settings } from "./settings.tsx";
import { tools } from "./tools.tsx";
import { type Section, type SectionUi } from "./types.ts";

const UI: { [S in SectionId]: SectionUi<RowOf<S>> } = {
  instructions,
  settings,
  permissions,
  tools,
  memory,
  hooks,
  mcp,
  extensions,
  catalog,
};

/**
 * The sections of a directory page, in page order: each view section with its cells and inspector.
 * The cast is sound because a row is only ever handed to the section that made it.
 */
export const SECTIONS: Section<Row>[] = VIEW_SECTIONS.map((section) => ({
  ...section,
  ...(UI[section.id] as unknown as SectionUi<Row>),
}));

export function sectionOf(id: SectionId): Section<Row> {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown section ${id}`);
  return section;
}

/** What the sections need from the page: its home folder and the settings data it loaded. */
export function pageContext(): ViewContext {
  return { format: pageFormatter(), reference: reference() };
}
