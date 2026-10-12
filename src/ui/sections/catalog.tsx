import Markdown from "react-markdown";
import { EDITABLE_SCOPES, HIGHEST_FIRST } from "../../shared/scopes.ts";
import { type DirectoryView, type EffectiveSetting } from "../../shared/types.ts";
import { Bullet } from "../Bullet.tsx";
import { preview, tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { type Line, lineName } from "../lines.ts";
import { reference } from "../reference.ts";
import { SettingEditor } from "../SettingEditor.tsx";
import { categories } from "../settingsCatalog.ts";
import { propertyFor } from "../settingsSchema.ts";
import { Field, NameButton } from "./kit.tsx";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"catalog">;

/** The value a key has here: a top-level setting, or a field inside one such as sandbox.network.allowedDomains. */
function valueHere(view: DirectoryView, key: string): { set?: EffectiveSetting; value?: unknown } {
  const [top = "", ...path] = key.split(".");
  const set = view.effective.find((s) => s.key === top && s.from.length > 0);
  if (!set) return {};
  let value: unknown = set.value;
  for (const field of path)
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[field]
        : undefined;
  return value === undefined ? {} : { set, value };
}

/** Docs Markdown: links open the docs in a new tab; react-markdown never renders raw HTML. */
function Docs({ text }: { text: string }) {
  return (
    <div className="prose docs-text">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

/** Docs Markdown kept to one line of plain text, for a table cell. */
function plain(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");
}

function filesText(scopes: Line[]): string {
  if (scopes.length === 0) return "~/.claude.json only";
  if (scopes.length === 4) return "any settings file";
  return scopes.map((s) => lineName(s).toLowerCase()).join(", ");
}

export const catalog = defineSection<R>({
  id: "catalog",
  title: "All settings",
  rows: (view) =>
    reference().catalog.map((item) => {
      const { set } = valueHere(view, item.key);
      const line = (set?.from.at(-1) as Line | undefined) ?? null;
      return { id: `cat:${item.key}`, section: "catalog", line, item, ...(set ? { set } : {}) };
    }),
  columns: [
    { label: "", sort: (r) => (r.set ? 0 : 1) },
    { label: "Setting", sort: (r) => r.item.key },
    { label: "What it does" },
    { label: "Files", sort: (r) => -r.item.scopes.length },
    { label: "Here", sort: (r) => (r.set ? 0 : 1) },
  ],
  cells: (row, { view }, select) => {
    const s = row.item;
    const { value } = valueHere(view, s.key);
    return (
      <>
        <td>{row.line && <Bullet line={row.line} />}</td>
        <td className="mono">
          <NameButton onClick={select}>{s.key}</NameButton>
        </td>
        <td className="desc">{plain(s.summary)}</td>
        <td className="catalog-files">
          {s.scopes.length === 0 ? (
            <span className="muted small">~/.claude.json</span>
          ) : (
            HIGHEST_FIRST.filter((scope) => s.scopes.includes(scope)).map((scope) => (
              <Bullet key={scope} line={scope} hollow />
            ))
          )}
        </td>
        <td className="mono value">
          {value === undefined ? <span className="muted">default</span> : tildeAll(preview(value))}
        </td>
      </>
    );
  },
  empty: () => "ccdesk has no list of Claude Code's settings.",
  text: (row) => `${row.item.key} ${plain(row.item.summary)} ${row.item.category}`,
  label: (row) => `setting ${row.item.key} (all settings)`,
  heading: (row) => row.item.key,
  facet: {
    label: "Filter settings by area",
    of: (row) => row.item.category,
    // A getter: the catalog arrives from the server after this module loads.
    get order() {
      return categories();
    },
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
    const [top = s.key, field] = s.key.split(".", 2);
    const editable = s.scopes.filter((scope) => EDITABLE_SCOPES.includes(scope));
    const inSchema = propertyFor(top) !== undefined;
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
          {s.scopes.length === 0 ? (
            <p className="muted small">
              Claude Code keeps this in ~/.claude.json, which ccdesk never changes. Use{" "}
              <code>/config</code> in Claude Code.
            </p>
          ) : editable.length === 0 ? (
            <p className="muted small">Only managed settings can set this.</p>
          ) : field ? (
            <p className="muted small">
              It is a field of <code>{top}</code>; edit that setting to change it.
            </p>
          ) : !inSchema ? (
            <p className="muted small">
              This key is not in the settings schema ccdesk ships, so it cannot be edited here.
            </p>
          ) : (
            <SettingEditor
              key={s.key}
              view={view}
              settingKey={s.key}
              defaultScope={
                [...(set?.from ?? [])].reverse().find((x) => editable.includes(x)) ??
                (editable.includes("user") ? "user" : (editable[0] ?? "user"))
              }
              onSaved={actions.onSaved}
            />
          )}
        </section>
        <p className="muted small">
          <a className="docs-link" href={s.docs} target="_blank" rel="noreferrer">
            Read it in the settings reference <Icon name="open" />
          </a>
        </p>
      </>
    );
  },
});
