import { useId, useState } from "react";
import { EDITABLE_SCOPES } from "../shared/scopes.ts";
import {
  type DirectoryView,
  type Permission,
  type PermissionEdit,
  type PermissionList,
  type Scope,
} from "../shared/types.ts";
import { api } from "./api.ts";
import { Bullet } from "./Bullet.tsx";
import { tilde } from "./format.ts";
import { lineName } from "./lines.ts";
import { type Saved } from "./SettingEditor.tsx";
import { useReviewedChange } from "./useReviewedChange.tsx";

const LISTS: PermissionList[] = ["allow", "ask", "deny"];

type Rule = Extract<Permission, { kind: "rule" }>;

interface Props {
  view: DirectoryView;
  /** The rule to move or remove; null shows a form that adds one. */
  rule: Rule | null;
  onSaved: (saved: Saved) => void;
}

/** One permission rule change to a settings file, reviewed as a diff before it is saved. */
export function usePermissionChange(view: DirectoryView, onSaved: (saved: Saved) => void) {
  const change = useReviewedChange<PermissionEdit>(
    api.previewPermission,
    api.savePermission,
    onSaved
  );
  const start = (
    file: string,
    remove: PermissionEdit["remove"] | undefined,
    add: PermissionEdit["add"] | undefined,
    message: string
  ) =>
    change.start(
      { dir: view.path, file, ...(remove ? { remove } : {}), ...(add ? { add } : {}) },
      message
    );
  return { ...change, start };
}

/** The settings file of one scope in this directory, which a new rule goes into. */
export function fileFor(view: DirectoryView, scope: Scope): string | undefined {
  return view.settings.find((l) => l.scope === scope && !l.legacy)?.path;
}

/** Project settings, or user settings where there is no project file, as in your home folder. */
export function projectOrUser(view: DirectoryView): Scope {
  return fileFor(view, "project") ? "project" : "user";
}

/** Move, remove or add one permission rule, reviewed as a diff of the settings file first. */
export function PermissionEditor({ view, rule, onSaved }: Props) {
  const change = usePermissionChange(view, onSaved);
  const { busy } = change;
  const [list, setList] = useState<PermissionList>("allow");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Scope>(() => projectOrUser(view));
  const ruleId = useId();

  const fileScope = rule?.scope ?? scope;
  // An existing rule is changed in the file it is in; a new one goes to the chosen scope's file.
  const file = rule?.path ?? fileFor(view, scope);
  const editable = EDITABLE_SCOPES.includes(fileScope);

  const startReview = (
    remove: PermissionEdit["remove"] | undefined,
    add: PermissionEdit["add"] | undefined,
    message: string
  ) => {
    if (file) void change.start(file, remove, add, message);
  };

  if (rule && !editable)
    return <p className="muted small">Managed rules are set by your organisation.</p>;

  return (
    <section className="editor" aria-label={rule ? "Change this rule" : "Add a rule"}>
      {rule ? (
        <div className="editor-buttons">
          {LISTS.filter((l) => l !== rule.list).map((l) => (
            <button
              key={l}
              type="button"
              disabled={busy}
              onClick={() =>
                startReview(
                  { list: rule.list, rule: rule.rule },
                  { list: l, rule: rule.rule },
                  `Moved ${rule.rule} to ${l}`
                )
              }
            >
              Move to {l}
            </button>
          ))}
          <button
            type="button"
            className="quiet-danger"
            disabled={busy}
            onClick={() =>
              startReview({ list: rule.list, rule: rule.rule }, undefined, `Removed ${rule.rule}`)
            }
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <fieldset className="segmented" aria-label="List">
            {LISTS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={list === l}
                onClick={() => {
                  setList(l);
                  change.cancel();
                }}
              >
                {l}
              </button>
            ))}
          </fieldset>
          <label className="field" htmlFor={ruleId}>
            <span>Rule</span>
            <input
              id={ruleId}
              className="mono"
              value={text}
              placeholder="Bash(npm test:*)"
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                change.cancel();
              }}
            />
          </label>
          <ScopePicker
            view={view}
            scope={scope}
            onPick={(s) => {
              setScope(s);
              change.cancel();
            }}
          />
          <p className="muted small mono wrap">{file ? tilde(file) : ""}</p>
          <div className="editor-buttons">
            <button
              type="button"
              className="primary"
              disabled={busy || !file || text.trim() === ""}
              onClick={() =>
                startReview(
                  undefined,
                  { list, rule: text.trim() },
                  `Added ${text.trim()} to ${list}`
                )
              }
            >
              Review change
            </button>
          </div>
        </>
      )}
      {change.shown}
    </section>
  );
}

/** Which settings file a new rule goes into: user, project or local. */
export function ScopePicker({
  view,
  scope,
  onPick,
}: {
  view: DirectoryView;
  scope: Scope;
  onPick: (scope: Scope) => void;
}) {
  return (
    <fieldset className="segmented" aria-label="File to change">
      {EDITABLE_SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scope === s}
          // In your home folder .claude/settings.json is your user file, so there is no project file.
          disabled={!fileFor(view, s)}
          title={
            fileFor(view, s) ? undefined : `No ${lineName(s).toLowerCase()} settings file here`
          }
          onClick={() => onPick(s)}
        >
          <Bullet line={s} hollow={scope !== s} /> {lineName(s)}
        </button>
      ))}
    </fieldset>
  );
}
