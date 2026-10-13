// What a front end shows from a DirectoryView, without React or the browser: each section's rows,
// columns, filter text and labels, and the formatting they use. The page in src/ui adds the cells
// and the inspector; a terminal UI can draw the same rows. See ARCHITECTURE.md.

export { diffLines, withContext } from "./diff.ts";
export { ago, type Formatter, formatter, plural, preview } from "./format.ts";
export { LINES, type Line, lineName } from "./lines.ts";
export { valueHere } from "./sections/catalog.ts";
export { MATCH_KIND } from "./path-test.ts";
export { buildRows, SECTIONS } from "./sections/index.ts";
export { isSuggested, unused } from "./sections/permissions.ts";
export { callsOf, outcome } from "./sections/tools.ts";
export type {
  Column,
  EntryKind,
  Facet,
  Row,
  RowOf,
  SectionId,
  ViewContext,
  ViewSection,
} from "./sections/types.ts";
export {
  allowedValues,
  type Draft,
  type DraftObject,
  editKind,
  expects,
  type FieldKind,
  fieldKind,
  fromDraft,
  parseJson,
  toDraft,
  valuesIn,
} from "./settings.ts";
export { sessionsHere, suggestedRules } from "./usage.ts";
