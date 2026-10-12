// Every docs page as Markdown in one file, in sidebar order.
import { type APIRoute } from "astro";
import { docMarkdown, docsInOrder, SUMMARY, siteUrl } from "../docs-text.ts";

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error("astro.config.ts must set `site`.");
  const pages = (await docsInOrder()).map(
    ({ doc }) => `${docMarkdown(doc, site)}\nSource: ${siteUrl(site, `${doc.id}/`)}\n`
  );
  const text = [`# ccdesk\n\n> ${SUMMARY}\n`, ...pages].join("\n---\n\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
