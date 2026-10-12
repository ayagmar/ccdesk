import { type APIRoute, type GetStaticPaths } from "astro";
import { type Doc, docMarkdown, docsInOrder } from "../docs-text.ts";

export const getStaticPaths = (async () =>
  (await docsInOrder()).map(({ doc }) => ({
    params: { slug: doc.id },
    props: { doc },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ doc: Doc }> = ({ props, site }) => {
  if (!site) throw new Error("astro.config.ts must set `site`.");
  return new Response(docMarkdown(props.doc, site), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
