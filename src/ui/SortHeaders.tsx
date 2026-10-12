import { type Column } from "../view/sections/types.ts";
import { type Sort } from "./url.ts";

/** Ascending, then descending, then back to the list's own order. */
function nextSort(sort: Sort | undefined, column: number): Sort | undefined {
  if (sort?.column !== column) return { column, descending: false };
  return sort.descending ? undefined : { column, descending: true };
}

/** A table's column heads; a sortable one is a button that cycles its order. */
export function SortHeaders<R>({
  columns,
  sort,
  onSort,
}: {
  columns: Array<Column<R>>;
  sort: Sort | undefined;
  onSort: (sort: Sort | undefined) => void;
}) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => {
          const on = sort?.column === index;
          return (
            <th
              key={column.label || "scope"}
              scope="col"
              aria-sort={on ? (sort.descending ? "descending" : "ascending") : undefined}
            >
              {column.sort ? (
                <button
                  type="button"
                  className="sort"
                  onClick={() => onSort(nextSort(sort, index))}
                >
                  {column.label || <span className="visually-hidden">Scope</span>}
                  <span className={`sort-mark${on ? " on" : ""}`} aria-hidden="true">
                    {on ? (sort.descending ? "↓" : "↑") : "↕"}
                  </span>
                </button>
              ) : (
                column.label
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** "Show 50 more", with how many are on screen. */
export function ShowMore({
  shown,
  total,
  page,
  onMore,
}: {
  shown: number;
  total: number;
  page: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <button type="button" className="show-more" onClick={onMore}>
      Show {Math.min(page, total - shown)} more
      <span className="muted">
        {" "}
        · {shown} of {total} shown
      </span>
    </button>
  );
}
