import { type RowOf } from "../../view/sections/types.ts";
import { Bullet } from "../Bullet.tsx";
import { tildeAll } from "../format.ts";
import { HookEditor } from "../HookEditor.tsx";
import { Icon } from "../Icon.tsx";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { type SectionUi } from "./types.ts";

type R = RowOf<"hooks">;

export const hooks: SectionUi<R> = {
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
  Head: ({ actions }) => (
    <button type="button" className="head-action" onClick={() => actions.onAdd("hook")}>
      <Icon name="plus" /> Add hook
    </button>
  ),
  Details: ({ row, actions }) => {
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
        <h3 className="sub-title">Change this hook</h3>
        <HookEditor key={row.id} view={actions.view} hook={h} onSaved={actions.onSaved} />
      </>
    );
  },
};
