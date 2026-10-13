import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { allowedScopes, EDITABLE_SCOPES } from "../shared/scopes.ts";
import {
  type DirectoryView,
  type Scope,
  type SettingSchema,
  type SettingsEdit,
} from "../shared/types.ts";
import { lineName } from "../view/lines.ts";
import {
  allowedValues,
  type Draft,
  type DraftObject,
  editKind,
  expects,
  type FieldKind,
  fieldKind,
  fromDraft,
  toDraft,
} from "../view/settings.ts";
import { api } from "./api.ts";
import { ScopeButtons } from "./editorKit.tsx";
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

function isHidden(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes("•••");
}

export function SettingEditor({ view, settingKey, defaultScope, onSaved }: Props) {
  const [key, setKey] = useState(settingKey ?? "");
  const [scope, setScope] = useState<Scope>(defaultScope);
  const property = propertyFor(key);
  const layer = view.settings.find((l) => l.scope === scope && !l.legacy);
  const current = layer?.data?.[key];
  const kind = editKind(property, current);
  // The edit is kept with its review, so Save writes exactly what the diff showed.
  const change = useReviewedChange<SettingsEdit>(
    api.previewSettings,
    api.saveSettings,
    (saved, edit) => onSaved({ ...saved, select: `set:${edit.key}` })
  );
  const [draft, setDraft] = useDraft(key, kind, property, current, change);

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
    const parsed = removing ? { value: undefined } : fromDraft(kind, property, draft);
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
              property={property}
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
  property: SettingSchema | undefined,
  current: unknown,
  change: Pick<ReviewedChange<SettingsEdit>, "cancel" | "fail">
): [Draft, (draft: Draft) => void] {
  const [draft, setDraft] = useState<Draft>(() => toDraft(kind, property, current));
  const currentText = JSON.stringify(current);
  const base = useRef({ key, kind, text: currentText });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft is read, not a trigger.
  useEffect(() => {
    const was = base.current;
    base.current = { key, kind, text: currentText };
    if (was.key === key && was.kind === kind && was.text === currentText) return;
    change.cancel();
    const parse = (text: string | undefined) => (text === undefined ? undefined : JSON.parse(text));
    const now = toDraft(kind, property, parse(currentText));
    const edited =
      JSON.stringify(draft) !== JSON.stringify(toDraft(kind, property, parse(was.text)));
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
  property,
  draft,
  onType,
  busy,
  canSave,
  canRemove,
  onReview,
}: {
  settingKey: string;
  kind: FieldKind;
  property: SettingSchema;
  draft: Draft;
  onType: (draft: Draft) => void;
  busy: boolean;
  canSave: boolean;
  canRemove: boolean;
  onReview: (removing: boolean) => void;
}) {
  const documented = kind === "string" ? documentedValues(settingKey) : [];
  return (
    <>
      <Labeled label="Value in this file" kind={kind}>
        {(id) => <Field id={id} kind={kind} property={property} draft={draft} onChange={onType} />}
      </Labeled>
      {kind === "json" && fieldKind(property) !== "json" && (
        <p className="muted small">
          The value in this file does not fit the form, so it is shown as JSON.
        </p>
      )}
      {kind === "json" && <p className="muted small">Takes {expects(property)}.</p>}
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

/**
 * A control and its label. Choices and object forms hold several controls, so they are a group
 * named by the label: a label element would pass its clicks to the first of them.
 */
function Labeled({
  label,
  kind,
  children,
}: {
  label: ReactNode;
  kind: FieldKind;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  if (kind === "choices" || kind === "object")
    return (
      <fieldset className="field" aria-labelledby={id}>
        <span id={id}>{label}</span>
        {children(`${id}-control`)}
      </fieldset>
    );
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {children(id)}
    </label>
  );
}

function Field({
  id,
  kind,
  property,
  draft,
  onChange,
  inObject = false,
}: {
  id: string;
  kind: FieldKind;
  property: SettingSchema;
  draft: Draft;
  onChange: (d: Draft) => void;
  inObject?: boolean;
}) {
  if (kind === "boolean" && !inObject)
    return <Checkbox id={id} checked={draft === true} onChange={onChange} />;
  // A boolean inside an object can be left unset, so it is a choice of three.
  if (kind === "enum" || kind === "boolean")
    return (
      <select id={id} value={String(draft)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{inObject ? "Not set" : "Pick a value"}</option>
        <Options values={kind === "boolean" ? [true, false] : (allowedValues(property) ?? [])} />
      </select>
    );
  if (kind === "choices")
    return (
      <Choices
        id={id}
        property={property}
        picked={Array.isArray(draft) ? draft : []}
        onChange={onChange}
      />
    );
  if (kind === "object")
    return (
      <ObjectFields
        id={id}
        property={property}
        draft={typeof draft === "object" && !Array.isArray(draft) ? draft : {}}
        onChange={onChange}
      />
    );
  if (kind === "lines" || kind === "json")
    return (
      <textarea
        id={id}
        className="mono"
        rows={Math.min(14, Math.max(inObject ? 2 : 4, String(draft).split("\n").length + 1))}
        spellCheck={false}
        placeholder={kind === "lines" && inObject ? "One entry per line" : undefined}
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

function Checkbox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (d: Draft) => void;
}) {
  return (
    <span className="check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {checked ? "on" : "off"}
    </span>
  );
}

function Options({ values }: { values: unknown[] }) {
  return values.map((o) => (
    <option key={String(o)} value={String(o)}>
      {String(o)}
    </option>
  ));
}

/** A button per value a list may hold, pressed for the values it does; picking adds to the end. */
function Choices({
  id,
  property,
  picked,
  onChange,
}: {
  id: string;
  property: SettingSchema;
  picked: string[];
  onChange: (d: Draft) => void;
}) {
  const values = (property.items && allowedValues(property.items)) ?? [];
  return (
    <div id={id} className="suggestions">
      {values.map(String).map((value) => (
        <button
          key={value}
          type="button"
          className="mono"
          aria-pressed={picked.includes(value)}
          onClick={() =>
            onChange(
              picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value]
            )
          }
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/** One control per property the schema names, in the schema's order; an empty one is left unset. */
function ObjectFields({
  id,
  property,
  draft,
  onChange,
}: {
  id: string;
  property: SettingSchema;
  draft: DraftObject;
  onChange: (d: Draft) => void;
}) {
  return (
    <div id={id} className="object-fields">
      {Object.entries(property.properties ?? {}).map(([name, schema]) => {
        const kind = fieldKind(schema);
        return (
          <div key={name} className="object-field">
            <Labeled
              kind={kind}
              label={
                <>
                  <span className="mono">{name}</span>
                  {property.required?.includes(name) && <span className="muted"> required</span>}
                </>
              }
            >
              {(fieldId) => (
                <Field
                  id={fieldId}
                  kind={kind}
                  property={schema}
                  draft={draft[name] ?? toDraft(kind, schema, undefined, true)}
                  onChange={(next) => onChange({ ...draft, [name]: next })}
                  inObject
                />
              )}
            </Labeled>
            {schema.description && <p className="muted small">{schema.description}</p>}
          </div>
        );
      })}
    </div>
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
