// Refreshes scripts/schemastore-claude-code-settings.json, the snapshot of SchemaStore's schema that
// `pnpm schema` reads, so the generated schema changes only when this file does.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMASTORE_SNAPSHOT, SCHEMASTORE_URL } from "./schemastore.ts";

const response = await fetch(SCHEMASTORE_URL);
if (!response.ok) throw new Error(`${SCHEMASTORE_URL} answered ${response.status}.`);
writeFileSync(SCHEMASTORE_SNAPSHOT, `${JSON.stringify(await response.json(), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(SCHEMASTORE_SNAPSHOT)} from ${SCHEMASTORE_URL}`);
