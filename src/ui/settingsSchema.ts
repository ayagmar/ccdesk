import schema from "../shared/settings.schema.json" with { type: "json" };

interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  items?: PropertySchema;
  description?: string;
  deprecated?: boolean;
}

/** How a setting is edited: typed controls where the schema allows it, JSON otherwise. */
export type FieldKind = "boolean" | "enum" | "number" | "string" | "lines" | "json";

const properties = schema.definitions.ClaudeCodeSettings.properties as Record<
  string,
  PropertySchema
>;

export const SCHEMA_SOURCE = schema.$comment;

export const SETTING_KEYS = Object.keys(properties).sort();

export function propertyFor(key: string): PropertySchema | undefined {
  return properties[key];
}

export function fieldKind(property: PropertySchema | undefined): FieldKind {
  if (!property) return "json";
  if (property.enum?.every((v) => typeof v === "string")) return "enum";
  if (property.type === "boolean") return "boolean";
  if (property.type === "number" || property.type === "integer") return "number";
  if (property.type === "string") return "string";
  if (property.type === "array" && property.items?.type === "string" && !property.items.enum)
    return "lines";
  return "json";
}
