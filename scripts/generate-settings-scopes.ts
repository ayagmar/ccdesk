// Regenerates two files from Claude Code's settings reference:
// - src/shared/settings-scopes.json, the Scope column of the settings index. The SDK's Settings type
//   does not say which files a key is read from, so this table is the only source for "Claude Code
//   ignores this key here".
// - src/shared/settings-catalog.json, every documented key with its summary, category, type,
//   default and description, for the catalog of settings you have not set.
import { writeFileSync } from "node:fs";

const SOURCE = "https://code.claude.com/docs/en/settings-reference.md";
const SITE = "https://code.claude.com";
type Scope = "managed" | "user" | "project" | "local";

const SCOPES: Record<string, Scope[]> = {
  "Any file": ["managed", "user", "project", "local"],
  "User, local, or managed": ["managed", "user", "local"],
  "User or managed": ["managed", "user"],
  User: ["user"],
  Managed: ["managed"],
  // Read from ~/.claude.json only; in a settings file the key does nothing.
  "Global config": [],
};

interface CatalogEntry {
  summary: string;
  category: string;
  scopes: Scope[];
  /** The opening paragraphs of the key's own section. */
  about?: string;
  /** The Type line with its list of values, as Markdown. */
  type?: string;
  default?: string;
  docs: string;
}

/**
 * Links in the page are site-relative or page anchors; the catalog shows them on their own. The
 * docs' callout components (`<Warning>` and the like) become a bold label, since the catalog
 * renders Markdown without HTML.
 */
function absolute(markdown: string): string {
  return markdown
    .replace(/\]\(\/docs\//g, `](${SITE}/docs/`)
    .replace(/\]\(#/g, `](${SITE}/docs/en/settings-reference#`)
    .replace(/<(Warning|Note|Tip|Info|Check)>\s*/g, (_, name: string) => `**${name}:** `)
    .replace(/\s*<\/(Warning|Note|Tip|Info|Check)>/g, "");
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE}: ${response.status}`);
const text = await response.text();

const limited: Record<string, Scope[]> = {};
const catalog: Record<string, CatalogEntry> = {};
let rows = 0;
for (const match of text.matchAll(
  /^\| \[`([^`]+)`\]\(#([^)]*)\) \| (.*) \| ([^|]+?) \| ([^|]+?) \|$/gm
)) {
  const [, key = "", anchor = "", summary = "", category = "", column = ""] = match;
  const scopes = SCOPES[column.trim()];
  if (!scopes) throw new Error(`Unknown scope "${column}" for ${key}`);
  rows++;
  catalog[key] = {
    summary: absolute(summary.trim()),
    category: category.trim(),
    scopes,
    docs: `${SITE}/docs/en/settings-reference#${anchor}`,
  };
  // Nested keys (sandbox.ripgrep) can't be told apart at the top level, so only top-level keys count.
  if (key.includes(".") || scopes.length === 4) continue;
  limited[key] = scopes;
}
if (rows < 100)
  throw new Error(`Only ${rows} rows parsed from ${SOURCE}; the page format changed.`);

// Each key's own section: opening paragraphs, then "* **Scope**", "* **Type**", "* **Default**".
const sections = text.split(/^### `([^`]+)`$/m);
for (let i = 1; i < sections.length; i += 2) {
  const entry = catalog[sections[i] ?? ""];
  if (!entry) continue;
  const body = (sections[i + 1] ?? "").split(/^#{2,3} /m)[0] ?? "";
  const lines = body.split("\n");
  // The facts list, not a bulleted list inside the description, ends the opening paragraphs.
  const firstFact = lines.findIndex((line) => /^\* \*\*(Scope|Type|Default)\*\*:/.test(line));
  const about = lines
    .slice(0, firstFact < 0 ? lines.length : firstFact)
    .join("\n")
    .trim();
  if (about) entry.about = absolute(about);
  const fact = (name: string) => {
    const start = lines.findIndex((line) => line.startsWith(`* **${name}**:`));
    if (start < 0) return;
    const block = [lines[start]?.slice(`* **${name}**:`.length).trim() ?? ""];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith("  ")) break;
      block.push(line.slice(2));
    }
    return absolute(block.join("\n").trim());
  };
  const type = fact("Type");
  if (type) entry.type = type;
  const fallback = fact("Default");
  if (fallback) entry.default = fallback;
}

const write = (name: string, data: unknown) => {
  const out = new URL(`../src/shared/${name}`, import.meta.url);
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
};
write("settings-scopes.json", { $comment: `From the settings index at ${SOURCE}`, limited });
write("settings-catalog.json", { $comment: `From ${SOURCE}`, keys: catalog });
console.log(
  `Wrote ${Object.keys(limited).length} scope-limited keys and ${Object.keys(catalog).length} catalog entries from ${rows} rows`
);
