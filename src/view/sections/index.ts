import { type DirectoryView } from "../../shared/types.ts";
import { catalog } from "./catalog.ts";
import { extensions } from "./extensions.ts";
import { hooks } from "./hooks.ts";
import { instructions } from "./instructions.ts";
import { mcp } from "./mcp.ts";
import { memory } from "./memory.ts";
import { permissions } from "./permissions.ts";
import { settings } from "./settings.ts";
import { tools } from "./tools.ts";
import { type Row, type ViewContext, type ViewSection } from "./types.ts";

/** The sections of a directory page, in page order. */
export const SECTIONS: Array<ViewSection<Row>> = [
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

/** Every section's rows for one directory, in page order. */
export function buildRows(view: DirectoryView, context: ViewContext): Row[] {
  return SECTIONS.flatMap((s) => s.rows(view, context));
}
