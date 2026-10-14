import { EDITABLE_SCOPES, HIGHEST_FIRST } from "../../shared/scopes.ts";
import { plain, valueHere } from "../../view/sections/catalog.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { LINES, type Line, lineName } from "../../view/lines.ts";
import { Bullet } from "../Bullet.tsx";
import { preview, tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { SettingEditor } from "../SettingEditor.tsx";
import { propertyFor } from "../settingsSchema.ts";
import { Field, NameButton, Prose } from "./kit.tsx";
import { type Actions, type SectionUi } from "./types.ts";

type R = RowOf<"catalog">;

/** Docs Markdown: links open the docs in a new tab. */
function Docs({ text }: { text: string }) {
  return <Prose className="prose docs-text" text={text} linksInNewTab />;
}

function filesText(scopes: Line[]): string {
  if (scopes.length === 0) return "~/.claude.json only";
  if (scopes.length === 4) return "any settings file";
  return scopes.map((s) => lineName(s).toLowerCase()).join(", ");
}

/** The editor for a setting, or why ccdesk cannot set it. */
function SetIt({
  setting: s,
  set,
  actions,
}: {
  setting: R["item"];
  set: ReturnType<typeof valueHere>["set"];
  actions: Actions;
}) {
  const [top = s.key, field] = s.key.split(".", 2);
  const editable = s.scopes.filter((scope) => EDITABLE_SCOPES.includes(scope));
  if (s.scopes.length === 0)
    return (
      <p className="muted small">
        Claude Code keeps this in ~/.claude.json, which ccdesk never changes. Use{" "}
        <code>/config</code> in Claude Code.
      </p>
    );
  if (editable.length === 0)
    return <p className="muted small">Only managed settings can set this.</p>;
  if (field)
    return (
      <p className="muted small">
        It is a field of <code>{top}</code>; edit that setting to change it.
      </p>
    );
  if (propertyFor(top) === undefined)
    return (
      <p className="muted small">
        This key is not in the settings schema ccdesk ships, so it cannot be edited here.
      </p>
    );
  const fallback = editable.includes("user") ? "user" : (editable[0] ?? "user");
  return (
    <SettingEditor
      key={s.key}
      view={actions.view}
      settingKey={s.key}
      defaultScope={[...(set?.from ?? [])].reverse().find((x) => editable.includes(x)) ?? fallback}
      onSaved={actions.onSaved}
    />
  );
}

export const catalog: SectionUi<R> = {
  cells: (row, { view }, name) => {
    const s = row.item;
    const { value } = valueHere(view, s.key);
    return (
      <>
        <td>{row.line && <Bullet line={row.line} />}</td>
        <td className="mono">
          <NameButton {...name}>{s.key}</NameButton>
        </td>
        <td className="desc">{plain(s.summary)}</td>
        <td className="catalog-files">
          {s.scopes.length === 0 ? (
            <span className="muted small">~/.claude.json</span>
          ) : (
            // Plain letters, not bullets: a bullet means a value came from that scope, and a
            // hollow one that it is there but not in force; these are only where it may be read.
            <span className="catalog-letters muted" title={`Read from ${filesText(s.scopes)}`}>
              <span aria-hidden="true">
                {HIGHEST_FIRST.filter((scope) => s.scopes.includes(scope))
                  .map((scope) => LINES.find((l) => l.line === scope)?.letter)
                  .join(" ")}
              </span>
              <span className="visually-hidden">{filesText(s.scopes)}</span>
            </span>
          )}
        </td>
        <td className="mono value">
          {value === undefined ? <span className="muted">default</span> : tildeAll(preview(value))}
        </td>
      </>
    );
  },
  Head: () => (
    <span className="tt-note">
      Every setting in Claude Code's settings reference; the ones set here show their value
    </span>
  ),
  Details: ({ row, actions }) => {
    const s = row.item;
    const { view } = actions;
    const { set, value } = valueHere(view, s.key);
    return (
      <>
        <div className="verdict">
          <Docs text={s.summary} />
        </div>
        <dl className="fields">
          <Field label="Area">{s.category}</Field>
          <Field label="Read from">{filesText(s.scopes)}</Field>
          <Field label="Here">
            {value === undefined ? (
              "not set, so the default applies"
            ) : (
              <span className="mono">
                {tildeAll(preview(value))}
                {set && ` (${set.from.map((f) => lineName(f).toLowerCase()).join(", ")})`}
              </span>
            )}
          </Field>
        </dl>
        {s.about && s.about !== s.summary && <Docs text={s.about} />}
        {s.type && (
          <section className="sub">
            <h3>Values</h3>
            <Docs text={s.type} />
          </section>
        )}
        {s.default && (
          <section className="sub">
            <h3>Default</h3>
            <Docs text={s.default} />
          </section>
        )}
        <section className="sub">
          <h3>{value === undefined ? "Set it" : "Change it"}</h3>
          <SetIt setting={s} set={set} actions={actions} />
        </section>
        <p className="muted small">
          <a className="docs-link" href={s.docs} target="_blank" rel="noreferrer">
            Read it in the settings reference <Icon name="open" />
          </a>
        </p>
      </>
    );
  },
};
