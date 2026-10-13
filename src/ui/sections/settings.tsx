import { EDITABLE_SCOPES, HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type EffectiveSetting, type Scope } from "../../shared/types.ts";
import { lineName } from "../../view/lines.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { Bullet } from "../Bullet.tsx";
import { preview, tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { SettingEditor } from "../SettingEditor.tsx";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { type SectionUi } from "./types.ts";

type R = RowOf<"settings">;

type Ignored = EffectiveSetting["ignored"][number];

/** The entry that speaks for several: one held for trust, since it applies once you trust the folder. */
function leading(entries: Ignored[]): Ignored | undefined {
  return entries.find((i) => i.waitsForTrust) ?? entries[0];
}

/** Which file decides the value, or why none does. */
function verdict(s: EffectiveSetting): string {
  const first = leading(s.ignored);
  if (s.from.length === 0 && first?.waitsForTrust)
    return `Claude Code holds this value until you trust the folder: ${first.reason}.`;
  if (s.from.length === 0) return `Claude Code ignores this value: ${first?.reason ?? ""}.`;
  if (s.merged) return "Lists and objects from these files are combined.";
  return `${lineName(s.from[0] ?? "user")} settings decide this value.`;
}

/** Whether a scope's value is the one used, one that lost to a higher file, or unset. */
function layerOutcome(s: EffectiveSetting, scope: Scope, value: unknown): string {
  if (value === undefined) return "unset";
  return s.from.includes(scope) ? "wins" : "lost";
}

/** How the page marks a value Claude Code does not use. */
function ignoredLabel(ignored: Ignored | undefined): string {
  return ignored?.waitsForTrust ? "waits for trust" : "ignored";
}

/** A scope's value as the table shows it. */
function layerValue(value: unknown, exists: boolean, ignored: Ignored | undefined): string {
  if (value === undefined) return exists ? "not set" : "no file";
  return `${preview(value)}${ignored ? ` (${ignoredLabel(ignored)})` : ""}`;
}

export const settings: SectionUi<R> = {
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
            <span className="muted">{ignoredLabel(leading(s.ignored))}</span>
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
              <span className="flag warn">{ignoredLabel(o)}</span>
            </span>
          ))}
        </td>
      </>
    );
  },
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
        <p className={`verdict ${s.from.length === 0 ? "off" : "ok"}`}>{verdict(s)}</p>
        <h3 className="sub-title">Every file that sets it</h3>
        <table className="layers">
          <tbody>
            {HIGHEST_FIRST.map((scope) => {
              const layer = layerOf(scope);
              const value = layer?.data?.[s.key];
              const ignored = leading(s.ignored.filter((i) => i.scope === scope));
              return (
                <tr key={scope} className={layerOutcome(s, scope, value)} title={ignored?.reason}>
                  <th scope="row">
                    <Bullet line={scope} hollow={value === undefined} />
                  </th>
                  <td className="mono">{layerValue(value, layer?.exists === true, ignored)}</td>
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
};
