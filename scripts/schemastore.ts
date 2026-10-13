// SchemaStore's schema for Claude Code settings fills in documented keys that the SDK's Settings
// type leaves out. It is community maintained, so it never replaces a key the SDK defines.

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
 * documented keys neither defines. A borrowed key that points elsewhere in SchemaStore's schema
 * would not resolve in ours, so it stops the run for a person to look at.
 */
export function borrowMissingKeys(
  sdk: Properties,
  schemastore: Properties,
  documented: string[]
): { properties: Properties; borrowed: string[]; uncovered: string[] } {
  const missing = documented.filter((key) => !Object.hasOwn(sdk, key));
  const borrowed = missing.filter((key) => Object.hasOwn(schemastore, key));
  const properties = { ...sdk };
  for (const key of borrowed) {
    const definition = schemastore[key] as Record<string, unknown>;
    if (JSON.stringify(definition).includes('"$ref"'))
      throw new Error(`SchemaStore's ${key} uses $ref, which the generated schema cannot resolve.`);
    properties[key] = { ...definition, $comment: BORROWED_NOTE };
  }
  return { properties, borrowed, uncovered: missing.filter((key) => !borrowed.includes(key)) };
}
