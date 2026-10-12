// The Markdown versions of the docs pages, for /<page>.md, /llms.txt and /llms-full.txt. They are
// made from the same source files as the HTML pages, so they cannot drift from them.
import { type CollectionEntry, getCollection } from "astro:content";
import { DOC_GROUPS } from "./docs-order.ts";

export type Doc = CollectionEntry<"docs">;

/** What ccdesk is, in one paragraph: the summary in llms.txt and llms-full.txt. */
export const SUMMARY =
  "ccdesk is a local web app, started with `npx ccdesk`, that shows and edits everything that shapes Claude Code on one machine: instruction files (CLAUDE.md, AGENTS.md, rules and imports), settings at every scope, permission rules, hooks, MCP servers, subagents, skills, plugins, output styles and auto memory. For the directory it is started in, it lists each piece in the order Claude Code loads it and names the file it comes from. Every edit is shown as a diff first and backed up, and can be undone from Recent changes. It listens on 127.0.0.1 only and sends nothing off the machine.";

/** The docs pages in sidebar order, with their group. */
export async function docsInOrder(): Promise<{ group: string; doc: Doc }[]> {
  const docs = new Map((await getCollection("docs")).map((doc) => [doc.id, doc]));
  return DOC_GROUPS.flatMap(({ label, items }) =>
    items.map((id) => {
      const doc = docs.get(id);
      if (!doc) throw new Error(`docs-order.ts lists ${id}, which has no page`);
      return { group: label, doc };
    })
  );
}

/** An absolute URL for a path under the site's base, such as `settings/` or `llms.txt`. */
export function siteUrl(site: URL, path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, site).href;
}

/**
 * A page as Markdown: its title and description, then its body without MDX imports and
 * screenshots. Links to other pages (`../settings/`) become absolute so the text works on its own.
 */
export function docMarkdown(doc: Doc, site: URL): string {
  const body = (doc.body ?? "")
    .split("\n")
    .filter((line) => !/^import\s.+from\s/.test(line) && !/^\s*<Screenshot\b.*\/>\s*$/.test(line))
    .join("\n")
    .replace(/\]\(\.\.\/([^)\s]*)\)/g, (_, path: string) => `](${siteUrl(site, path)})`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const { title, description } = doc.data;
  return `# ${title}\n\n${description ? `> ${description}\n\n` : ""}${body}\n`;
}
