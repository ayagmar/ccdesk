import { useId, useState } from "react";
import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import { EDITABLE_SCOPES } from "../shared/scopes.ts";
import { type DirectoryView, type Hook, type HookEdit, type Scope } from "../shared/types.ts";
import { api } from "./api.ts";
import { tilde } from "./format.ts";
import { fileFor, projectOrUser, ScopePicker } from "./PermissionEditor.tsx";
import { type Saved } from "./SettingEditor.tsx";
import { useReviewedChange } from "./useReviewedChange.tsx";

interface Props {
  view: DirectoryView;
  /** The hook to change or remove; null shows a form that adds one. */
  hook: Hook | null;
  onSaved: (saved: Saved) => void;
}

const NEW_HOOK = `{
  "type": "command",
  "command": ""
}`;

/** Add, change or remove one hook, reviewed as a diff of its settings file first. */
export function HookEditor({ view, hook, onSaved }: Props) {
  const change = useReviewedChange<HookEdit>(api.previewHook, api.saveHook, onSaved);
  const [event, setEvent] = useState(hook?.event ?? "PreToolUse");
  const [matcher, setMatcher] = useState(hook?.matcher ?? "");
  const [text, setText] = useState(hook ? JSON.stringify(hook.definition, null, 2) : NEW_HOOK);
  const [scope, setScope] = useState<Scope>(() => projectOrUser(view));
  const ids = { event: useId(), matcher: useId(), hook: useId() };

  if (hook && (hook.source === "plugin" || !EDITABLE_SCOPES.includes(hook.source)))
    return (
      <p className="muted small">
        {hook.source === "plugin"
          ? "This hook comes with its plugin; change it in the plugin or turn the plugin off."
          : "Managed hooks are set by your organisation."}
      </p>
    );

  // An existing hook is changed in the file it is in; a new one goes to the chosen scope's file.
  const file = hook?.sourcePath ?? fileFor(view, scope);
  const remove = hook ? { event: hook.event, at: hook.at, definition: hook.definition } : undefined;
  const review = () => {
    if (!file) return;
    let definition: unknown;
    try {
      definition = JSON.parse(text);
    } catch (error) {
      change.fail(`The hook is not valid JSON: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const add = { event, ...(matcher.trim() ? { matcher: matcher.trim() } : {}), definition };
    void change.start(
      { dir: view.path, file, ...(remove ? { remove } : {}), add },
      hook ? `Changed a ${event} hook` : `Added a ${event} hook`
    );
  };

  return (
    <section className="editor" aria-label={hook ? "Change this hook" : "Add a hook"}>
      <label className="field" htmlFor={ids.event}>
        <span>Event</span>
        <select
          id={ids.event}
          value={event}
          onChange={(e) => {
            setEvent(e.target.value);
            change.cancel();
          }}
        >
          {HOOK_EVENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={ids.matcher}>
        <span>Matcher</span>
        <input
          id={ids.matcher}
          className="mono"
          value={matcher}
          placeholder="any (for tool events, a tool name such as Bash or Edit|Write)"
          spellCheck={false}
          onChange={(e) => {
            setMatcher(e.target.value);
            change.cancel();
          }}
        />
      </label>
      <label className="field" htmlFor={ids.hook}>
        <span>Hook (JSON)</span>
        <textarea
          id={ids.hook}
          className="mono"
          rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            change.cancel();
          }}
        />
      </label>
      {!hook && (
        <ScopePicker
          view={view}
          scope={scope}
          onPick={(s) => {
            setScope(s);
            change.cancel();
          }}
        />
      )}
      <p className="muted small mono wrap">{file ? tilde(file) : ""}</p>
      {!change.reviewing && (
        <div className="editor-buttons">
          <button
            type="button"
            className="primary"
            disabled={change.busy || !file}
            onClick={review}
          >
            Review change
          </button>
          {remove && file && (
            <button
              type="button"
              className="quiet-danger"
              disabled={change.busy}
              onClick={() =>
                void change.start({ dir: view.path, file, remove }, `Removed a ${hook?.event} hook`)
              }
            >
              Remove
            </button>
          )}
        </div>
      )}
      {change.shown}
    </section>
  );
}
