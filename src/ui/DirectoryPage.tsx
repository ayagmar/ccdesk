import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Change, type DirectoryView, type Overview } from "../shared/types.ts";
import { api } from "./api.ts";
import { ContextView } from "./ContextView.tsx";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { Inspector } from "./Inspector.tsx";
import { groupRows, isFiltered, PAGE } from "./list.ts";
import { RouteStrip, SharingStrip } from "./RouteStrip.tsx";
import { type Saved } from "./SettingEditor.tsx";
import { SECTIONS } from "./sections/index.ts";
import { type Actions, type Adding, type Row, type SectionId } from "./sections/types.ts";
import { Timetable } from "./Timetable.tsx";
import { type ToastMessage } from "./Toast.tsx";
import { type ListState, NO_LIST_STATE, readListState, replaceListState } from "./url.ts";
import { errorText } from "./useConfig.ts";

interface Props {
  view: DirectoryView;
  overview: Overview | null;
  rows: Row[];
  /** A row to show, from the palette or another page; a new object each time it is asked for. */
  jump: { id: string } | null;
  /** Called once a jump is handled, so a later visit to this page does not repeat it. */
  onJumped: () => void;
  reload: () => void;
  onToast: (toast: ToastMessage) => void;
  onOpenDirectory: (path: string) => void;
  onOpenPalette: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** One directory: its config as tables, or what Claude sees at session start, with the inspector. */
export function DirectoryPage({
  view,
  overview,
  rows,
  jump,
  onJumped,
  reload,
  onToast,
  onOpenDirectory,
  onOpenPalette,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  /** Show what Claude reads at session start instead of the tables. */
  const [seeing, setSeeing] = useState(false);
  const [list, setList] = useState<ListState>(readListState);
  const [shown, setShown] = useState<Partial<Record<SectionId, number>>>({});
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => replaceListState({ kind: "directory", dir: view.path }, list), [list, view.path]);
  const changeList = (next: ListState) => {
    setList(next);
    setShown({});
  };

  const groups = useMemo(() => groupRows(SECTIONS, rows, list, shown), [rows, list, shown]);
  const visible = useMemo(() => groups.flatMap((g) => g.shown), [groups]);
  const filtered = isFiltered(list);
  const selectedRow = rows.find((r) => r.id === selected) ?? null;

  const select = useCallback((id: string, focus = false) => {
    setAdding(null);
    setSelected(id);
    requestAnimationFrame(() => {
      const row = document.getElementById(`row-${id}`);
      row?.scrollIntoView({ block: "nearest" });
      // Keyboard moves focus with the selection, so Enter and Tab continue from the selected row.
      if (focus) row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  }, []);

  // With room for the inspector, open on the first file Claude loads instead of a blank panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the page first shows.
  useEffect(() => {
    if (jump || !matchMedia("(min-width: 1181px)").matches) return;
    const first = view.instructions.find((i) => i.status === "loaded");
    if (first) setSelected(`ins:${first.path}`);
  }, []);

  // A row asked for from elsewhere is shown even if the filters or paging hid it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each jump is handled once, when asked for.
  useEffect(() => {
    if (!jump) return;
    const row = rows.find((r) => r.id === jump.id);
    if (!row) return;
    onJumped();
    setSeeing(false);
    const group = groups.find((g) => g.section.id === row.section);
    if (group && !group.matching.includes(row)) changeList(NO_LIST_STATE);
    else if (group && !group.shown.includes(row))
      setShown((s) => ({ ...s, [row.section]: group.matching.indexOf(row) + PAGE }));
    requestAnimationFrame(() => select(jump.id));
  }, [jump]);

  useEffect(() => {
    const jumpTo = (id: string | undefined) =>
      id && document.getElementById(`section-${id}`)?.scrollIntoView({ block: "start" });
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setSeeing(false);
        requestAnimationFrame(() => filterInput.current?.focus());
      } else if ((e.key === "j" || e.key === "k") && !seeing) {
        const index = visible.findIndex((r) => r.id === selected);
        const next = visible[e.key === "j" ? index + 1 : Math.max(index - 1, 0)] ?? visible[0];
        if (next) select(next.id, true);
      } else if (/^[1-9]$/.test(e.key) && !seeing) {
        jumpTo(SECTIONS[Number(e.key) - 1]?.id);
      } else if (e.key === "Escape") {
        setSelected(null);
        setAdding(null);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [visible, selected, select, seeing]);

  const undo = useCallback(
    async (change: Change) => {
      try {
        await api.restore(change.id, change.revision);
        const name = change.target.split(/[/\\]/).pop();
        onToast({ text: change.created ? `Removed ${name}` : `Put ${name} back` });
      } catch (error) {
        onToast({ text: `Could not undo: ${errorText(error)}. Recent changes keeps the backup.` });
      }
      reload();
    },
    [onToast, reload]
  );

  const saved = useCallback(
    ({ change, message, select }: Saved) => {
      setAdding(null);
      if (select !== undefined) setSelected(select);
      onToast({ text: message, ...(change ? { undo: () => undo(change) } : {}) });
      reload();
    },
    [onToast, reload, undo]
  );

  const actions = useMemo<Actions>(
    () => ({
      view,
      overview,
      sharedNames: new Set(overview?.sharedMemories.map((s) => s.name) ?? []),
      onOpenDirectory,
      onAdd: (what) => {
        setSelected(null);
        setAdding(what);
      },
      onSaved: saved,
      onChange: async (run, message, select) => {
        try {
          saved({ change: await run(), message, ...(select === undefined ? {} : { select }) });
        } catch (error) {
          onToast({ text: `Could not do that: ${errorText(error)}` });
          reload();
        }
      },
    }),
    [view, overview, onOpenDirectory, saved, onToast, reload]
  );

  const { trust } = view;
  return (
    <div className={`workspace${selectedRow || adding ? "" : " no-details"}`}>
      <div className="work-main">
        <header className="dir-head">
          <div className="dir-title">
            <h1 className="mono" title={tilde(view.path)}>
              {tilde(view.path)}
            </h1>
            {!view.exists && <span className="flag bad">folder no longer exists</span>}
            {view.gitRoot && view.gitRoot !== view.path && (
              <span className="flag">inside {tilde(view.gitRoot)}</span>
            )}
            {trust.sessionOnly ? (
              <span
                className="flag"
                title="In your home directory Claude Code asks for trust each session and saves no answer."
              >
                trust asked each session
              </span>
            ) : (
              !trust.trusted && (
                <span
                  className="flag warn"
                  title={`Until you accept Claude Code's trust dialog for ${tilde(trust.root)}, its allow rules, extra folders and .mcp.json approvals wait.${trust.inheritedFrom ? ` You trusted ${tilde(trust.inheritedFrom)}, which covers some of this but not those grants.` : ""}`}
                >
                  not trusted yet
                </span>
              )
            )}
          </div>
          <div className="toolbar">
            <fieldset className="segmented view-switch" aria-label="View">
              <button type="button" aria-pressed={!seeing} onClick={() => setSeeing(false)}>
                Config
              </button>
              <button type="button" aria-pressed={seeing} onClick={() => setSeeing(true)}>
                <Icon name="eye" /> What Claude sees
              </button>
            </fieldset>
            <label className={`filter${seeing ? " hidden" : ""}`}>
              <Icon name="search" />
              <input
                ref={filterInput}
                value={list.query}
                onChange={(e) => changeList({ ...list, query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  changeList({ ...list, query: "" });
                  e.currentTarget.blur();
                }}
                placeholder="Filter rows"
                aria-label="Filter rows"
              />
              <kbd>/</kbd>
            </label>
            <button
              type="button"
              className="palette-button"
              aria-label="Jump to"
              onClick={onOpenPalette}
            >
              <span className="palette-label">Jump to</span> <kbd>Ctrl K</kbd>
            </button>
          </div>
          <nav className={`section-index${seeing ? " hidden" : ""}`} aria-label="Sections">
            {groups.map(({ section, all }, index) => (
              <a
                key={section.id}
                href={`#section-${section.id}`}
                className={all.length === 0 ? "empty" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(`section-${section.id}`)
                    ?.scrollIntoView({ block: "start" });
                }}
              >
                <kbd>{index + 1}</kbd> {section.short ?? section.title}
                <span className="seg-count">{all.length}</span>
              </a>
            ))}
          </nav>
        </header>
        {view.problems.length > 0 && (
          <section className="problems" role="alert" aria-label="Files ccdesk could not read">
            <Icon name="warn" />
            <ul className="plain">
              {view.problems.map((p) => (
                <li key={p.path}>
                  <span className="mono">{tilde(p.path)}</span>: {p.error}.{" "}
                  {p.blocksStart
                    ? "Claude Code refuses to start until your organisation's settings are fixed, so nothing below applies yet."
                    : "Claude Code may skip this file."}
                </li>
              ))}
            </ul>
          </section>
        )}
        {seeing ? (
          <ContextView view={view} />
        ) : (
          <>
            <RouteStrip
              view={view}
              lit={selectedRow?.line ?? null}
              filter={list.line}
              onFilter={(line) => changeList({ ...list, line })}
            />
            <SharingStrip view={view} />
            <Timetable
              groups={groups}
              actions={actions}
              state={list}
              selected={selected}
              onSelect={select}
              onSort={(section, sort) =>
                setList({ ...list, sort: { ...list.sort, [section]: sort } })
              }
              onOnly={(section, value) =>
                changeList({ ...list, only: { ...list.only, [section]: value } })
              }
              onShowMore={(section) =>
                setShown((s) => ({ ...s, [section]: (s[section] ?? PAGE) + PAGE }))
              }
              filtered={filtered}
            />
            {filtered && visible.length === 0 && (
              <p className="tt-empty">
                Nothing matches.{" "}
                <button type="button" className="link" onClick={() => changeList(NO_LIST_STATE)}>
                  Clear filters
                </button>
              </p>
            )}
          </>
        )}
      </div>
      <Inspector
        row={selectedRow}
        adding={adding}
        actions={actions}
        onClose={() => {
          setSelected(null);
          setAdding(null);
        }}
      />
    </div>
  );
}
