import { lazy, type ReactNode, Suspense, useState } from "react";
import { type Scope, type Visibility } from "../../shared/types.ts";
import { api, errorText } from "../api.ts";
import { sharedWithAgents, tilde } from "../format.ts";
import { Icon } from "../Icon.tsx";

/** The name cell holds the row's focusable control, so keyboard users can reach every row. */
export function NameButton({
  children,
  onClick,
  current,
}: {
  children: ReactNode;
  onClick: () => void;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      className="row-name"
      aria-current={current ? "true" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** The symlink mark after a name; a link into ~/.agents says so, since other agents read it too. */
export function LinkMark({ realPath }: { realPath: string | undefined }) {
  if (!realPath) return null;
  if (sharedWithAgents(realPath))
    return (
      <span
        className="flag via-agents"
        title={`Links to ${tilde(realPath)}; other agents read ~/.agents too`}
      >
        <Icon name="link" /> ~/.agents
      </span>
    );
  return (
    <span className="via" title={`Links to ${tilde(realPath)}`}>
      <Icon name="link" />
    </span>
  );
}

const VISIBILITY: Record<Visibility, string> = {
  tracked: "tracked in git",
  untracked: "untracked",
  ignored: "git-ignored",
  "no-git": "outside git",
};

/** Who sees a file: everyone who clones the repository, only you, or your organisation. */
export function VisibilityTag({ value, scope }: { value: Visibility | undefined; scope: Scope }) {
  if (scope === "managed") return <span className="vis vis-personal">organisation</span>;
  // Files outside any project, under ~/.claude, are yours alone.
  if (!value) return <span className="vis vis-personal">only you</span>;
  return <span className={`vis vis-${value}`}>{VISIBILITY[value]}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function PathValue({ path }: { path: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const show = (text: string, ms: number) => {
    setStatus(text);
    setTimeout(() => setStatus(null), ms);
  };
  return (
    <span className="path">
      <span className="mono">{tilde(path)}</span>
      <button
        type="button"
        className="icon-button small"
        aria-label="Copy path"
        onClick={() => {
          navigator.clipboard.writeText(path).then(
            () => show("copied", 1200),
            () => show("could not copy", 2400)
          );
        }}
      >
        <Icon name="copy" />
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label="Open in editor"
        title="Open in editor"
        onClick={() => {
          api.open(path).then(
            ({ editor }) => show(`opened with ${editor}`, 2400),
            (error: unknown) => show(errorText(error), 6000)
          );
        }}
      >
        <Icon name="open" />
      </button>
      {status && (
        <span className="copied" role="status">
          {status}
        </span>
      )}
    </span>
  );
}

export function Contents({ text, markdown = true }: { text: string; markdown?: boolean }) {
  const [raw, setRaw] = useState(!markdown);
  return (
    <section className="contents">
      <div className="contents-bar">
        <span>Contents</span>
        {markdown && (
          <fieldset className="segmented small" aria-label="Contents view">
            <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
              <Icon name="eye" /> Read
            </button>
            <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
              <Icon name="code" /> Raw
            </button>
          </fieldset>
        )}
      </div>
      {raw ? <pre className="raw">{text}</pre> : <Prose text={text} gfm />}
    </section>
  );
}

const MarkdownText = lazy(() => import("../MarkdownText.tsx"));

/** Markdown in the page's prose style. The renderer comes from this server, so it shows at once. */
export function Prose({
  text,
  className = "prose",
  gfm = false,
  linksInNewTab = false,
}: {
  text: string;
  className?: string;
  gfm?: boolean;
  linksInNewTab?: boolean;
}) {
  return (
    <div className={className}>
      <Suspense fallback={null}>
        <MarkdownText text={text} gfm={gfm} linksInNewTab={linksInNewTab} />
      </Suspense>
    </div>
  );
}

export function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
