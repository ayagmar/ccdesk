// Regenerates src/shared/builtin-tools.json from the tool table in Claude Code's tools reference:
// each built-in tool's name, what it does, and whether Manual mode asks before using it.
import { writeFileSync } from "node:fs";

const SOURCE = "https://code.claude.com/docs/en/tools-reference.md";

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE}: ${response.status}`);
const text = await response.text();

/** Markdown links become their text; "See …" pointers to other pages are dropped. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/;\s*see [^.|]*(?=\.|$)/g, "")
    .replace(/(^|\.)\s*See [^.|]*(\.|$)/g, "$1")
    .replace(/\\\|/g, "|")
    .trim();
}

const tools: Array<{ name: string; description: string; asks: boolean }> = [];
for (const match of text.matchAll(/^\| `([A-Za-z]+)` \| (.+) \| (Yes|No) \|$/gm)) {
  const [, name = "", description = "", asks = ""] = match;
  tools.push({ name, description: plain(description), asks: asks === "Yes" });
}
if (tools.length < 30)
  throw new Error(`Only ${tools.length} tools parsed from ${SOURCE}; the page format changed.`);

const out = new URL("../src/shared/builtin-tools.json", import.meta.url);
writeFileSync(
  out,
  `${JSON.stringify({ $comment: `From the tool table at ${SOURCE}`, tools }, null, 2)}\n`
);
console.log(`Wrote ${tools.length} built-in tools`);
