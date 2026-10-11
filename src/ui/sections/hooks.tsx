import { Bullet } from "../Bullet.tsx";
import { tildeAll } from "../format.ts";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"hooks">;

export const hooks = defineSection<R>({
  id: "hooks",
  title: "Hooks",
  rows: (view) => {
    // Named by what the hook is, so a selection survives hooks added above it.
    const seen = new Map<string, number>();
    return view.inventory.hooks.map((item) => {
      const key = `hook:${item.sourcePath}:${item.event}:${item.matcher ?? ""}:${item.command}`;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return {
        id: count === 0 ? key : `${key}:${count}`,
        section: "hooks",
        line: item.source,
        item,
      };
    });
  },
  columns: [
    { label: "", sort: (r) => r.item.source },
    { label: "Event", sort: (r) => r.item.event },
    { label: "Matcher", sort: (r) => r.item.matcher ?? "" },
    { label: "Runs" },
  ],
  cells: (row, _actions, select) => {
    const h = row.item;
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td>
          <NameButton onClick={select}>{h.event}</NameButton>
        </td>
        <td className="mono">{h.matcher ?? <span className="muted">any</span>}</td>
        <td className="mono value">
          {tildeAll(h.command)}
          {!h.active && (
            <span className="flag warn" title={h.note}>
              off
            </span>
          )}
        </td>
      </>
    );
  },
  empty: () => "No hooks run here.",
  dimmed: (row) => !row.item.active,
  text: (row) => `${row.item.event} ${row.item.matcher ?? ""} ${row.item.command}`,
  label: (row) => `${row.item.event} hook: ${row.item.command}`,
  heading: (row) => `${row.item.event} hook`,
  facet: { label: "Filter hooks by event", of: (row) => row.item.event },
  Details: ({ row }) => {
    const h = row.item;
    return (
      <>
        {!h.active && <p className="verdict off">{h.note}</p>}
        <dl className="fields">
          <Field label="Event">{h.event}</Field>
          <Field label="Matcher">
            <span className="mono">{h.matcher ?? "any"}</span>
          </Field>
          <Field label="Type">{h.type}</Field>
          <Field label="Runs">
            <span className="mono wrap">{tildeAll(h.command)}</span>
          </Field>
          <Field label="Defined in">
            <PathValue path={h.sourcePath} />
          </Field>
          {h.plugin && <Field label="Plugin">{h.plugin}</Field>}
        </dl>
      </>
    );
  },
});
