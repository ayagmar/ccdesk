import { Compile, type Validator } from "typebox/compile";
import schema from "../../shared/settings.schema.json" with { type: "json" };
import { isRecord } from "./data.ts";

const root: unknown = schema.definitions.ClaudeCodeSettings;
const validators = new Map<string, Validator>();

/**
 * The schema one step below `node`: a list's entries for `"[]"`, else a named field or a map's
 * entry. Of an anyOf, the list branch or the object branch, whichever the step steps into.
 */
function child(node: Record<string, unknown>, step: string): unknown {
  if (Array.isArray(node.anyOf)) {
    const wanted = step === "[]" ? "array" : "object";
    const branch = node.anyOf.find((b) => isRecord(b) && b.type === wanted);
    return isRecord(branch) ? child(branch, step) : null;
  }
  if (step === "[]") return node.items;
  const { properties } = node;
  // Own properties only: a key such as __proto__ names no setting.
  if (isRecord(properties) && Object.hasOwn(properties, step)) return properties[step];
  return node.additionalProperties;
}

/**
 * The settings schema of a key or a field under one, such as `["sandbox", "network"]`; `"[]"`
 * steps into a list's entries. Null where the schema defines nothing there.
 */
export function schemaAt(path: string[]): Record<string, unknown> | null {
  let node: unknown = root;
  for (const step of path) node = isRecord(node) ? child(node, step) : null;
  return isRecord(node) ? node : null;
}

/** The validator for the schema at `path`, compiled once; null where the schema defines nothing. */
export function validatorAt(path: string[]): Validator | null {
  const key = path.join("\0");
  const cached = validators.get(key);
  if (cached) return cached;
  const at = schemaAt(path);
  if (!at) return null;
  const validate = Compile(at);
  validators.set(key, validate);
  return validate;
}

/** The settings schema's validator for one top-level key, or null for a key it does not define. */
export function validatorFor(key: string): Validator | null {
  return validatorAt([key]);
}

/** The JSON type of a parsed value, as a schema names it. */
function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

/**
 * Whether `value` is of a type the schema at `path` allows, from its `type` or its anyOf branches;
 * true where the schema names no type.
 */
export function hasSchemaType(path: string[], value: unknown): boolean {
  const at = schemaAt(path);
  const branches = Array.isArray(at?.anyOf) ? at.anyOf : [at];
  const types = branches.flatMap((b) =>
    isRecord(b) && typeof b.type === "string" ? [b.type] : []
  );
  if (types.length === 0 || types.length < branches.length) return true;
  const actual = jsonType(value);
  return types.includes(actual) || (actual === "number" && types.includes("integer"));
}
