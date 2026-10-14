import { useId, useState } from "react";
import { EDITABLE_SCOPES, PERMISSION_LISTS } from "../shared/scopes.ts";
import {
  type DirectoryView,
  type PermissionEdit,
  type PermissionList,
  type Scope,
} from "../shared/types.ts";
import { type Rule } from "../view/sections/permissions.ts";
import { api } from "./api.ts";
import { fileFor, projectOrUser, ScopePicker } from "./editorKit.tsx";
import { tilde } from "./format.ts";
import { type Saved, useReviewedChange } from "./useReviewedChange.tsx";
import { Icon } from "./Icon.tsx";

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
          {PERMISSION_LISTS.filter((l) => l !== rule.list).map((l) => (
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
            <Icon name="trash" /> Remove…
          </button>
        </div>
      ) : (
        <>
          <fieldset className="segmented" aria-label="List">
            {PERMISSION_LISTS.map((l) => (
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
              placeholder="e.g. Bash(npm test:*)"
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
