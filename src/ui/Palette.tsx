import { useEffect, useMemo, useRef, useState } from "react";
import { type Overview } from "../shared/types.ts";
import { Bullet } from "./Bullet.tsx";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { sectionOf } from "./sections/index.ts";
import { type Row } from "./sections/types.ts";

type Result =
  | { kind: "dir"; key: string; label: string; path: string }
  | { kind: "row"; key: string; label: string; row: Row }
  | { kind: "memory"; key: string; label: string; projectPath: string; path: string };

interface Props {
  overview: Overview | null;
  rows: Row[];
  onClose: () => void;
  onOpenDirectory: (path: string | null) => void;
  onSelectRow: (id: string) => void;
  onOpenMemory: (projectPath: string, path: string) => void;
}

/** Jump to any directory, any row in the current one, or a memory saved for any directory. */
export function Palette({
  overview,
  rows,
  onClose,
  onOpenDirectory,
  onSelectRow,
  onOpenMemory,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    document.getElementById(`pal-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const dirs: Result[] = (overview?.projects ?? [])
      .filter((p) => !p.ephemeral && (!q || p.path.toLowerCase().includes(q)))
      .map((p) => ({ kind: "dir", key: `dir:${p.path}`, label: tilde(p.path), path: p.path }));
    const items: Result[] = rows
      .filter((r) => q && sectionOf(r.section).text(r).toLowerCase().includes(q))
      .map((r) => ({ kind: "row", key: r.id, label: sectionOf(r.section).label(r), row: r }));
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
        label: `memory ${m.name} · ${tilde(m.projectPath)}`,
        projectPath: m.projectPath,
        path: m.path,
      }));
    return [...items, ...memories, ...dirs].slice(0, 40);
  }, [query, overview, rows]);

  const choose = (result: Result | undefined) => {
    if (!result) return;
    if (result.kind === "dir") onOpenDirectory(result.path);
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
        aria-label="Jump to"
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
            placeholder="Jump to a directory, file, setting or memory"
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
            <div className="palette-empty">
              {query.trim()
                ? `Nothing matches “${query}”.`
                : "Type to search directories, files, settings and memories."}
            </div>
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
              {r.kind === "row" ? (
                r.row.line ? (
                  <Bullet line={r.row.line} />
                ) : (
                  <Icon name="command" />
                )
              ) : r.kind === "memory" ? (
                <Bullet line="memory" />
              ) : (
                <Icon name="folder" />
              )}
              <span className={r.kind === "dir" ? "mono" : ""}>{r.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
