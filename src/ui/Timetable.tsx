import { type ReactNode } from "react";
import { type Group, PAGE } from "./list.ts";
import { ShowMore, SortHeaders } from "./SortHeaders.tsx";
import { type Row, type SectionId } from "../view/sections/types.ts";
import { pageContext } from "./sections/index.ts";
import { type Actions } from "./sections/types.ts";
import { type ListState, type Sort } from "./url.ts";

interface Props {
  groups: Group[];
  actions: Actions;
  state: ListState;
  selected: string | null;
  onSelect: (id: string) => void;
  onSort: (section: SectionId, sort: Sort | undefined) => void;
  onOnly: (section: SectionId, value: string | undefined) => void;
  onShowMore: (section: SectionId) => void;
  filtered: boolean;
}

/** Every section of a directory as a table, in page order. */
export function Timetable({
  groups,
  actions,
  state,
  selected,
  onSelect,
  onSort,
  onOnly,
  onShowMore,
  filtered,
}: Props) {
  return (
    <div className="timetable">
      {groups.map(({ section, all, matching, shown }) => {
        if (filtered && matching.length === 0) return null;
        const sort = state.sort[section.id];
        const { Head } = section;
        return (
          <section
            key={section.id}
            id={`section-${section.id}`}
            className="tt-section"
            aria-labelledby={`h-${section.id}`}
          >
            <header className="tt-head">
              <h2 id={`h-${section.id}`}>{section.title}</h2>
              <span className="tt-count">
                {matching.length === all.length
                  ? all.length
                  : `${matching.length} of ${all.length}`}
              </span>
              {section.facet && (
                <Facets
                  label={section.facet.label}
                  values={facetValues(all, section.facet.of, section.facet.order?.(pageContext()))}
                  current={state.only[section.id]}
                  render={section.renderFacet}
                  onPick={(value) => onOnly(section.id, value)}
                />
              )}
              {Head && <Head actions={actions} />}
            </header>
            {all.length === 0 ? (
              <p className="tt-empty">{section.empty(actions.view)}</p>
            ) : (
              <>
                <table
                  className={`tt tt-${section.id} ${section.tableClass?.(all) ?? ""}`}
                  aria-labelledby={`h-${section.id}`}
                >
                  <SortHeaders
                    columns={section.columns}
                    sort={sort}
                    onSort={(next) => onSort(section.id, next)}
                  />
                  <tbody>
                    {shown.map((row) => (
                      <tr
                        key={row.id}
                        id={`row-${row.id}`}
                        className={`${row.id === selected ? "selected" : ""}${section.dimmed?.(row) ? " dim" : ""}`}
                        onClick={() => onSelect(row.id)}
                      >
                        {section.cells(row, actions, {
                          onClick: () => onSelect(row.id),
                          current: row.id === selected,
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ShowMore
                  shown={shown.length}
                  total={matching.length}
                  page={PAGE}
                  onMore={() => onShowMore(section.id)}
                />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function facetValues(rows: Row[], of: (row: Row) => string, order: string[] = []) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(of(row), (counts.get(of(row)) ?? 0) + 1);
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

const MAX_FACET_BUTTONS = 8;

function Facets({
  label,
  values,
  current,
  render,
  onPick,
}: {
  label: string;
  values: [string, number][];
  current: string | undefined;
  render: ((value: string) => ReactNode) | undefined;
  onPick: (value: string | undefined) => void;
}) {
  if (values.length < 2 && !current) return null;
  // Past a handful of values, buttons no longer fit on one line; a menu does.
  if (values.length > MAX_FACET_BUTTONS)
    return (
      <select
        className="facet-select"
        aria-label={label}
        value={current ?? ""}
        onChange={(e) => onPick(e.target.value || undefined)}
      >
        <option value="">All ({values.reduce((sum, [, count]) => sum + count, 0)})</option>
        {current && !values.some(([value]) => value === current) && (
          <option value={current}>{current} (0)</option>
        )}
        {values.map(([value, count]) => (
          <option key={value} value={value}>
            {value} ({count})
          </option>
        ))}
      </select>
    );
  return (
    <fieldset className="segmented" aria-label={label}>
      <button type="button" aria-pressed={!current} onClick={() => onPick(undefined)}>
        All
      </button>
      {values.map(([value, count]) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => onPick(current === value ? undefined : value)}
        >
          {render ? render(value) : value} <span className="seg-count">{count}</span>
        </button>
      ))}
    </fieldset>
  );
}
