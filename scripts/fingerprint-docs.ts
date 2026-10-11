// Fingerprints every docs section the code cites as `docs: page#anchor`, so a change to the Claude
// Code behaviour ccdesk mirrors by hand (rule precedence, wrappers, trust) shows up as a diff of
// scripts/docs-fingerprints.json. Prints the sections that changed, with the files that cite them.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const DOCS = "https://code.claude.com/docs/en";
const ROOT = join(import.meta.dirname, "..");
const OUT = join(import.meta.dirname, "docs-fingerprints.json");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Each cited `page#anchor`, with the files that cite it. A citation may wrap across comment lines. */
function citations(): Map<string, Set<string>> {
  const cited = new Map<string, Set<string>>();
  for (const file of sourceFiles(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    // `docs:` then page#anchor references, separated only by commas, spaces and comment markers.
    for (const match of text.matchAll(/docs:((?:[\s*/,]*[a-z0-9-]+#[a-z0-9-]+)+)/g))
      for (const ref of (match[1] ?? "").matchAll(/([a-z0-9-]+)#([a-z0-9-]+)/g)) {
        const key = `${ref[1]}#${ref[2]}`;
        cited.set(key, (cited.get(key) ?? new Set()).add(relative(ROOT, file)));
      }
  }
  return cited;
}

/** The anchor the docs site gives a heading. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Each section of a page by anchor: a heading up to the next heading at its level or above, or an
 * anchor placed in the text (`<span id>`) up to the next heading.
 */
function sections(markdown: string): Map<string, string> {
  const lines = markdown.split("\n");
  const headings: Array<{ line: number; level: number; anchor: string }> = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    const md = /^(#{1,6}) (.+)$/.exec(line);
    const html = /^<h([1-6]) id="([^"]+)"/.exec(line);
    const span = /^<span id="([^"]+)"/.exec(line);
    if (md) headings.push({ line: index, level: md[1]?.length ?? 0, anchor: slug(md[2] ?? "") });
    else if (html) headings.push({ line: index, level: Number(html[1]), anchor: html[2] ?? "" });
    else if (span) headings.push({ line: index, level: 7, anchor: span[1] ?? "" });
  });
  const out = new Map<string, string>();
  headings.forEach((h, i) => {
    const end = headings.slice(i + 1).find((next) => next.level <= h.level)?.line ?? lines.length;
    out.set(h.anchor, lines.slice(h.line, end).join("\n"));
  });
  return out;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

let previous: Record<string, string> = {};
try {
  previous = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, string>;
} catch {
  // First run: every section is new.
}

/**
 * A page's sections; null when it could not be fetched (a network error or a server error), so
 * an outage changes nothing. A page that is not found leaves its sections "missing", so the pull
 * request still opens and says so.
 */
async function page(name: string): Promise<Map<string, string> | null> {
  try {
    const response = await fetch(`${DOCS}/${name}.md`);
    if (response.ok) return sections(await response.text());
    if (response.status === 404 || response.status === 410) return new Map();
    console.error(`${DOCS}/${name}.md: ${response.status}; kept the earlier fingerprints`);
  } catch (error) {
    console.error(`${DOCS}/${name}.md: ${String(error)}; kept the earlier fingerprints`);
  }
  return null;
}

const cited = citations();
const pages = new Map<string, Map<string, string> | null>();
for (const name of new Set([...cited.keys()].map((key) => key.split("#")[0] ?? "")))
  pages.set(name, await page(name));

const next: Record<string, string> = {};
for (const key of [...cited.keys()].sort()) {
  const [name = "", anchor = ""] = key.split("#");
  const sectionsOf = pages.get(name);
  const text = sectionsOf?.get(anchor);
  // A page that could not be fetched keeps its fingerprints; a section first cited during the
  // outage waits for the next run rather than showing up as gone.
  if (sectionsOf === null) {
    const kept = previous[key];
    if (kept !== undefined) next[key] = kept;
  } else next[key] = text === undefined ? "missing" : fingerprint(text);
}
writeFileSync(OUT, `${JSON.stringify(next, null, 2)}\n`);

for (const [key, value] of Object.entries(next)) {
  if (previous[key] === value) continue;
  const what =
    value === "missing" ? "is gone" : previous[key] === undefined ? "is newly cited" : "changed";
  console.log(
    `- [\`${key}\`](${DOCS}/${key}) ${what}; cited in ${[...(cited.get(key) ?? [])].map((f) => `\`${f}\``).join(", ")}`
  );
}
