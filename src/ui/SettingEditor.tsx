import { useEffect, useId, useMemo, useRef, useState } from "react";
import { allowedScopes, EDITABLE_SCOPES } from "../shared/scopes.ts";
import { type DirectoryView, type Scope, type SettingsEdit } from "../shared/types.ts";
import { lineName } from "../view/lines.ts";
import { type FieldKind, fieldKind } from "../view/settings.ts";
import { api } from "./api.ts";
import { parseJson, ScopeButtons } from "./editorKit.tsx";
import { tilde } from "./format.ts";
import { documentedValues } from "./settingsCatalog.ts";
import { propertyFor, schemaSource, settingKeys } from "./settingsSchema.ts";
import { type ReviewedChange, type Saved, useReviewedChange } from "./useReviewedChange.tsx";

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
    const parsed = parseJson(draft);
    return "error" in parsed ? { error: `Not valid JSON: ${parsed.error}` } : parsed;
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
  // The edit is kept with its review, so Save writes exactly what the diff showed.
  const change = useReviewedChange<SettingsEdit>(
    api.previewSettings,
    api.saveSettings,
    (saved, edit) => onSaved({ ...saved, select: `set:${edit.key}` })
  );
  const [draft, setDraft] = useDraft(key, kind, current, change);

  const allowed = allowedScopes(key);
  // Start on a file Claude Code reads this key from.
  useEffect(() => {
    const usable = EDITABLE_SCOPES.filter((s) => allowedScopes(key).includes(s));
    setScope((s) => (usable.includes(s) || !usable[0] ? s : usable[0]));
  }, [key]);

  // A review describes one value in one file; changing either sends you back to review again.
  const pickKey = (next: string) => {
    setKey(next);
    change.cancel();
  };
  const pickScope = (next: Scope) => {
    setScope(next);
    change.cancel();
  };
  const type = (next: Draft) => {
    setDraft(next);
    change.cancel();
  };

  const startReview = (removing: boolean) => {
    const parsed = removing ? { value: undefined } : fromDraft(kind, draft);
    if ("error" in parsed) return change.fail(parsed.error);
    const where = `${lineName(scope)} settings`;
    void change.start(
      { dir: view.path, scope, key, ...(removing ? {} : { value: parsed.value }) },
      removing ? `Removed ${key} from ${where}` : `Saved ${key} in ${where}`
    );
  };

  return (
    <section className="editor" aria-label="Edit setting">
      {settingKey === null && <KeyPicker value={key} onChange={pickKey} />}
      {key !== "" && !property && (
        <p className="flag bad">
          {key} is not in Claude Code's settings schema ({schemaSource()}).
        </p>
      )}
      {property && (
        <>
          {property.description && <p className="hint">{property.description}</p>}
          {property.$comment && <p className="muted small">{property.$comment}</p>}
          <ScopeButtons
            label="File to change"
            scopes={EDITABLE_SCOPES}
            scope={scope}
            onPick={pickScope}
            unavailable={(s) =>
              allowed.includes(s) ? undefined : `Claude Code ignores ${key} in this file`
            }
          />
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
          {isHidden(current) ? (
            <p className="flag warn">This value holds hidden secrets; edit it in the file.</p>
          ) : (
            <ValueForm
              settingKey={key}
              kind={kind}
              options={property.enum}
              draft={draft}
              onType={type}
              busy={change.busy}
              canSave={allowed.includes(scope)}
              canRemove={current !== undefined}
              onReview={startReview}
            />
          )}
        </>
      )}
      {change.shown}
    </section>
  );
}

/**
 * The value you are typing, kept in step with the file. Picking another key starts from what the
 * file holds. Compared as text, so re-reading an unchanged file (the page refreshes on focus) keeps
 * an unsaved draft. When Claude Code or an editor changes this value meanwhile, a draft you have
 * not touched follows the file, and one you have is kept, to be reviewed against the file as it is
 * now.
 */
function useDraft(
  key: string,
  kind: FieldKind,
  current: unknown,
  change: Pick<ReviewedChange<SettingsEdit>, "cancel" | "fail">
): [Draft, (draft: Draft) => void] {
  const [draft, setDraft] = useState<Draft>(() => toDraft(kind, current));
  const currentText = JSON.stringify(current);
  const base = useRef({ key, kind, text: currentText });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft is read, not a trigger.
  useEffect(() => {
    const was = base.current;
    base.current = { key, kind, text: currentText };
    if (was.key === key && was.kind === kind && was.text === currentText) return;
    change.cancel();
    const parse = (text: string | undefined) => (text === undefined ? undefined : JSON.parse(text));
    const now = toDraft(kind, parse(currentText));
    const edited = JSON.stringify(draft) !== JSON.stringify(toDraft(kind, parse(was.text)));
    // A draft that matches the file, as after saving it, is in step with it, not edited.
    const differs = JSON.stringify(draft) !== JSON.stringify(now);
    if (was.key === key && was.kind === kind && edited && differs) {
      change.fail("The file changed while you were editing. Your value is kept; review it again.");
      return;
    }
    setDraft(now);
  }, [key, kind, currentText]);
  return [draft, setDraft];
}

/** The value field, the documented values to pick from, and the buttons that start a review. */
function ValueForm({
  settingKey,
  kind,
  options,
  draft,
  onType,
  busy,
  canSave,
  canRemove,
  onReview,
}: {
  settingKey: string;
  kind: FieldKind;
  options: unknown[] | undefined;
  draft: Draft;
  onType: (draft: Draft) => void;
  busy: boolean;
  canSave: boolean;
  canRemove: boolean;
  onReview: (removing: boolean) => void;
}) {
  const fieldId = useId();
  const documented = kind === "string" ? documentedValues(settingKey) : [];
  return (
    <>
      <label className="field" htmlFor={fieldId}>
        <span>Value in this file</span>
        <Field id={fieldId} kind={kind} options={options} draft={draft} onChange={onType} />
      </label>
      {documented.length > 0 && (
        <fieldset className="suggestions" aria-label="Values from the settings reference">
          <span className="muted small">Documented values</span>
          {documented.map((value) => (
            <button
              key={value}
              type="button"
              className="mono"
              aria-pressed={draft === value}
              onClick={() => onType(value)}
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
          disabled={busy || !canSave}
          onClick={() => onReview(false)}
        >
          Review change
        </button>
        {canRemove && (
          <button type="button" disabled={busy} onClick={() => onReview(true)}>
            Remove from this file
          </button>
        )}
      </div>
    </>
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
