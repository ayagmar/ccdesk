import { useState } from "react";
import { type Overview, type ProjectSummary } from "../shared/types.ts";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { SECTIONS } from "./sections/index.ts";

const DOCS = "https://ayagmar.github.io/ccdesk/";

export type TextSize = "smaller" | "default" | "larger";

const TEXT_SIZES: Array<{ size: TextSize; label: string }> = [
  { size: "smaller", label: "Smaller text" },
  { size: "default", label: "Default text size" },
  { size: "larger", label: "Larger text" },
];

interface Props {
  overview: Overview | null;
  /** The open directory; null for all directories, undefined when another page is open. */
  current: string | null | undefined;
  /** The list of directories did not load, so an empty list says nothing. */
  overviewFailed: boolean;
  changesOpen: boolean;
  dark: boolean;
  onOpen: (path: string | null) => void;
  onChanges: () => void;
  onToggleTheme: () => void;
  textSize: TextSize;
  onTextSize: (size: TextSize) => void;
  /** On a wide window the rail is folded to a strip with only the button that opens it again. */
  hidden: boolean;
  onToggleHidden: () => void;
}

function label(path: string, home: string): string {
  return path === home ? "~ (home)" : tilde(path);
}

/**
 * What an empty directory list says: that it failed to load, that what there is sits in the folded
 * groups below, that nothing matches, or that it is empty.
 */
function emptyText(failed: boolean, query: string, folded: number): string {
  if (failed) return "ccdesk could not list your directories.";
  if (folded > 0) return query ? "Only the groups below match." : "Only the groups below.";
  return query ? "No directory matches." : "No other directories yet.";
}

const FOLDED_KEY = "ccdesk-rail-dirs";

/** Whether the main directory list was folded in this browser. */
function readFolded(): string | null {
  try {
    return localStorage.getItem(FOLDED_KEY);
  } catch {
    return null;
  }
}

function rememberFolded(value: "folded" | null) {
  try {
    if (value) localStorage.setItem(FOLDED_KEY, value);
    else localStorage.removeItem(FOLDED_KEY);
  } catch {
    // The fold just won't persist.
  }
}

/** Where you are, named on the phone's rail bar. */
function whereLabel(current: string | null | undefined, changesOpen: boolean, home: string) {
  if (changesOpen) return "Recent changes";
  if (current === null) return "All directories";
  if (typeof current === "string") return label(current, home);
  return "Directories";
}

/** The text size, theme and hide buttons in the brand row. */
function Controls({
  dark,
  onToggleTheme,
  textSize,
  onTextSize,
  hidden,
  onToggleHidden,
}: Pick<
  Props,
  "dark" | "onToggleTheme" | "textSize" | "onTextSize" | "hidden" | "onToggleHidden"
>) {
  return (
    <div className="brand-controls">
      <fieldset className="segmented small text-size" aria-label="Text size">
        {TEXT_SIZES.map(({ size, label: name }) => (
          <button
            key={size}
            type="button"
            className={size}
            aria-label={name}
            title={name}
            aria-pressed={textSize === size}
            onClick={() => onTextSize(size)}
          >
            A
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        className="icon-button theme"
        onClick={onToggleTheme}
        aria-label="Dark theme"
        aria-pressed={dark}
      >
        <Icon name="sun" />
      </button>
      <button
        type="button"
        className="icon-button rail-hide"
        onClick={onToggleHidden}
        aria-expanded={!hidden}
        aria-controls="rail-body"
        aria-label={hidden ? "Show the directory list" : "Hide the directory list"}
        title={hidden ? "Show the directory list" : "Hide the directory list"}
      >
        <Icon name="panel" />
      </button>
    </div>
  );
}

export function Rail({
  overview,
  current,
  overviewFailed,
  changesOpen,
  dark,
  onOpen,
  onChanges,
  onToggleTheme,
  textSize,
  onTextSize,
  hidden,
  onToggleHidden,
}: Props) {
  const [query, setQuery] = useState("");
  // The main list stays as you left it in this browser; a search always shows what it matches.
  const [showRegular, setShowRegular] = useState(() => readFolded() !== "folded");
  // Each folded group follows the open directory until the user folds or unfolds it themselves.
  const [showEphemeral, setShowEphemeral] = useState<boolean>();
  const [showGone, setShowGone] = useState<boolean>();
  // On a phone the rail is one bar; this opens the rest of it over the page.
  const [open, setOpen] = useState(false);
  const projects = overview?.projects ?? [];
  const match = (p: ProjectSummary) => !query || p.path.toLowerCase().includes(query.toLowerCase());
  const launch = projects.find((p) => p.path === overview?.launchDir);
  const listed = projects.filter((p) => p !== launch && match(p));
  const gone = listed.filter((p) => !p.exists);
  const regular = listed.filter((p) => p.exists && !p.ephemeral);
  const ephemeral = listed.filter((p) => p.exists && p.ephemeral);
  // A folded group opens when it holds the open directory, so the row you are on is not hidden.
  const regularOpen = showRegular || query !== "";
  const ephemeralOpen = showEphemeral ?? ephemeral.some((p) => p.path === current);
  const goneOpen = showGone ?? gone.some((p) => p.path === current);

  const item = (p: ProjectSummary) => (
    <li key={p.path}>
      <button
        type="button"
        className={`rail-item${current === p.path ? " current" : ""}${p.exists ? "" : " gone"}`}
        aria-current={current === p.path ? "page" : undefined}
        onClick={() => {
          setOpen(false);
          onOpen(p.path);
        }}
        title={p.exists ? tilde(p.path) : `${tilde(p.path)} (folder no longer exists)`}
      >
        <span className="rail-label">{label(p.path, overview?.home ?? "")}</span>
        {p.memories > 0 && <span className="rail-count">{p.memories}</span>}
      </button>
    </li>
  );

  const here = whereLabel(current, changesOpen, overview?.home ?? "");

  return (
    <nav
      className={`rail${open ? " open" : ""}${hidden ? " hidden" : ""}`}
      aria-label="Directories"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div className="brand">
        <a className="brand-link" href={DOCS} target="_blank" rel="noreferrer" title="ccdesk docs">
          <img src="/logo.png" width="26" height="26" alt="" />
          <span>ccdesk</span>
        </a>
        <button
          type="button"
          className="rail-toggle"
          aria-expanded={open}
          aria-controls="rail-body"
          title={open ? "Close the directory list" : "Open the directory list"}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "close" : "folder"} />
          <span className="rail-label">{here}</span>
        </button>
        <Controls
          dark={dark}
          onToggleTheme={onToggleTheme}
          textSize={textSize}
          onTextSize={onTextSize}
          hidden={hidden}
          onToggleHidden={onToggleHidden}
        />
      </div>
      <div className="rail-body" id="rail-body">
        <button
          type="button"
          className={`rail-item overview-link${current === null ? " current" : ""}`}
          aria-current={current === null ? "page" : undefined}
          onClick={() => {
            setOpen(false);
            onOpen(null);
          }}
        >
          <Icon name="folder" /> <span className="rail-label">All directories</span>
        </button>
        <button
          type="button"
          className={`rail-item overview-link${changesOpen ? " current" : ""}`}
          aria-current={changesOpen ? "page" : undefined}
          onClick={() => {
            setOpen(false);
            onChanges();
          }}
        >
          <Icon name="undo" /> <span className="rail-label">Recent changes</span>
        </button>
        {launch && (
          <>
            <h2 className="rail-group">Opened from</h2>
            <ul className="rail-list">{item(launch)}</ul>
          </>
        )}
        <label className="rail-filter">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a directory"
            aria-label="Find a directory"
          />
        </label>
        <button
          type="button"
          className="rail-group toggle"
          aria-expanded={regularOpen}
          onClick={() => {
            setShowRegular(!regularOpen);
            rememberFolded(regularOpen ? "folded" : null);
          }}
        >
          <Icon name="chevron" /> Used with Claude{" "}
          <span className="rail-count">{regular.length}</span>
        </button>
        {regularOpen &&
          (regular.length > 0 ? (
            <ul className="rail-list">{regular.map(item)}</ul>
          ) : (
            <p className="rail-empty">
              {emptyText(overviewFailed, query, ephemeral.length + gone.length)}
            </p>
          ))}
        {ephemeral.length > 0 && (
          <>
            <button
              type="button"
              className="rail-group toggle"
              aria-expanded={ephemeralOpen}
              onClick={() => setShowEphemeral(!ephemeralOpen)}
            >
              <Icon name="chevron" /> Temporary and test dirs{" "}
              <span className="rail-count">{ephemeral.length}</span>
            </button>
            {ephemeralOpen && <ul className="rail-list">{ephemeral.map(item)}</ul>}
          </>
        )}
        {gone.length > 0 && (
          <>
            <button
              type="button"
              className="rail-group toggle"
              aria-expanded={goneOpen}
              onClick={() => setShowGone(!goneOpen)}
            >
              <Icon name="chevron" /> Deleted folders{" "}
              <span className="rail-count">{gone.length}</span>
            </button>
            {goneOpen && <ul className="rail-list">{gone.map(item)}</ul>}
          </>
        )}
        {typeof current === "string" && (
          <ul className="rail-keys" aria-label="Keyboard shortcuts">
            <li>
              <kbd>j</kbd> <kbd>k</kbd> rows
            </li>
            <li>
              <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> sections
            </li>
            <li>
              <kbd>/</kbd> filter
            </li>
            <li>
              <kbd>Ctrl</kbd> <kbd>K</kbd> jump anywhere
            </li>
          </ul>
        )}
      </div>
    </nav>
  );
}
