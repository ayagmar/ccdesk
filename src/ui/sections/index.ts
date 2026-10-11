import { type DirectoryView } from "../../shared/types.ts";
import { catalog } from "./catalog.tsx";
import { extensions } from "./extensions.tsx";
import { hooks } from "./hooks.tsx";
import { instructions } from "./instructions.tsx";
import { mcp } from "./mcp.tsx";
import { memory } from "./memory.tsx";
import { permissions } from "./permissions.tsx";
import { settings } from "./settings.tsx";
import { tools } from "./tools.tsx";
import { type Row, type Section, type SectionId } from "./types.ts";

/** The sections of a directory page, in page order. */
export const SECTIONS: Array<Section<Row>> = [
  instructions,
  settings,
  permissions,
  tools,
  memory,
  hooks,
  mcp,
  extensions,
  catalog,
];

export function sectionOf(id: SectionId): Section<Row> {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown section ${id}`);
  return section;
}

export function buildRows(view: DirectoryView): Row[] {
  return SECTIONS.flatMap((s) => s.rows(view));
}
