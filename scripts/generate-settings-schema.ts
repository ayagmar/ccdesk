// Regenerates src/shared/settings.schema.json from the Settings type that
// @anthropic-ai/claude-agent-sdk ships (itself generated from Claude Code's settings schema), and
// src/shared/hook-events.json from the hook events it exports.
import { readFileSync, writeFileSync } from "node:fs";
import { HOOK_EVENTS } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

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

const out = new URL("../src/shared/settings.schema.json", import.meta.url);
writeFileSync(
  out,
  `${JSON.stringify({ ...schema, $comment: `claude-agent-sdk ${sdkVersion}` }, null, 2)}\n`
);
console.log(`Wrote ${fileURLToPath(out)} from claude-agent-sdk ${sdkVersion}`);

const events = new URL("../src/shared/hook-events.json", import.meta.url);
writeFileSync(events, `${JSON.stringify(HOOK_EVENTS, null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(events)} from claude-agent-sdk ${sdkVersion}`);
