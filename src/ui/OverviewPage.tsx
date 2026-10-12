import { useEffect, useMemo, useState } from "react";
import { type Overview, type ProjectSummary } from "../shared/types.ts";
import { Bullet } from "./Bullet.tsx";
import { ago, tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { PAGE } from "./list.ts";
import { ShowMore, SortHeaders } from "./SortHeaders.tsx";
import { type Column } from "../view/sections/types.ts";
import { NO_LIST_STATE, readListState, replaceListState, type Sort } from "./url.ts";

const COLUMNS: Array<Column<ProjectSummary>> = [
  { label: "Directory", sort: (p) => p.path },
  { label: "Sessions", sort: (p) => p.sessions },
  { label: "Memories", sort: (p) => p.memories },
  { label: "Last used", sort: (p) => p.lastActive ?? "" },
];

export function OverviewPage({
  overview,
  onOpen,
}: {
  overview: Overview;
  onOpen: (path: string) => void;
}) {
  const projects = useMemo(() => overview.projects.filter((p) => !p.ephemeral), [overview]);
  const memories = projects.reduce((n, p) => n + p.memories, 0);
  const [query, setQuery] = useState(() => readListState().query);
  const [sort, setSort] = useState<Sort | undefined>(() => readListState().sort.dirs);
  const [shown, setShown] = useState(PAGE);
  useEffect(
    () =>
      replaceListState(
        { kind: "all" },
        { ...NO_LIST_STATE, query, sort: sort ? { dirs: sort } : {} }
      ),
    [query, sort]
  );
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => !q || p.path.toLowerCase().includes(q));
    const key = sort && COLUMNS[sort.column]?.sort;
    if (sort && key)
      list.sort((a, b) => {
        const [x, y] = [key(a), key(b)];
        const order =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y));
        return sort.descending ? -order : order;
      });
    return list;
  }, [projects, query, sort]);
  return (
    <div className="page">
      <header className="page-head">
        <h1>All directories</h1>
        <p className="lede">
          {projects.length} directories used with Claude Code, {memories} memories, config from{" "}
          <span className="mono">{tilde(overview.claudeDir)}</span>.
        </p>
      </header>

      <section className="tt-section" aria-labelledby="h-dirs">
        <header className="tt-head">
          <h2 id="h-dirs">Directories</h2>
          <span className="tt-count">
            {matching.length === projects.length
              ? projects.length
              : `${matching.length} of ${projects.length}`}
          </span>
          <label className="filter">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Filter directories"
              aria-label="Filter directories"
            />
          </label>
        </header>
        <table className="tt tt-dirs">
          <SortHeaders columns={COLUMNS} sort={sort} onSort={setSort} />
          <tbody>
            {matching.slice(0, shown).map((p) => (
              <tr key={p.path} onClick={() => onOpen(p.path)} className={p.exists ? "" : "dim"}>
                <td className="mono">
                  <button
                    type="button"
                    className="row-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.path);
                    }}
                  >
                    {tilde(p.path)}
                  </button>
                  {!p.exists && <span className="flag">folder gone</span>}
                </td>
                <td className="num">{p.sessions || "—"}</td>
                <td className="num">{p.memories || "—"}</td>
                <td className="num">{ago(p.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {matching.length === 0 && (
          <p className="tt-empty">
            {projects.length === 0
              ? "No directories yet. Temporary and test directories are listed in the sidebar."
              : "No directory matches."}
          </p>
        )}
        <ShowMore
          shown={Math.min(shown, matching.length)}
          total={matching.length}
          page={PAGE}
          onMore={() => setShown(shown + PAGE)}
        />
      </section>

      <section className="tt-section" aria-labelledby="h-shared">
        <header className="tt-head">
          <h2 id="h-shared">Memory saved in more than one directory</h2>
          <span className="tt-count">{overview.sharedMemories.length}</span>
        </header>
        {overview.sharedMemories.length === 0 ? (
          <p className="tt-empty">Every memory lives in exactly one directory.</p>
        ) : (
          <table className="tt tt-shared">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Memory</th>
                <th scope="col">Copies</th>
                <th scope="col">Saved in</th>
              </tr>
            </thead>
            <tbody>
              {overview.sharedMemories.map((s) => {
                const same = new Set(s.stores.map((x) => x.hash)).size === 1;
                return (
                  <tr key={s.name}>
                    <td>
                      <Bullet line="memory" />
                    </td>
                    <td className="mono">{s.name}</td>
                    <td>
                      <span className={`flag ${same ? "" : "warn"}`}>
                        {same ? "identical" : "drifted apart"}
                      </span>
                    </td>
                    <td className="stores">
                      {s.stores.map((x) => (
                        <button
                          key={x.projectPath}
                          type="button"
                          className="link mono"
                          onClick={() => onOpen(x.projectPath)}
                        >
                          {tilde(x.projectPath)}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
