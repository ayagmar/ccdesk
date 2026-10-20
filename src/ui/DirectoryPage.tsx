import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Change,
  type DirectoryView,
  type Overview,
  type SessionProfile,
} from "../shared/types.ts";
import { api, errorText } from "./api.ts";
import { ContextView } from "./ContextView.tsx";
import { ForgetReview } from "./ForgetReview.tsx";
import { plural, tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { Inspector } from "./Inspector.tsx";
import { type Group, groupRows, isFiltered, PAGE } from "./list.ts";
import { RouteStrip, SharingStrip } from "./RouteStrip.tsx";
import { type Following } from "./useConfig.ts";
import { type Saved } from "./useReviewedChange.tsx";
import { SECTIONS } from "./sections/index.ts";
import { type Row, type SectionId } from "../view/sections/types.ts";
import { type Actions, type Adding } from "./sections/types.ts";
import { Timetable } from "./Timetable.tsx";
import { type ToastMessage } from "./Toast.tsx";
import { type ListState, NO_LIST_STATE, readListState, replaceListState } from "./url.ts";

interface Props {
  view: DirectoryView;
  overview: Overview | null;
  rows: Row[];
  /** A row to show, from the palette or another page; a new object each time it is asked for. */
  jump: { id: string } | null;
  /** Called once a jump is handled, so a later visit to this page does not repeat it. */
  onJumped: () => void;
  reload: () => void;
  /** The folders ccdesk cannot watch here, and whether its server answers. */
  following: Following;
  onToast: (toast: ToastMessage) => void;
  /** Called with the toast's text once this directory, its folder gone, is forgotten. */
  onForgotten: (text: string) => void;
  onOpenDirectory: (path: string) => void;
  onOpenPalette: () => void;
  /** Describe an interactive session or claude -p and the SDK instead. */
  onProfile: (profile: SessionProfile) => void;
  /** Asks for another directory to compare `dir` with. */
  onCompare: (dir: string) => void;
}

/**
 * After the inspector closes, focus goes back where the reader was: the selected row's name, or the
 * "Add …" button that opened the form. When that is not listed, it goes to the row's section
 * heading, and when a filter hides the whole section, to the filter box.
 */
function refocus(
  closed: { row: string; section: SectionId } | { adding: Adding } | null,
  filter: HTMLInputElement | null
) {
  requestAnimationFrame(() => {
    let target: HTMLElement | null = null;
    if (closed && "row" in closed)
      target =
        document.getElementById(`row-${closed.row}`)?.querySelector<HTMLElement>(".row-name") ??
        document.getElementById(`h-${closed.section}`);
    else if (closed) target = document.querySelector<HTMLElement>(`[data-adds="${closed.adding}"]`);
    (target ?? filter)?.focus({ preventScroll: true });
  });
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
  following,
  onToast,
  onForgotten,
  onOpenDirectory,
  onOpenPalette,
  onProfile,
  onCompare,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [list, setList] = useState<ListState>(readListState);
  const [shown, setShown] = useState<Partial<Record<SectionId, number>>>({});
  const filterInput = useRef<HTMLInputElement>(null);
  const { seeing, setSeeing, configButton, leaveSeeing } = useSeeing();

  useEffect(
    () => replaceListState({ kind: "directory", dir: view.path, profile: view.profile }, list),
    [list, view.path, view.profile]
  );
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
  const reveal = useReveal(jump, onJumped, (id, focus) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return false;
    setSeeing(false);
    const group = groups.find((g) => g.section.id === row.section);
    if (group && !group.matching.includes(row)) changeList(NO_LIST_STATE);
    else if (group && !group.shown.includes(row))
      setShown((s) => ({ ...s, [row.section]: group.matching.indexOf(row) + PAGE }));
    requestAnimationFrame(() => select(id, focus));
    return true;
  });

  const closeInspector = useCallback(() => {
    // With nothing open, Escape leaves focus where it is.
    if (!selected && !adding) return;
    setSelected(null);
    setAdding(null);
    const closed = selectedRow ? { row: selectedRow.id, section: selectedRow.section } : null;
    refocus(adding ? { adding } : closed, filterInput.current);
  }, [selected, selectedRow, adding]);

  useListKeys({
    visible,
    selected,
    select,
    seeing,
    setSeeing,
    leaveSeeing,
    onClose: closeInspector,
    filterInput,
  });

  const actions = usePageActions({
    view,
    overview,
    onOpenDirectory,
    onCompare,
    onToast,
    reload,
    reveal,
    setSelected,
    setAdding,
  });

  return (
    // What Claude sees has no rows to inspect, so the inspector is hidden; it stays mounted, keeping
    // the selection and any draft for when the tables come back.
    <div
      className={`workspace${seeing ? " seeing" : ""}${!seeing && (selectedRow || adding) ? "" : " no-details"}`}
    >
      <div className="work-main">
        <header className="dir-head">
          <DirectoryTitle view={view} />
          <Toolbar
            seeing={seeing}
            onSeeing={setSeeing}
            configButton={configButton}
            query={list.query}
            onQuery={(query) => changeList({ ...list, query })}
            filterInput={filterInput}
            onOpenPalette={onOpenPalette}
          />
          <SectionIndex groups={groups} hidden={seeing} />
        </header>
        <GoneFolder view={view} launchDir={overview?.launchDir ?? null} onForgotten={onForgotten} />
        <SessionSwitch profile={view.profile} onProfile={onProfile} />
        <Problems problems={view.problems} />
        <NotFollowing following={following} />
        <UnreadManagedSources view={view} />
        <ManagedRepairs view={view} />
        {seeing ? (
          <ContextView view={view} onBack={leaveSeeing} />
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
      <Inspector row={selectedRow} adding={adding} actions={actions} onClose={closeInspector} />
    </div>
  );
}

/**
 * Selects a row with `show`, for a jump asked for from elsewhere (handled once) and for the
 * inspector, which also moves focus to the row; the function it returns stays the same across renders.
 */
function useReveal(
  jump: { id: string } | null,
  onJumped: () => void,
  show: (id: string, focus: boolean) => boolean
): (id: string) => void {
  const latest = useRef(show);
  latest.current = show;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each jump is handled once, when asked for.
  useEffect(() => {
    if (jump && latest.current(jump.id, false)) onJumped();
  }, [jump]);
  // The link that asked for the row goes away with the old inspector, so focus follows the row.
  return useCallback((id: string) => void latest.current(id, true), []);
}

/** What the rows and the inspector can do here: open, add, save and change, each with its toast. */
function usePageActions({
  view,
  overview,
  onOpenDirectory,
  onCompare,
  onToast,
  reload,
  reveal,
  setSelected,
  setAdding,
}: Pick<Props, "view" | "overview" | "onOpenDirectory" | "onCompare" | "onToast" | "reload"> & {
  reveal: (id: string) => void;
  setSelected: (id: string | null) => void;
  setAdding: (adding: Adding | null) => void;
}): Actions {
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
    ({ change, message, select: row }: Saved) => {
      setAdding(null);
      if (row !== undefined) setSelected(row);
      onToast({ text: message, ...(change ? { undo: () => undo(change) } : {}) });
      reload();
    },
    [onToast, reload, undo, setAdding, setSelected]
  );

  return useMemo<Actions>(
    () => ({
      view,
      overview,
      sharedNames: new Set(overview?.sharedMemories.map((s) => s.name) ?? []),
      onOpenDirectory,
      onCompare: () => onCompare(view.path),
      onShowRow: reveal,
      onAdd: (what) => {
        setSelected(null);
        setAdding(what);
      },
      onSaved: saved,
      onChange: async (run, message, row) => {
        try {
          saved({ change: await run(), message, ...(row === undefined ? {} : { select: row }) });
        } catch (error) {
          onToast({ text: `Could not do that: ${errorText(error)}` });
          reload();
        }
      },
    }),
    [
      view,
      overview,
      onOpenDirectory,
      onCompare,
      reveal,
      saved,
      onToast,
      reload,
      setSelected,
      setAdding,
    ]
  );
}

/** The directory's path, with whether it exists, its repository and its trust. */
function DirectoryTitle({ view }: { view: DirectoryView }) {
  return (
    <div className="dir-title">
      <h1 className="mono" title={tilde(view.path)}>
        <span>{tilde(view.path)}</span>
      </h1>
      {!view.exists && <span className="flag bad">folder no longer exists</span>}
      {view.gitRoot && view.gitRoot !== view.path && (
        <span className="flag root" title={`inside ${tilde(view.gitRoot)}`}>
          inside {tilde(view.gitRoot)}
        </span>
      )}
      <TrustFlag view={view} />
    </div>
  );
}

/**
 * Whether the page shows what Claude reads at session start instead of the tables, and the way
 * back, which puts focus on the view switch so the keyboard does not start over at the top.
 */
function useSeeing() {
  const [seeing, setSeeing] = useState(false);
  const configButton = useRef<HTMLButtonElement>(null);
  const leaveSeeing = useCallback(() => {
    setSeeing(false);
    requestAnimationFrame(() => configButton.current?.focus());
  }, []);
  return { seeing, setSeeing, configButton, leaveSeeing };
}

/** Config or what Claude sees, the row filter, and the palette button. */
function Toolbar({
  seeing,
  onSeeing,
  configButton,
  query,
  onQuery,
  filterInput,
  onOpenPalette,
}: {
  seeing: boolean;
  onSeeing: (seeing: boolean) => void;
  configButton: RefObject<HTMLButtonElement | null>;
  query: string;
  onQuery: (query: string) => void;
  filterInput: RefObject<HTMLInputElement | null>;
  onOpenPalette: () => void;
}) {
  return (
    <div className="toolbar">
      <fieldset className="segmented view-switch" aria-label="View">
        <button
          type="button"
          ref={configButton}
          aria-pressed={!seeing}
          onClick={() => onSeeing(false)}
        >
          Config
        </button>
        <button type="button" aria-pressed={seeing} onClick={() => onSeeing(true)}>
          <Icon name="eye" /> What Claude sees
        </button>
      </fieldset>
      <label className={`filter${seeing ? " hidden" : ""}`}>
        <Icon name="search" />
        <input
          ref={filterInput}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            onQuery("");
            e.currentTarget.blur();
          }}
          placeholder="Filter rows"
          aria-label="Filter rows"
        />
        <kbd>/</kbd>
      </label>
      <button type="button" className="palette-button" aria-label="Jump to" onClick={onOpenPalette}>
        <span className="palette-label">Jump to</span> <kbd>Ctrl K</kbd>
      </button>
    </div>
  );
}

/**
 * The page's keys outside a text field: / filters, j and k move the selection, 1 to 9 jump to a
 * section, Escape closes the inspector.
 */
function useListKeys({
  visible,
  selected,
  select,
  seeing,
  setSeeing,
  leaveSeeing,
  onClose,
  filterInput,
}: {
  visible: Row[];
  selected: string | null;
  select: (id: string, focus?: boolean) => void;
  seeing: boolean;
  setSeeing: (seeing: boolean) => void;
  /** Leaves What Claude sees and puts focus on the view switch. */
  leaveSeeing: () => void;
  /** Closes the inspector. */
  onClose: () => void;
  filterInput: RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        // Escape leaves What Claude sees first; the inspector, hidden there, keeps what it holds.
        if (seeing) {
          leaveSeeing();
          return;
        }
        onClose();
      } else if (e.key === "/") {
        e.preventDefault();
        setSeeing(false);
        requestAnimationFrame(() => filterInput.current?.focus());
      } else if (!seeing) moveInTables(e.key, visible, selected, select);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [visible, selected, select, seeing, setSeeing, leaveSeeing, onClose, filterInput]);
}

/** j and k select the next or previous row on screen; 1 to 9 scroll to that section. */
function moveInTables(
  key: string,
  visible: Row[],
  selected: string | null,
  select: (id: string, focus?: boolean) => void
): void {
  if (key === "j" || key === "k") {
    const index = visible.findIndex((r) => r.id === selected);
    const next = visible[key === "j" ? index + 1 : Math.max(index - 1, 0)] ?? visible[0];
    if (next) select(next.id, true);
  } else if (/^[1-9]$/.test(key)) {
    const id = SECTIONS[Number(key) - 1]?.id;
    if (id) document.getElementById(`section-${id}`)?.scrollIntoView({ block: "start" });
  }
}

/** Whether Claude Code trusts this folder yet, and what waits until it does. */
function TrustFlag({ view }: { view: DirectoryView }) {
  const { trust } = view;
  if (trust.sessionOnly)
    return (
      <span
        className="flag"
        title="In your home directory Claude Code asks for trust each session and saves no answer."
      >
        trust asked each session
      </span>
    );
  if (trust.trusted) return null;
  const waits = trust.inheritedFrom
    ? `its allow rules, extra folders and .mcp.json approvals wait. You trusted ${tilde(trust.inheritedFrom)}, which covers hooks but not those grants.`
    : "hooks from every settings file, its allow rules, extra folders and .mcp.json approvals wait.";
  return (
    <span
      className="flag warn"
      title={
        view.profile === "print"
          ? `claude -p and the SDK never show the trust dialog. Until you accept it for ${tilde(trust.root)} in an interactive session, they leave out allow rules and extra folders from repository settings.`
          : `Until you accept Claude Code's trust dialog for ${tilde(trust.root)}, ${waits}`
      }
    >
      not trusted yet
    </span>
  );
}

/** Links to each section, numbered as their keys. */
function SectionIndex({ groups, hidden }: { groups: Group[]; hidden: boolean }) {
  return (
    <nav className={`section-index${hidden ? " hidden" : ""}`} aria-label="Sections">
      {groups.map(({ section, all }, index) => (
        <a
          key={section.id}
          href={`#section-${section.id}`}
          className={all.length === 0 ? "empty" : ""}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`section-${section.id}`)?.scrollIntoView({ block: "start" });
          }}
        >
          <kbd>{index + 1}</kbd> {section.short ?? section.title}
          <span className="seg-count">{all.length}</span>
        </a>
      ))}
    </nav>
  );
}

/** Which kind of session the page describes. */
function SessionSwitch({
  profile,
  onProfile,
}: {
  profile: SessionProfile;
  onProfile: (profile: SessionProfile) => void;
}) {
  return (
    <div className="session-line">
      <span>Describes</span>
      <fieldset
        className="segmented small profile-switch"
        aria-label="Session"
        title="Interactive claude asks for workspace trust and .mcp.json approval. claude -p and the SDK never show the trust dialog: they run settings-file hooks and connect .mcp.json servers without asking."
      >
        {(["interactive", "print"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={profile === p} onClick={() => onProfile(p)}>
            {p === "print" ? "claude -p / SDK" : "interactive session"}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

/** Managed sources ccdesk does not read, above or below the managed settings files it shows. */
function UnreadManagedSources({ view }: { view: DirectoryView }) {
  const layer = view.settings.find((l) => l.scope === "managed");
  const higher = layer?.higherSources;
  const lower = layer?.lowerSources;
  if (!higher && !lower) return null;
  const names = (paths: string[]) =>
    paths.map((path, i) => (
      <span key={path}>
        {i > 0 && " and "}
        <span className="mono">{tilde(path)}</span>
      </span>
    ));
  return (
    <section className="problems" aria-label="Managed settings ccdesk does not read">
      <Icon name="warn" />
      <ul className="plain">
        {higher && (
          <li>
            Your organisation may also set policy in {names(higher)}, which ccdesk does not read.
            Claude Code uses the first managed source that sets a policy, and these come before the
            managed settings files, so the managed values shown here may not apply.{" "}
            <span className="mono">/status</span> in Claude Code names the source it uses.
          </li>
        )}
        {lower && (
          <li>
            The registry key {names(lower)} also holds a policy, which ccdesk does not read. Claude
            Code applies it only when no admin source is present above it: server-managed settings,
            a configuration profile, the HKLM key or the managed settings files.{" "}
            <span className="mono">/status</span> in Claude Code names the source it uses.
          </li>
        )}
      </ul>
    </section>
  );
}

/** Managed settings entries that fail validation, each with what Claude Code does instead and what the file says. */
function ManagedRepairs({ view }: { view: DirectoryView }) {
  const managed = view.settings.find((l) => l.scope === "managed");
  if (!managed?.repairs) return null;
  return (
    <section className="problems" aria-label="Managed settings Claude Code repairs">
      <Icon name="warn" />
      <ul className="plain">
        <li>
          Some managed settings in <span className="mono">{tilde(managed.path)}</span> fail
          validation. ccdesk checks them after merging the drop-in files, and the page shows them as
          Claude Code applies them:
          <ul className="plain">
            {managed.repairs.map((r, i) => (
              // A field can be repaired twice, such as a list that lost an entry and was then withheld.
              // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders.
              <li key={`${r.field}:${i}`}>
                <span className="mono">{r.field}</span> (written as{" "}
                <code>{JSON.stringify(r.written)}</code>) {r.note}.
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </section>
  );
}

/** Says the page may miss a change, while ccdesk cannot watch a folder here or its server is gone. */
function NotFollowing({ following }: { following: Following }) {
  const [first, ...more] = following.unwatched;
  if (following.reachable && first === undefined) return null;
  return (
    <section className="problems" role="status" aria-label="Live updates">
      <Icon name="warn" />
      {first === undefined ? (
        <p>
          ccdesk is not answering, so this page will not update. Check that it is still running in
          your terminal.
        </p>
      ) : (
        <p>
          ccdesk cannot watch <span className="mono">{tilde(first)}</span>
          {more.length > 0 && ` and ${plural(more.length, "other folder")}`}, so this page may not
          update when a file there changes. Other changes still show, and ccdesk tries again after a
          few seconds, then less often while it keeps failing.
        </p>
      )}
    </section>
  );
}

/** What a problem means for the file, after its own message. */
function problemOutcome(p: DirectoryView["problems"][number]): string {
  if (p.blocksStart)
    return "Claude Code refuses to start until your organisation's settings are fixed, so nothing below applies yet.";
  // The message already names both outcomes for the file.
  if (p.partial) return "";
  return "Claude Code may skip this file.";
}

/**
 * Leads a folder that no longer exists with that fact, and with what is left of it. Its project
 * and local files are gone, so the editors offer only your user files (`canWrite`). What Claude
 * Code keeps for it can be forgotten, except for the directory ccdesk was started in.
 */
function GoneFolder({
  view,
  launchDir,
  onForgotten,
}: {
  view: DirectoryView;
  launchDir: string | null;
  onForgotten: (text: string) => void;
}) {
  const [forgetting, setForgetting] = useState(false);
  if (view.exists) return null;
  const memories = view.memory.memories.length;
  return (
    <section className="problems" aria-label="Folder no longer exists">
      <Icon name="warn" />
      <div>
        <p>
          <strong>This folder no longer exists.</strong>{" "}
          {memories > 0 &&
            `Its auto memory is still saved (${plural(memories, "memory", "memories")}).`}
        </p>
        <p>
          The tables show what still applies from your user and managed files. Settings, rules,
          hooks, servers and agents go to your user files only, since writing the folder's own files
          would create it again.
        </p>
        {launchDir !== null &&
          view.path !== launchDir &&
          (forgetting ? (
            <ForgetReview
              path={view.path}
              onForgotten={onForgotten}
              onClose={() => setForgetting(false)}
            />
          ) : (
            <button type="button" className="quiet-danger" onClick={() => setForgetting(true)}>
              <Icon name="trash" /> Forget this directory…
            </button>
          ))}
      </div>
    </section>
  );
}

/** The files ccdesk could not read or parse here: each path on its own line, the message under it. */
function Problems({ problems }: { problems: DirectoryView["problems"] }) {
  if (problems.length === 0) return null;
  return (
    <section className="problems" role="alert" aria-label="Files ccdesk could not read">
      <Icon name="warn" />
      <ul className="plain">
        {problems.map((p) => (
          <li key={p.path}>
            <span className="mono problem-path">{tilde(p.path)}:</span>
            {p.error}. {problemOutcome(p)}
          </li>
        ))}
      </ul>
    </section>
  );
}
