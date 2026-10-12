import { reference } from "./reference.ts";

/**
 * The string values a settings reference type lists, such as theme's "dark" and "light": offered as
 * choices where the schema allows any string. In a bulleted list only the value opening each bullet
 * counts, since the explanations quote other values. Inline, only a list the type states is taken
 * ("one of", "the string"), up to a ";" or "such as", so examples and remarks are not;
 * placeholders like "custom:<slug>" are left out.
 */
export function valuesIn(type: string): string[] {
  const bullets = [...type.matchAll(/^\* `"([^"`<>]+)"`/gm)].map((m) => m[1] ?? "");
  const clause = (type.split("\n")[0] ?? "").split(/;| such as /)[0] ?? "";
  const inline = /one of|the string|^string, `"/.test(clause)
    ? [...clause.matchAll(/`"([^"`<>]+)"`/g)].map((m) => m[1] ?? "")
    : [];
  return [...new Set((bullets.length > 0 ? bullets : inline).filter(Boolean))];
}

export function documentedValues(key: string): string[] {
  return valuesIn(reference().catalog.find((s) => s.key === key)?.type ?? "");
}

/** Categories in the order the settings reference lists them. */
export function categories(): string[] {
  return [...new Set(reference().catalog.map((s) => s.category))];
}
