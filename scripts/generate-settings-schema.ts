// Regenerates src/shared/settings.schema.json from the Settings type that
// @anthropic-ai/claude-agent-sdk ships (itself generated from Claude Code's settings schema), plus
// SchemaStore's definition of each documented key the SDK lacks, and src/shared/hook-events.json
// from the hook events the SDK exports. It reads only the pinned SDK and committed files, so CI can
// check the output: SchemaStore's schema from the snapshot `pnpm schemastore` refreshes, and the
// documented keys from src/shared/settings-catalog.json, which `pnpm scopes` refreshes.
//
// With a file path argument, also writes there the documented keys neither source defines, as a
// Markdown list for the data update PR.
import { readFileSync, writeFileSync } from "node:fs";
import { HOOK_EVENTS } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";
import catalog from "../src/shared/settings-catalog.json" with { type: "json" };
import { plain } from "../src/view/sections/catalog.ts";
import { borrowMissingKeys, SCHEMASTORE_SNAPSHOT } from "./schemastore.ts";

const sdkVersion: string = JSON.parse(
  readFileSync(
    new URL("../node_modules/@anthropic-ai/claude-agent-sdk/package.json", import.meta.url),
    "utf8"
  )
).version;

const schema = createGenerator({
  path: fileURLToPath(new URL("./settings-entry.ts", import.meta.url)),
  type: "ClaudeCodeSettings",
  skipTypeCheck: true,
}).createSchema("ClaudeCodeSettings");
const settings = schema.definitions?.ClaudeCodeSettings as {
  properties: Record<string, Record<string, unknown>>;
};

const schemastore: { properties: Record<string, Record<string, unknown>> } = JSON.parse(
  readFileSync(SCHEMASTORE_SNAPSHOT, "utf8")
);

// Fields such as autoMode.classifyAllShell are documented on their own but live in their parent.
const documented = Object.fromEntries(
  Object.entries(catalog.keys)
    .filter(([key]) => !key.includes("."))
    .map(([key, entry]) => [key, plain(entry.summary)])
);
const { properties, borrowed, uncovered } = borrowMissingKeys(
  settings.properties,
  schemastore.properties,
  documented
);
settings.properties = properties;

const out = new URL("../src/shared/settings.schema.json", import.meta.url);
writeFileSync(
  out,
  `${JSON.stringify(
    { ...schema, $comment: `claude-agent-sdk ${sdkVersion}, with SchemaStore for keys it lacks` },
    null,
    2
  )}\n`
);
console.log(`Wrote ${fileURLToPath(out)} from claude-agent-sdk ${sdkVersion}`);
console.log(`From SchemaStore: ${borrowed.join(", ") || "none"}`);
console.log(`Documented keys neither defines: ${uncovered.join(", ") || "none"}`);

const events = new URL("../src/shared/hook-events.json", import.meta.url);
writeFileSync(events, `${JSON.stringify(HOOK_EVENTS, null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(events)} from claude-agent-sdk ${sdkVersion}`);

const gapsFile = process.argv[2];
if (gapsFile) writeFileSync(gapsFile, uncovered.map((key) => `- \`${key}\`\n`).join(""));
