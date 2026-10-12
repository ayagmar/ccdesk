import { type SettingSchema } from "../shared/types.ts";

/** How a setting is edited: typed controls where the schema allows it, JSON otherwise. */
export type FieldKind = "boolean" | "enum" | "number" | "string" | "lines" | "json";

export function fieldKind(property: SettingSchema | undefined): FieldKind {
  if (!property) return "json";
  if (property.enum?.every((v) => typeof v === "string")) return "enum";
  if (property.type === "boolean") return "boolean";
  if (property.type === "number" || property.type === "integer") return "number";
  if (property.type === "string") return "string";
  if (property.type === "array" && property.items?.type === "string" && !property.items.enum)
    return "lines";
  return "json";
}

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
