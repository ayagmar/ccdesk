import { type DirectoryView } from "../shared/types.ts";
import { type Line } from "../view/lines.ts";
import { routeStops } from "../view/route.ts";
import { Bullet } from "./Bullet.tsx";
import { plural } from "./format.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  view: DirectoryView;
  /** The line of the selected row, lit on the strip. */
  lit: Line | null;
  filter: Line | null;
  onFilter: (line: Line | null) => void;
}

/** The directory drawn as a line: each stop is a scope Claude Code loads from, in load order. */
export function RouteStrip({ view, lit, filter, onFilter }: Props) {
  const stops = routeStops(view);
  return (
    <nav className="route" aria-label="Load order for this directory">
      <ol className="route-stops">
        {stops.map((stop) => {
          const pressed = filter === stop.line;
          const unreadable = stop.unreadable
            ? `${plural(stop.unreadable, "file")} can't be read`
            : null;
          const summary = [...stop.facts, ...(unreadable ? [unreadable] : [])];
          return (
            <li
              key={stop.line}
              className={`stop${stop.active ? "" : " idle"}${lit === stop.line ? " lit" : ""}`}
            >
              <button
                type="button"
                aria-pressed={pressed}
                className={pressed ? "on" : ""}
                onClick={() => onFilter(pressed ? null : stop.line)}
                title={`${stop.name}: ${summary.join(", ") || "not used"}\n${pressed ? "Show every scope" : `Show only ${stop.name.toLowerCase()} items`}`}
              >
                <span className="stop-node">
                  <Bullet line={stop.line} hollow={!stop.active} />
                </span>
                <span className="stop-name">{stop.name}</span>
                {(stop.facts.length > 0 || !stop.active) && (
                  <span className="stop-facts">
                    {stop.facts.length ? factsLine(stop.facts) : "not used"}
                  </span>
                )}
                {unreadable && (
                  <span className="flag warn">
                    <Icon name="warn" /> {unreadable}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The facts in one line that breaks only between facts, after each separator. */
function factsLine(facts: string[]): string {
  return facts.map((fact) => fact.replaceAll(" ", "\u00a0")).join("\u00a0· ");
}

/** Which project files reach everyone who clones the repository, and which stay on this machine. */
export function SharingStrip({ view }: { view: DirectoryView }) {
  const sharing = view.sharing;
  if (!sharing) return null;
  const groups: [string, string, string[]][] = [
    ["tracked", "Tracked in git: everyone who clones gets these", sharing.tracked],
    ["untracked", "Not tracked yet", sharing.untracked],
    ["ignored", "Git-ignored: only you", sharing.ignored],
  ];
  if (groups.every(([, , files]) => files.length === 0)) return null;
  return (
    <dl className="sharing" aria-label="What this repository shares">
      {groups
        .filter(([, , files]) => files.length > 0)
        .map(([kind, title, files]) => (
          <div key={kind} className={`sharing-group vis-${kind}`}>
            <dt>{title}</dt>
            <dd className="mono">
              {files.map((file) => (
                <span key={file}>{file}</span>
              ))}
            </dd>
          </div>
        ))}
    </dl>
  );
}
