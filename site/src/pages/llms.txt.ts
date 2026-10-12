// The llms.txt index (https://llmstxt.org): the title, a summary, then each docs page's Markdown.
import { type APIRoute } from "astro";
import { docsInOrder, SUMMARY, siteUrl } from "../docs-text.ts";

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error("astro.config.ts must set `site`.");
  const lines = ["# ccdesk", "", `> ${SUMMARY}`, ""];
  let group = "";
  for (const { group: label, doc } of await docsInOrder()) {
    if (label !== group) lines.push(...(group ? [""] : []), `## ${label}`, "");
    group = label;
    const note = doc.data.description ? `: ${doc.data.description}` : "";
    lines.push(`- [${doc.data.title}](${siteUrl(site, `${doc.id}.md`)})${note}`);
  }
  lines.push(
    "",
    "## Optional",
    "",
    `- [All docs in one file](${siteUrl(site, "llms-full.txt")})`,
    "- [Source code](https://github.com/ayagmar/ccdesk)",
    ""
  );
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
