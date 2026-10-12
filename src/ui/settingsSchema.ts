import { type SettingSchema } from "../shared/types.ts";
import { reference } from "./reference.ts";

/** How a setting is edited: typed controls where the schema allows it, JSON otherwise. */
export type FieldKind = "boolean" | "enum" | "number" | "string" | "lines" | "json";

export function schemaSource(): string {
  return reference().schemaSource;
}

export function settingKeys(): string[] {
  return Object.keys(reference().settings).sort();
}

export function propertyFor(key: string): SettingSchema | undefined {
  return reference().settings[key];
}

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
