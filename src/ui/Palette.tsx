import { useEffect, useMemo, useRef, useState } from "react";
import { type Overview } from "../shared/types.ts";
import { Bullet } from "./Bullet.tsx";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { pageContext, sectionOf } from "./sections/index.ts";
import { type Row } from "../view/sections/types.ts";

/** A result row: its name, what kind of thing it is, and where it lives when that is elsewhere. */
interface Shown {
  key: string;
  name: string;
  /** The name is a path, so a long one loses its start. */
  isPath: boolean;
  what: string;
  /** Found only in text the row does not show, such as a description. */
  inText?: boolean;
  note?: string;
}

type Result =
  | (Shown & { kind: "dir"; path: string })
  | (Shown & { kind: "row"; row: Row })
  | (Shown & { kind: "memory"; projectPath: string; path: string });

interface Props {
  overview: Overview | null;
  rows: Row[];
  /** Set to pick a directory to compare this one's settings with, instead of jumping. */
  compareFrom?: string | undefined;
  onClose: () => void;
  onOpenDirectory: (path: string | null) => void;
  onSelectRow: (id: string) => void;
  onOpenMemory: (projectPath: string, path: string) => void;
  onCompare: (from: string, to: string) => void;
}

/** A path typed in full: absolute, or under the home folder with ~. */
function typedPath(query: string, home: string | undefined): string | null {
  const q = query.trim();
  if (home && (q === "~" || q.startsWith("~/"))) return home + q.slice(1);
  return q.startsWith("/") || /^[A-Za-z]:[\\/]/.test(q) ? q : null;
}

/**
 * What the query finds: when comparing, other directories and a path typed in full; otherwise rows
 * here, memories of other directories, then directories.
 */
function paletteResults(
  query: string,
  overview: Overview | null,
  rows: Row[],
  compareFrom: string | undefined
): Result[] {
  const q = query.trim().toLowerCase();
  const dirs: Result[] = (overview?.projects ?? [])
    .filter(
      (p) =>
        !p.ephemeral &&
        p.path !== compareFrom &&
        (!q || p.path.toLowerCase().includes(q) || tilde(p.path).toLowerCase().includes(q))
    )
    .map((p) => ({
      kind: "dir",
      key: `dir:${p.path}`,
      name: tilde(p.path),
      isPath: true,
      what: "directory",
      path: p.path,
    }));
  if (compareFrom !== undefined) {
    const typed = typedPath(query, overview?.home);
    const known = dirs.some((d) => d.kind === "dir" && d.path === typed);
    return [
      ...(typed && !known && typed !== compareFrom
        ? [
            {
              kind: "dir" as const,
              key: `typed:${typed}`,
              name: tilde(typed),
              isPath: true,
              what: "directory",
              path: typed,
            },
          ]
        : []),
      ...dirs,
    ].slice(0, 40);
  }
  const items: Result[] = !q
    ? []
    : rows.flatMap((r) => {
        const section = sectionOf(r.section);
        const { kind, name, path: isPath = false } = section.label(r, pageContext());
        // What the row shows is searched too, so a path is found as written with ~.
        const shown = `${kind} ${name}`.toLowerCase().includes(q);
        if (!shown && !section.text(r).toLowerCase().includes(q)) return [];
        return [{ kind: "row", key: r.id, name, isPath, what: kind, inText: !shown, row: r }];
      });
  const here = new Set(rows.map((r) => r.id));
  const memories: Result[] = (overview?.memoryCatalog ?? [])
    .filter(
      (m) =>
        q &&
        !here.has(`mem:${m.path}`) &&
        `${m.name} ${m.description} ${m.type}`.toLowerCase().includes(q)
    )
    .map((m) => ({
      kind: "memory",
      key: `cat:${m.path}`,
      name: m.name,
      isPath: false,
      what: "memory",
      note: tilde(m.projectPath),
      projectPath: m.projectPath,
      path: m.path,
    }));
  return [...items, ...memories, ...dirs].slice(0, 40);
}

function emptyText(query: string, compareFrom: string | undefined): string {
  if (query.trim()) return `Nothing matches “${query}”.`;
  if (compareFrom === undefined) return "Type to search directories, files, settings and memories.";
  return "No other directories yet. Type a full path.";
}

/**
 * A row's bullet, a folder for a directory, and an empty mark for a row from no one scope. A memory's
 * bullet is not read out, since its kind says memory.
 */
function ResultIcon({ result }: { result: Result }) {
  if (result.kind === "memory") return <Bullet line="memory" ariaHidden />;
  if (result.kind === "dir") return <Icon name="folder" />;
  const { line } = result.row;
  if (!line) return <span className="bullet-none" />;
  return <Bullet line={line} ariaHidden={line === "memory"} />;
}

/** Jump to any directory, any row in the current one, or a memory saved for any directory. */
export function Palette({
  overview,
  rows,
  compareFrom,
  onClose,
  onOpenDirectory,
  onSelectRow,
  onOpenMemory,
  onCompare,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    document.getElementById(`pal-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const results = useMemo(
    () => paletteResults(query, overview, rows, compareFrom),
    [query, overview, rows, compareFrom]
  );

  const choose = (result: Result | undefined) => {
    if (!result) return;
    if (result.kind === "dir" && compareFrom !== undefined) onCompare(compareFrom, result.path);
    else if (result.kind === "dir") onOpenDirectory(result.path);
    else if (result.kind === "memory") onOpenMemory(result.projectPath, result.path);
    else onSelectRow(result.row.id);
    onClose();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Escape closes from the input.
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={compareFrom === undefined ? "Jump to" : "Compare settings with"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={
              compareFrom === undefined
                ? "Jump to a directory, file, setting or memory"
                : "Compare settings with a directory, or type its path"
            }
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `pal-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === "Escape") onClose();
              // The input is the dialog's only stop; Tab must not leave it for the page behind.
              else if (e.key === "Tab") e.preventDefault();
            }}
          />
        </label>
        <div id="palette-results" className="palette-results" role="listbox" aria-label="Results">
          {results.length === 0 && (
            <div className="palette-empty">{emptyText(query, compareFrom)}</div>
          )}
          {results.map((r, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys and Enter are handled by the combobox input.
            <div
              key={r.key}
              id={`pal-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <ResultIcon result={r} />
              {r.isPath ? (
                <span className="palette-name mono ends-first">
                  <span>{r.name}</span>
                </span>
              ) : (
                <span className="palette-name mono">{r.name}</span>
              )}
              {r.inText && <span className="palette-why">matches in text</span>}
              {r.note && <span className="palette-note">{r.note}</span>}
              <span className="palette-what">{r.what}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
