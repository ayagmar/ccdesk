import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type CatalogSetting, type Scope } from "../../shared/types.ts";
import { LINES, type Line, lineName } from "../lines.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"settings">;

/**
 * The one value a documented default names: a code span such as `false`, alone or followed by why
 * (", so …" or ", which …"). A default that depends on something, such as `"bash"` or
 * `"powershell"` on Windows, or one told in words, names none.
 */
function documentedDefault(setting: CatalogSetting | undefined): { value: unknown } | undefined {
  const match = /^`([^`]+)`(?:$|, (?:so|which) )/.exec(setting?.default ?? "");
  if (!match?.[1]) return undefined;
  try {
    return { value: JSON.parse(match[1]) };
  } catch {
    return undefined;
  }
}

/** Two JSON values are the same, whatever order their object keys were written in. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && sameJson(x[k], y[k]))
  );
}

export const settings = defineSection<R>({
  id: "settings",
  title: "Settings",
  rows: (view, { reference }) => {
    const documented = new Map(reference.catalog.map((c) => [c.key, c]));
    return view.effective.map((item) => {
      const lines = item.from as Line[];
      const setting = documented.get(item.key);
      const byDefault = documentedDefault(setting);
      // A value that beats a different one in a lower file changes something, even if it is the default.
      const atDefault =
        item.from.length > 0 &&
        byDefault !== undefined &&
        [item.value, ...item.overridden.map((o) => o.value)].every((v) =>
          sameJson(v, byDefault.value)
        );
      return {
        id: `set:${item.key}`,
        section: "settings",
        line: lines[lines.length - 1] ?? "user",
        item,
        lines,
        ...(atDefault && setting?.default ? { atDefault: setting.default } : {}),
      };
    });
  },
  columns: [
    { label: "", sort: (r) => HIGHEST_FIRST.indexOf((r.item.from[0] ?? "user") as Scope) },
    { label: "Key", sort: (r) => r.item.key },
    { label: "Value" },
    { label: "Overrides" },
  ],
  empty: () => "No settings files set anything here.",
  // The Overrides column only earns its space when some value beats or merges with another file.
  tableClass: (rows) =>
    rows.some((r) => r.item.merged || r.item.overridden.length > 0 || r.item.ignored.length > 0)
      ? ""
      : "no-overrides",
  dimmed: (row) => row.item.from.length === 0,
  text: (row) => `${row.item.key} ${JSON.stringify(row.item.value)}`,
  label: (row) => ({ kind: "setting", name: row.item.key }),
  heading: (row) => row.item.key,
  facet: {
    label: "Filter settings by the file that decides them",
    // A merged value is decided by its highest file, the one the row's line shows.
    of: (row) => {
      if (row.item.from.length > 0) return lineName(row.line);
      // As the table does, a value held for trust speaks for the row, since it applies once you trust the folder.
      return row.item.ignored.some((i) => i.waitsForTrust) ? "Waits for trust" : "Ignored";
    },
    order: () => [...LINES.map((l) => l.name), "Ignored", "Waits for trust"],
  },
});
