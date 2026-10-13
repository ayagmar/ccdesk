// SchemaStore's schema for Claude Code settings fills in documented keys that the SDK's Settings
// type leaves out. It is community maintained, so it never replaces a key the SDK defines, and a
// borrowed key keeps only its shape: the description comes from Claude Code's docs, since
// SchemaStore's can disagree with them.

export const SCHEMASTORE_URL = "https://json.schemastore.org/claude-code-settings.json";
/** The copy `pnpm schemastore` keeps, which `pnpm schema` reads. */
export const SCHEMASTORE_SNAPSHOT = new URL(
  "./schemastore-claude-code-settings.json",
  import.meta.url
);

/** Put on each borrowed key, and shown with it in the editor. */
export const BORROWED_NOTE =
  "Checked against SchemaStore's schema: Claude Code's SDK does not define this key yet.";

type Properties = Record<string, Record<string, unknown>>;

/**
 * The SDK's properties plus SchemaStore's definition of each documented key the SDK lacks, and the
 * documented keys neither defines. `documented` maps each documented key to its description in the
 * docs. A borrowed key that points elsewhere in SchemaStore's schema would not resolve in ours, so
 * it stops the run for a person to look at.
 */
export function borrowMissingKeys(
  sdk: Properties,
  schemastore: Properties,
  documented: Record<string, string>
): { properties: Properties; borrowed: string[]; uncovered: string[] } {
  const missing = Object.keys(documented).filter((key) => !Object.hasOwn(sdk, key));
  const borrowed = missing.filter((key) => Object.hasOwn(schemastore, key));
  const properties = { ...sdk };
  for (const key of borrowed) {
    const definition = schemastore[key] as Record<string, unknown>;
    if (JSON.stringify(definition).includes('"$ref"'))
      throw new Error(`SchemaStore's ${key} uses $ref, which the generated schema cannot resolve.`);
    properties[key] = { ...definition, description: documented[key], $comment: BORROWED_NOTE };
  }
  return { properties, borrowed, uncovered: missing.filter((key) => !borrowed.includes(key)) };
}
