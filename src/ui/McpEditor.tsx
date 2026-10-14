import { useId, useState } from "react";
import { type DirectoryView, type McpEdit, type McpServer } from "../shared/types.ts";
import { parseJson } from "../view/settings.ts";
import { api } from "./api.ts";
import { ScopeButtons } from "./editorKit.tsx";
import { tilde } from "./format.ts";
import { type Saved, useReviewedChange } from "./useReviewedChange.tsx";

type EditableScope = McpEdit["scope"];

const SCOPES: EditableScope[] = ["project", "local", "user"];

const WHERE: Record<EditableScope, string> = {
  project: ".mcp.json in this directory, shared with everyone working here",
  local: "~/.claude.json, for you in this project only",
  user: "~/.claude.json, for you in every project",
};

const NEW_SERVER = `{
  "command": "",
  "args": []
}`;

interface Props {
  view: DirectoryView;
  /** The server to change or remove; null shows a form that adds one. */
  server: McpServer | null;
  onSaved: (saved: Saved) => void;
}

function isEditable(scope: McpServer["scope"]): scope is EditableScope {
  return (SCOPES as string[]).includes(scope);
}

/** Add, change or remove one MCP server, reviewed before anything is written. */
export function McpEditor({ view, server, onSaved }: Props) {
  const change = useReviewedChange<McpEdit>(api.previewMcp, api.saveMcp, onSaved);
  const [name, setName] = useState(server?.name ?? "");
  const [text, setText] = useState(
    server ? JSON.stringify(server.definition, null, 2) : NEW_SERVER
  );
  const [scope, setScope] = useState<EditableScope>("project");
  const ids = { name: useId(), server: useId() };

  if (server && !isEditable(server.scope))
    return (
      <p className="muted small">
        {server.scope === "plugin"
          ? "This server comes with its plugin; change it in the plugin or turn the plugin off."
          : "Managed servers are set by your organisation."}
      </p>
    );

  const target: EditableScope = server && isEditable(server.scope) ? server.scope : scope;
  const remove = server ? { name: server.name, definition: server.definition } : undefined;
  const review = () => {
    const parsed = parseJson(text);
    if ("error" in parsed) return change.fail(parsed.error);
    void change.start(
      {
        dir: view.path,
        scope: target,
        ...(remove ? { remove } : {}),
        add: { name: name.trim(), definition: parsed.value },
      },
      server ? `Changed the ${name.trim()} server` : `Added the ${name.trim()} server`
    );
  };

  return (
    <section className="editor" aria-label={server ? "Change this server" : "Add a server"}>
      <label className="field" htmlFor={ids.name}>
        <span>Name</span>
        <input
          id={ids.name}
          className="mono"
          value={name}
          placeholder="e.g. sentry"
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            change.cancel();
          }}
        />
      </label>
      <label className="field" htmlFor={ids.server}>
        <span>Server (JSON)</span>
        <textarea
          id={ids.server}
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
      {!server && (
        <ScopeButtons
          label="Where the server goes"
          scopes={SCOPES}
          scope={scope}
          onPick={(s) => {
            setScope(s);
            change.cancel();
          }}
        />
      )}
      <p className="muted small">
        {target === "project" ? tilde(`${view.path}/.mcp.json`) : WHERE[target]}
      </p>
      {!change.reviewing && (
        <div className="editor-buttons">
          <button
            type="button"
            className="primary"
            disabled={change.busy || name.trim() === ""}
            onClick={review}
          >
            Review change
          </button>
          {remove && (
            <button
              type="button"
              className="quiet-danger"
              disabled={change.busy}
              onClick={() =>
                void change.start(
                  { dir: view.path, scope: target, remove },
                  `Removed the ${remove.name} server`
                )
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
