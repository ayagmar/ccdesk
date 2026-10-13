import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown as the page renders it. The renderer is most of the page's script, so this module is
 * loaded only when a file's contents or a setting's docs are shown (see Prose in sections/kit.tsx).
 * react-markdown never renders raw HTML, so a cloned repo's AGENTS.md cannot inject script here.
 */
export default function MarkdownText({
  text,
  gfm = false,
  linksInNewTab = false,
}: {
  text: string;
  /** GitHub's tables, task lists and autolinks, as instruction files use them. */
  gfm?: boolean;
  /** For docs text, whose links leave the page. */
  linksInNewTab?: boolean;
}) {
  return (
    <Markdown
      remarkPlugins={gfm ? [remarkGfm] : []}
      components={
        linksInNewTab
          ? {
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }
          : {}
      }
    >
      {text}
    </Markdown>
  );
}
