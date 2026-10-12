import { type DirectoryView } from "../shared/types.ts";
import { LINES, type Line } from "../view/lines.ts";
import { Bullet } from "./Bullet.tsx";
import { plural } from "./format.ts";

interface Stop {
  line: Line;
  name: string;
  /** What this stop contributes when Claude starts here. */
  facts: string[];
  active: boolean;
}

function stopsFor(view: DirectoryView): Stop[] {
  const inv = view.inventory;
  return LINES.filter((l) => l.line !== "plugin" || inv.plugins.some((p) => p.enabled)).map(
    ({ line, name }) => {
      const facts: string[] = [];
      if (line === "memory") {
        const count = view.memory.memories.length;
        if (count) facts.push(plural(count, "memory", "memories"));
        return { line, name, facts, active: count > 0 };
      }
      if (line === "plugin") {
        const enabled = inv.plugins.filter((p) => p.enabled).length;
        if (enabled) facts.push(plural(enabled, "plugin"));
        return { line, name, facts, active: enabled > 0 };
      }
      const here = view.instructions.filter((i) => i.scope === line);
      const loaded = here.filter((i) => i.status !== "skipped").length;
      const skipped = here.length - loaded;
      if (loaded) facts.push(plural(loaded, "file"));
      if (skipped) facts.push(`${skipped} skipped`);
      const settings = view.effective.filter((s) => s.from.includes(line as never)).length;
      if (settings) facts.push(plural(settings, "setting"));
      const hooks = inv.hooks.filter((h) => h.source === line).length;
      if (hooks) facts.push(plural(hooks, "hook"));
      const servers = inv.mcpServers.filter((m) => m.scope === line).length;
      if (servers) facts.push(`${servers} MCP`);
      const extensions = [
        ...inv.agents,
        ...inv.skills,
        ...inv.commands,
        ...inv.outputStyles,
      ].filter((e) => e.scope === line).length;
      if (extensions) facts.push(plural(extensions, "extension"));
      const extras = hooks + servers + extensions;
      return { line, name, facts, active: loaded > 0 || settings > 0 || extras > 0 };
    }
  );
}

interface Props {
  view: DirectoryView;
  /** The line of the selected row, lit on the strip. */
  lit: Line | null;
  filter: Line | null;
  onFilter: (line: Line | null) => void;
}

/** The directory drawn as a line: each stop is a scope Claude Code loads from, in load order. */
export function RouteStrip({ view, lit, filter, onFilter }: Props) {
  const stops = stopsFor(view);
  return (
    <nav className="route" aria-label="Load order for this directory">
      <ol className="route-stops">
        {stops.map((stop) => {
          const pressed = filter === stop.line;
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
                title={pressed ? "Show every scope" : `Show only ${stop.name.toLowerCase()} items`}
              >
                <span className="stop-node">
                  <Bullet line={stop.line} hollow={!stop.active} />
                </span>
                <span className="stop-name">{stop.name}</span>
                <span className="stop-facts">
                  {stop.facts.length ? stop.facts.join(" · ") : "not used"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Which project files reach everyone who clones the repository, and which stay on this machine. */
export function SharingStrip({ view }: { view: DirectoryView }) {
  const sharing = view.sharing;
  if (!sharing) return null;
  const groups: Array<[string, string, string[]]> = [
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
