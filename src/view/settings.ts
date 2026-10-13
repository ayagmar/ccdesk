import { type SettingSchema } from "../shared/types.ts";

/**
 * How a setting is edited: typed controls where the schema allows it, JSON otherwise. An object
 * gets a form when each property it names has a control of its own.
 */
export type FieldKind =
  | "boolean"
  | "enum"
  | "number"
  | "string"
  | "lines"
  | "choices"
  | "object"
  | "json";

/**
 * A value as a form holds it: text for inputs, a boolean for a checkbox, the values picked from a
 * list of choices, and an object form's properties by name. A property of an object form may be
 * left unset, so its boolean is "true", "false" or "".
 */
export type Draft = string | boolean | string[] | DraftObject;
export interface DraftObject {
  [name: string]: Draft;
}

export function fieldKind(property: SettingSchema | undefined): FieldKind {
  if (!property) return "json";
  if (allowedValues(property)?.every((v) => typeof v === "string")) return "enum";
  const type = typeOf(property);
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "integer") return "number";
  if (type === "string") return "string";
  if (type === "array" && property.items && typeOf(property.items) === "string") {
    const values = allowedValues(property.items);
    if (!values) return "lines";
    if (values.every((v) => typeof v === "string")) return "choices";
  }
  const properties = Object.values(property.properties ?? {});
  if (type === "object" && properties.length > 0 && properties.every(hasOwnControl))
    return "object";
  return "json";
}

/**
 * The control a value is edited with: its setting's field kind, or JSON when that control cannot
 * hold the value exactly as the file has it, such as an object with a property the schema does not
 * name or a value of another type. Saving from a control so never changes what you did not touch.
 */
export function editKind(property: SettingSchema | undefined, value: unknown): FieldKind {
  const kind = fieldKind(property);
  if (kind === "json" || value === undefined) return kind;
  const back = fromDraft(kind, property, toDraft(kind, property, value));
  return "value" in back && JSON.stringify(back.value) === JSON.stringify(value) ? kind : "json";
}

/** A value being edited: its control and what that control holds. */
export interface Form {
  kind: FieldKind;
  draft: Draft;
}

/** The form for a value as the file has it. */
export function formFor(property: SettingSchema | undefined, value: unknown): Form {
  const kind = editKind(property, value);
  return { kind, draft: toDraft(kind, property, value) };
}

/**
 * The form once the file's value changes from `was` to `now`, as when Claude Code or an editor
 * writes it. A form you have not edited follows the file, as does one that matches it, as after
 * saving. One you have edited is kept, control and all, to be reviewed against the file as it is
 * now.
 */
export function followFile(
  form: Form,
  property: SettingSchema | undefined,
  was: unknown,
  now: unknown
): { form: Form; kept: boolean } {
  const next = formFor(property, now);
  const edited = !sameForm(form, formFor(property, was));
  return edited && !sameForm(form, next) ? { form, kept: true } : { form: next, kept: false };
}

function sameForm(a: Form, b: Form): boolean {
  return a.kind === b.kind && JSON.stringify(a.draft) === JSON.stringify(b.draft);
}

/** The form's value as JSON, to write what the controls cannot, such as an empty list. */
export function asJson(form: Form, property: SettingSchema | undefined): Form | { error: string } {
  const parsed = fromDraft(form.kind, property, form.draft);
  if ("error" in parsed) return parsed;
  return { kind: "json", draft: toDraft("json", property, parsed.value) };
}

/** JSON back in the setting's controls, when they can hold the value exactly. */
export function asForm(form: Form, property: SettingSchema | undefined): Form | { error: string } {
  const parsed = fromDraft("json", property, form.draft);
  if ("error" in parsed) return parsed;
  const kind = editKind(property, parsed.value);
  if (kind === "json")
    return { error: "The form cannot hold this value exactly; edit it as JSON." };
  return { kind, draft: toDraft(kind, property, parsed.value) };
}

/** The values a schema allows, when it lists them: its enum, or its const as a list of one. */
export function allowedValues(schema: SettingSchema): unknown[] | undefined {
  if (schema.enum) return schema.enum;
  return "const" in schema ? [schema.const] : undefined;
}

/** The schema's one type, taking "string or null" as string: no control writes null. */
function typeOf(schema: SettingSchema): string | undefined {
  if (!Array.isArray(schema.type)) return schema.type;
  const types = schema.type.filter((t) => t !== "null");
  return types.length === 1 ? types[0] : undefined;
}

/** A property an object form can show: one with a control, not JSON or another object. */
function hasOwnControl(property: SettingSchema): boolean {
  const kind = fieldKind(property);
  return kind !== "json" && kind !== "object";
}

/** A value as the control for `kind` starts out. `inObject` is for a property of an object form. */
export function toDraft(
  kind: FieldKind,
  property: SettingSchema | undefined,
  value: unknown,
  inObject = false
): Draft {
  if (kind === "boolean") {
    if (!inObject) return value === true;
    return typeof value === "boolean" ? String(value) : "";
  }
  if (kind === "choices") return Array.isArray(value) ? value.map(String) : [];
  if (kind === "object") return objectDraft(property ?? {}, value);
  if (value === undefined) return "";
  if (kind === "lines") return Array.isArray(value) ? value.join("\n") : "";
  if (kind === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Each property the schema names, in the file's order and then the schema's, so a save leaves the
 * file's order alone. A new object starts with the one value a required property allows, such as
 * statusLine's type "command".
 */
function objectDraft(schema: SettingSchema, value: unknown): DraftObject {
  const properties = schema.properties ?? {};
  const file = isObject(value) ? value : {};
  const names = [...new Set([...Object.keys(file), ...Object.keys(properties)])];
  const draft: DraftObject = {};
  for (const name of names) {
    // Only the schema's own names: a file's key such as "constructor" is not a property.
    const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!property) continue;
    const only = allowedValues(property);
    const start =
      value === undefined && schema.required?.includes(name) && only?.length === 1
        ? only[0]
        : file[name];
    draft[name] = toDraft(fieldKind(property), property, start, true);
  }
  return draft;
}

/**
 * The value a draft stands for, or what to fix. A property of an object form left empty is unset,
 * its value undefined.
 */
export function fromDraft(
  kind: FieldKind,
  property: SettingSchema | undefined,
  draft: Draft,
  inObject = false
): { value: unknown } | { error: string } {
  if (inObject && (draft === "" || (Array.isArray(draft) && draft.length === 0)))
    return { value: undefined };
  // A draft's shape follows from its kind (see toDraft); text drafts are told apart by kind.
  if (typeof draft === "boolean") return { value: draft };
  if (Array.isArray(draft)) {
    const allowed = (property?.items && allowedValues(property.items)) ?? [];
    return draft.every((v) => allowed.includes(v)) ? { value: draft } : { error: "Pick a value." };
  }
  if (typeof draft === "object") return objectFromDraft(property ?? {}, draft);
  if (kind === "boolean") return { value: draft === "true" };
  if (kind === "number") {
    const n = Number(draft);
    return draft.trim() === "" || Number.isNaN(n) ? { error: "Enter a number." } : { value: n };
  }
  if (kind === "lines")
    return {
      value: draft
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    };
  if (kind === "enum")
    return property && allowedValues(property)?.includes(draft)
      ? { value: draft }
      : { error: "Pick a value." };
  if (kind === "json") return jsonFromDraft(property, draft);
  // A text field holds one line, so text with a line break is edited as JSON.
  if (/[\r\n]/.test(draft)) return { error: "Text with a line break is edited as JSON." };
  return { value: draft };
}

function objectFromDraft(
  schema: SettingSchema,
  draft: DraftObject
): { value: unknown } | { error: string } {
  const value: Record<string, unknown> = {};
  for (const [name, part] of Object.entries(draft)) {
    const property = schema.properties?.[name];
    const parsed = fromDraft(fieldKind(property), property, part, true);
    if ("error" in parsed) return { error: `${name}: ${parsed.error}` };
    if (parsed.value !== undefined) value[name] = parsed.value;
  }
  return { value };
}

/** JSON typed for a setting, or why it does not parse, with how to write text where text is allowed. */
function jsonFromDraft(
  property: SettingSchema | undefined,
  draft: string
): { value: unknown } | { error: string } {
  const parsed = parseJson(draft);
  if (!("error" in parsed)) return parsed;
  const text = draft.trim();
  const quote =
    property && text !== "" && takesText(property)
      ? `. Text goes in double quotes: ${JSON.stringify(text)}`
      : "";
  return { error: `Not valid JSON: ${parsed.error}${quote}` };
}

function takesText(schema: SettingSchema): boolean {
  if (schema.anyOf) return schema.anyOf.some(takesText);
  return [schema.type ?? []].flat().includes("string");
}

/** JSON typed into a form, or why it does not parse. */
export function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * What a value must be, in JSON's terms: "true or false, or an object with commit, pr and
 * sessionUrl". Shown beside a JSON field, so you know the shape before the review checks it.
 */
export function expects(schema: SettingSchema): string {
  if (schema.anyOf) return schema.anyOf.map(expects).join(", or ");
  const values = allowedValues(schema);
  if (values) return `one of ${values.map((v) => JSON.stringify(v)).join(", ")}`;
  const types = [schema.type ?? []].flat();
  if (types.length === 0) return "any value";
  return types.map((type) => typeExpected(type, schema)).join(" or ");
}

function typeExpected(type: string, schema: SettingSchema): string {
  if (type === "boolean") return "true or false";
  if (type === "number" || type === "integer") return "a number";
  if (type === "null") return "null";
  if (type === "array") return schema.items ? `a list, each ${expects(schema.items)}` : "a list";
  if (type !== "object") return `a ${type}`;
  const names = Object.keys(schema.properties ?? {});
  if (names.length > 0) return `an object with ${listOf(names)}`;
  const each = schema.additionalProperties;
  return typeof each === "object" ? `an object mapping each name to ${expects(each)}` : "an object";
}

/** Names as a sentence lists them, the first four and how many more. */
function listOf(names: string[]): string {
  if (names.length > 4) return `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : `${names[0]}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
