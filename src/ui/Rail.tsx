import { useState } from "react";
import { type Overview, type ProjectSummary } from "../shared/types.ts";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  overview: Overview | null;
  /** The open directory; null for all directories, undefined when another page is open. */
  current: string | null | undefined;
  changesOpen: boolean;
  dark: boolean;
  onOpen: (path: string | null) => void;
  onChanges: () => void;
  onToggleTheme: () => void;
}

function label(path: string, home: string): string {
  return path === home ? "~ (home)" : tilde(path);
}

export function Rail({
  overview,
  current,
  changesOpen,
  dark,
  onOpen,
  onChanges,
  onToggleTheme,
}: Props) {
  const [query, setQuery] = useState("");
  const [showEphemeral, setShowEphemeral] = useState(false);
  const projects = overview?.projects ?? [];
  const match = (p: ProjectSummary) => !query || p.path.toLowerCase().includes(query.toLowerCase());
  const launch = projects.find((p) => p.path === overview?.launchDir);
  const regular = projects.filter((p) => !p.ephemeral && p !== launch && match(p));
  const ephemeral = projects.filter((p) => p.ephemeral && p !== launch && match(p));

  const item = (p: ProjectSummary) => (
    <li key={p.path}>
      <button
        type="button"
        className={`rail-item${current === p.path ? " current" : ""}${p.exists ? "" : " gone"}`}
        aria-current={current === p.path ? "page" : undefined}
        onClick={() => onOpen(p.path)}
        title={p.exists ? tilde(p.path) : `${tilde(p.path)} (folder no longer exists)`}
      >
        <span className="rail-label">{label(p.path, overview?.home ?? "")}</span>
        {p.memories > 0 && <span className="rail-count">{p.memories}</span>}
      </button>
    </li>
  );

  return (
    <nav className="rail" aria-label="Directories">
      <div className="brand">
        <img src="/logo.png" width="26" height="26" alt="" />
        <span>ccdesk</span>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label="Dark theme"
          aria-pressed={dark}
        >
          <Icon name="sun" />
        </button>
      </div>
      <button
        type="button"
        className={`rail-item overview-link${current === null ? " current" : ""}`}
        aria-current={current === null ? "page" : undefined}
        onClick={() => onOpen(null)}
      >
        <Icon name="folder" /> <span className="rail-label">All directories</span>
      </button>
      <button
        type="button"
        className={`rail-item overview-link${changesOpen ? " current" : ""}`}
        aria-current={changesOpen ? "page" : undefined}
        onClick={onChanges}
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
      <h2 className="rail-group">Used with Claude</h2>
      {regular.length > 0 ? (
        <ul className="rail-list">{regular.map(item)}</ul>
      ) : (
        <p className="rail-empty">
          {query ? "No directory matches." : "No other directories yet."}
        </p>
      )}
      {ephemeral.length > 0 && (
        <>
          <button
            type="button"
            className="rail-group toggle"
            aria-expanded={showEphemeral}
            onClick={() => setShowEphemeral(!showEphemeral)}
          >
            Temporary and test dirs <span className="rail-count">{ephemeral.length}</span>
          </button>
          {showEphemeral && <ul className="rail-list">{ephemeral.map(item)}</ul>}
        </>
      )}
    </nav>
  );
}
