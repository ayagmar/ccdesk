import { EDITABLE_SCOPES, HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type Scope } from "../../shared/types.ts";
import { Bullet } from "../Bullet.tsx";
import { preview, tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { type Line, lineName } from "../lines.ts";
import { SettingEditor } from "../SettingEditor.tsx";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"settings">;

export const settings = defineSection<R>({
  id: "settings",
  title: "Settings",
  rows: (view) =>
    view.effective.map((item) => {
      const lines = item.from as Line[];
      return {
        id: `set:${item.key}`,
        section: "settings",
        line: lines[lines.length - 1] ?? "user",
        item,
        lines,
      };
    }),
  columns: [
    { label: "", sort: (r) => HIGHEST_FIRST.indexOf((r.item.from[0] ?? "user") as Scope) },
    { label: "Key", sort: (r) => r.item.key },
    { label: "Value" },
    { label: "Overrides" },
  ],
  cells: (row, _actions, select) => {
    const s = row.item;
    return (
      <>
        <td className="bullets">
          {row.lines.map((l) => (
            <Bullet key={l} line={l} />
          ))}
        </td>
        <td className="mono">
          <NameButton onClick={select}>{s.key}</NameButton>
        </td>
        <td className="mono value">
          {s.from.length === 0 ? (
            <span className="muted">ignored</span>
          ) : (
            tildeAll(preview(s.value))
          )}
        </td>
        <td className="beat">
          {s.merged ? (
            <span className="muted">merged</span>
          ) : (
            s.overridden.map((o) => (
              <span key={o.scope} className="beaten">
                <Bullet line={o.scope} hollow /> <s>{tildeAll(preview(o.value))}</s>
              </span>
            ))
          )}
          {s.ignored.map((o) => (
            <span key={`ignored-${o.scope}`} className="beaten" title={o.reason}>
              <Bullet line={o.scope} hollow /> <s>{tildeAll(preview(o.value))}</s>{" "}
              <span className="flag warn">ignored</span>
            </span>
          ))}
        </td>
      </>
    );
  },
  empty: () => "No settings files set anything here.",
  // The Overrides column only earns its space when some value beats or merges with another file.
  tableClass: (rows) =>
    rows.some((r) => r.item.merged || r.item.overridden.length > 0 || r.item.ignored.length > 0)
      ? ""
      : "no-overrides",
  dimmed: (row) => row.item.from.length === 0,
  text: (row) => `${row.item.key} ${JSON.stringify(row.item.value)}`,
  label: (row) => `setting ${row.item.key}`,
  heading: (row) => row.item.key,
  Head: ({ actions }) => (
    <>
      <button type="button" className="head-action" onClick={actions.onCompare}>
        Compare with…
      </button>
      <button type="button" className="head-action" onClick={() => actions.onAdd("setting")}>
        <Icon name="plus" /> Add setting
      </button>
    </>
  ),
  Details: ({ row, actions }) => {
    const s = row.item;
    const { view } = actions;
    // The file of a scope that sets this key, which for local may be an older file in this folder.
    const layerOf = (scope: Scope) => {
      const layers = view.settings.filter((l) => l.scope === scope);
      return layers.find((l) => l.data?.[s.key] !== undefined) ?? layers.find((l) => !l.legacy);
    };
    return (
      <>
        <p className={`verdict ${s.from.length === 0 ? "off" : "ok"}`}>
          {s.from.length === 0
            ? `Claude Code ignores this value: ${s.ignored[0]?.reason ?? ""}.`
            : s.merged
              ? "Lists and objects from these files are combined."
              : `${lineName(s.from[0] ?? "user")} settings decide this value.`}
        </p>
        <h3 className="sub-title">Every file that sets it</h3>
        <table className="layers">
          <tbody>
            {HIGHEST_FIRST.map((scope) => {
              const layer = layerOf(scope);
              const value = layer?.data?.[s.key];
              const ignored = s.ignored.find((i) => i.scope === scope);
              return (
                <tr
                  key={scope}
                  className={
                    value === undefined ? "unset" : s.from.includes(scope) ? "wins" : "lost"
                  }
                  title={ignored?.reason}
                >
                  <th scope="row">
                    <Bullet line={scope} hollow={value === undefined} />
                  </th>
                  <td className="mono">
                    {value === undefined
                      ? layer?.exists
                        ? "not set"
                        : "no file"
                      : `${preview(value)}${ignored ? " (ignored)" : ""}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3 className="sub-title">Value Claude Code uses</h3>
        {s.note && <p className="muted small">{s.note}</p>}
        <pre className="raw">{JSON.stringify(s.value, null, 2)}</pre>
        <h3 className="sub-title">Change it</h3>
        <SettingEditor
          key={s.key}
          view={view}
          settingKey={s.key}
          defaultScope={[...s.from].reverse().find((x) => EDITABLE_SCOPES.includes(x)) ?? "user"}
          onSaved={actions.onSaved}
        />
        <dl className="fields">
          {s.from.map((scope) => {
            const layer = layerOf(scope);
            return layer ? (
              <Field key={scope} label={`${lineName(scope)} file`}>
                <PathValue path={layer.path} />
              </Field>
            ) : null;
          })}
        </dl>
      </>
    );
  },
});
