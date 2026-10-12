import { useEffect, useId, useMemo, useRef, useState } from "react";
import { allowedScopes, EDITABLE_SCOPES } from "../shared/scopes.ts";
import {
  type Change,
  type DirectoryView,
  type Scope,
  type SettingsEdit,
  type SettingsEditPreview,
} from "../shared/types.ts";
import { api } from "./api.ts";
import { Bullet } from "./Bullet.tsx";
import { DiffView } from "./DiffView.tsx";
import { tilde } from "./format.ts";
import { lineName } from "./lines.ts";
import {
  type FieldKind,
  fieldKind,
  propertyFor,
  schemaSource,
  settingKeys,
} from "./settingsSchema.ts";
import { documentedValues } from "./settingsCatalog.ts";

/** A saved edit: the change to undo, what to tell you, and the row to show afterwards. */
export interface Saved {
  /** null for a change ccdesk made through Claude Code's own commands, which it cannot undo. */
  change: Change | null;
  message: string;
  select?: string | null;
}

interface Props {
  view: DirectoryView;
  /** The setting being edited; null starts with a key picker. */
  settingKey: string | null;
  defaultScope: Scope;
  onSaved: (saved: Saved) => void;
}

/** A value as the form holds it: text for inputs, a boolean for checkboxes. */
type Draft = string | boolean;

function toDraft(kind: FieldKind, value: unknown): Draft {
  if (kind === "boolean") return value === true;
  if (value === undefined) return "";
  if (kind === "lines") return Array.isArray(value) ? value.join("\n") : "";
  if (kind === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

function fromDraft(kind: FieldKind, draft: Draft): { value: unknown } | { error: string } {
  if (typeof draft === "boolean") return { value: draft };
  if (kind === "number") {
    const n = Number(draft);
    return draft.trim() === "" || Number.isNaN(n) ? { error: "Enter a number." } : { value: n };
  }
  if (kind === "lines")
    return {
      value: draft
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    };
  if (kind === "json") {
    try {
      return { value: JSON.parse(draft) };
    } catch (error) {
      return { error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (kind === "enum" && draft === "") return { error: "Pick a value." };
  return { value: draft };
}

function isHidden(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes("•••");
}

export function SettingEditor({ view, settingKey, defaultScope, onSaved }: Props) {
  const [key, setKey] = useState(settingKey ?? "");
  const [scope, setScope] = useState<Scope>(defaultScope);
  const property = propertyFor(key);
  const kind = fieldKind(property);
  const layer = view.settings.find((l) => l.scope === scope && !l.legacy);
  const current = layer?.data?.[key];
  const [draft, setDraft] = useState<Draft>(() => toDraft(kind, current));
  // The edit is kept with its review, so Save writes exactly what the diff showed.
  const [review, setReview] = useState<{
    preview: SettingsEditPreview;
    edit: SettingsEdit;
    removing: boolean;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  // Picking another key starts from what the file holds. Compared as text, so re-reading an
  // unchanged file (the page refreshes on focus) keeps an unsaved draft. When Claude Code or an
  // editor changes this value meanwhile, a draft you have not touched follows the file, and one
  // you have is kept, to be reviewed against the file as it is now.
  const currentText = JSON.stringify(current);
  const base = useRef({ key, kind, text: currentText });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft is read, not a trigger.
  useEffect(() => {
    const was = base.current;
    base.current = { key, kind, text: currentText };
    if (was.key === key && was.kind === kind && was.text === currentText) return;
    setReview(null);
    const parse = (text: string | undefined) => (text === undefined ? undefined : JSON.parse(text));
    const edited = JSON.stringify(draft) !== JSON.stringify(toDraft(kind, parse(was.text)));
    if (was.key === key && was.kind === kind && edited) {
      setProblem("The file changed while you were editing. Your value is kept; review it again.");
      return;
    }
    setDraft(toDraft(kind, parse(currentText)));
    setProblem(null);
  }, [key, kind, currentText]);

  // A review describes one value in one file; changing either sends you back to review again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the triggers.
  useEffect(() => setReview(null), [draft, scope, key]);

  const allowed = allowedScopes(key);
  // Start on a file Claude Code reads this key from.
  useEffect(() => {
    const usable = EDITABLE_SCOPES.filter((s) => allowedScopes(key).includes(s));
    setScope((s) => (usable.includes(s) || !usable[0] ? s : usable[0]));
  }, [key]);
  const known = property !== undefined;
  const hidden = isHidden(current);

  const startReview = async (removing: boolean) => {
    setProblem(null);
    const parsed = removing ? { value: undefined } : fromDraft(kind, draft);
    if ("error" in parsed) return setProblem(parsed.error);
    setBusy(true);
    try {
      const edit = { dir: view.path, scope, key, ...(removing ? {} : { value: parsed.value }) };
      setReview({ preview: await api.previewSettings(edit), edit, removing });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!review) return;
    const { edit, preview, removing } = review;
    setBusy(true);
    try {
      const change = await api.saveSettings(edit, preview.revision);
      const where = `${lineName(edit.scope)} settings`;
      onSaved({
        change,
        message: removing ? `Removed ${edit.key} from ${where}` : `Saved ${edit.key} in ${where}`,
        select: `set:${edit.key}`,
      });
      setReview(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="editor" aria-label="Edit setting">
      {settingKey === null && <KeyPicker value={key} onChange={setKey} />}
      {key !== "" && !known && (
        <p className="flag bad">
          {key} is not in Claude Code's settings schema ({schemaSource()}).
        </p>
      )}
      {known && (
        <>
          {property.description && <p className="hint">{property.description}</p>}
          <fieldset className="segmented" aria-label="File to change">
            {EDITABLE_SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                disabled={!allowed.includes(s)}
                title={allowed.includes(s) ? undefined : `Claude Code ignores ${key} in this file`}
                onClick={() => setScope(s)}
              >
                <Bullet line={s} hollow={scope !== s} /> {lineName(s)}
              </button>
            ))}
          </fieldset>
          {!allowed.includes(scope) && (
            <p className="flag warn">
              Claude Code reads {key} only from {allowed.join(" or ") || "~/.claude.json"}; pick
              another file.
            </p>
          )}
          <p className="muted small mono wrap">
            {layer ? tilde(layer.path) : ""}
            {layer && !layer.exists ? " (will be created)" : ""}
          </p>
          {hidden ? (
            <p className="flag warn">This value holds hidden secrets; edit it in the file.</p>
          ) : (
            <>
              <label className="field" htmlFor={fieldId}>
                <span>Value in this file</span>
                <Field
                  id={fieldId}
                  kind={kind}
                  options={property.enum}
                  draft={draft}
                  onChange={setDraft}
                />
              </label>
              {kind === "string" && documentedValues(key).length > 0 && (
                <fieldset className="suggestions" aria-label="Values from the settings reference">
                  <span className="muted small">Documented values</span>
                  {documentedValues(key).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="mono"
                      aria-pressed={draft === value}
                      onClick={() => setDraft(value)}
                    >
                      {value}
                    </button>
                  ))}
                </fieldset>
              )}
              {kind === "lines" && <p className="muted small">One entry per line.</p>}
              <div className="editor-buttons">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !allowed.includes(scope)}
                  onClick={() => startReview(false)}
                >
                  Review change
                </button>
                {current !== undefined && (
                  <button type="button" disabled={busy} onClick={() => startReview(true)}>
                    Remove from this file
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {review && (
        <Review
          preview={review.preview}
          busy={busy}
          onSave={save}
          onCancel={() => setReview(null)}
        />
      )}
    </section>
  );
}

function Field({
  id,
  kind,
  options,
  draft,
  onChange,
}: {
  id: string;
  kind: FieldKind;
  options: unknown[] | undefined;
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  if (kind === "boolean")
    return (
      <span className="check">
        <input
          id={id}
          type="checkbox"
          checked={draft === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {draft === true ? "on" : "off"}
      </span>
    );
  if (kind === "enum")
    return (
      <select id={id} value={String(draft)} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick a value</option>
        {(options ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  if (kind === "lines" || kind === "json")
    return (
      <textarea
        id={id}
        className="mono"
        rows={Math.min(14, Math.max(4, String(draft).split("\n").length + 1))}
        spellCheck={false}
        value={String(draft)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <input
      id={id}
      className="mono"
      type={kind === "number" ? "number" : "text"}
      value={String(draft)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Autocomplete over every key in the schema, with its description. */
function KeyPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(value === "");
  const listId = useId();
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return settingKeys()
      .filter((k) => k.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query]);
  const pick = (key: string | undefined) => {
    if (!key) return;
    setQuery(key);
    setOpen(false);
    onChange(key);
  };
  return (
    <div className="key-picker">
      <label className="field">
        <span>Setting</span>
        <input
          className="mono"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          placeholder={`Search ${settingKeys().length} settings`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            onChange("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: the picker opens because the user asked to add a setting.
          autoFocus
        />
      </label>
      {open && (
        <div id={listId} className="key-results" role="listbox" aria-label="Settings">
          {matches.length === 0 && <div className="palette-empty">No setting matches.</div>}
          {matches.map((k, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys and Enter are handled by the combobox input.
            <div
              key={k}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(k)}
            >
              <span className="mono">{k}</span>
              <span className="muted">{propertyFor(k)?.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Review({
  preview,
  busy,
  onSave,
  onCancel,
}: {
  preview: SettingsEditPreview;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const blocked = preview.errors.length > 0;
  return (
    <section className="review" aria-label="Review change">
      <h3 className="sub-title">
        {blocked ? "This value does not fit the schema" : `Change to ${tilde(preview.path)}`}
      </h3>
      {blocked ? (
        <ul className="plain">
          {preview.errors.map((e) => (
            <li key={e} className="flag bad">
              {e}
            </li>
          ))}
        </ul>
      ) : (
        <DiffView before={preview.before ?? ""} after={preview.after} />
      )}
      {!blocked && preview.commands && (
        <div className="muted small">
          <p>
            ccdesk does not write this file itself; Claude Code rewrites it all the time. Saving
            runs Claude Code's own command instead (values hidden here):
          </p>
          {preview.commands.map((c) => (
            <p key={c} className="mono wrap">
              {c}
            </p>
          ))}
          {preview.commands.some((c) => c.includes(" add-json ")) && (
            <p>
              The real values are passed to claude on its command line, where other programs on this
              computer can see them while it runs.
            </p>
          )}
          <p>
            Recent changes lists this change and the command that puts it back, but ccdesk cannot
            undo it for you.
          </p>
        </div>
      )}
      <div className="editor-buttons">
        {!blocked && (
          <button type="button" className="primary" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          {blocked ? "Back" : "Cancel"}
        </button>
      </div>
      {!blocked && !preview.commands && preview.before !== null && (
        <p className="muted small">
          {preview.reformats
            ? "ccdesk writes the whole file with 2-space indentation, as Claude Code does. "
            : ""}
          The old file is backed up first.
        </p>
      )}
    </section>
  );
}
