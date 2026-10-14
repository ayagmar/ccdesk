import { useId, useState } from "react";
import { type AgentEdit, type DirectoryView, type Entry } from "../shared/types.ts";
import { api } from "./api.ts";
import { ScopeButtons } from "./editorKit.tsx";
import { type Saved, useReviewedChange } from "./useReviewedChange.tsx";
import { Icon } from "./Icon.tsx";

type AgentScope = "project" | "user";

const WHERE: Record<AgentScope, string> = {
  project: "the repository's .claude/agents, shared with everyone working here",
  user: "~/.claude/agents, for you in every project",
};

const template = (name: string) => `---
name: ${name || "reviewer"}
description: When Claude should hand work to this agent
---

You are …
`;

interface Props {
  view: DirectoryView;
  /** The user or project agent to change or delete; null shows a form that creates one. */
  agent: Entry | null;
  onSaved: (saved: Saved) => void;
}

/** Create, change or delete one subagent file, reviewed as a diff first. */
export function AgentEditor({ view, agent, onSaved }: Props) {
  const change = useReviewedChange<AgentEdit>(api.previewAgent, api.saveAgent, onSaved);
  const [file, setFile] = useState("");
  const [text, setText] = useState(agent?.text ?? template(""));
  const [touched, setTouched] = useState(false);
  const [scope, setScope] = useState<AgentScope>("project");
  const ids = { file: useId(), text: useId() };

  const where = agent ? { path: agent.path } : { create: { scope, file: file.trim() } };
  return (
    <section className="editor" aria-label={agent ? "Change this agent" : "Create an agent"}>
      {!agent && (
        <label className="field" htmlFor={ids.file}>
          <span>File name</span>
          <input
            id={ids.file}
            className="mono"
            value={file}
            placeholder="e.g. reviewer"
            spellCheck={false}
            onChange={(e) => {
              setFile(e.target.value);
              // The name in the template follows the file name until you edit the text.
              if (!touched) setText(template(e.target.value.trim().replace(/\.md$/i, "")));
              change.cancel();
            }}
          />
        </label>
      )}
      <label className="field" htmlFor={ids.text}>
        <span>Agent file</span>
        <textarea
          id={ids.text}
          className="mono"
          rows={Math.min(18, Math.max(8, text.split("\n").length + 1))}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTouched(true);
            change.cancel();
          }}
        />
      </label>
      {!agent && (
        <>
          <ScopeButtons
            label="Where the agent goes"
            scopes={["project", "user"] as const}
            scope={scope}
            onPick={(s) => {
              setScope(s);
              change.cancel();
            }}
          />
          <p className="muted small">{WHERE[scope]}</p>
        </>
      )}
      {!change.reviewing && (
        <div className="editor-buttons">
          <button
            type="button"
            className="primary"
            disabled={change.busy || (!agent && file.trim() === "")}
            onClick={() =>
              void change.start(
                { dir: view.path, ...where, text },
                agent ? `Changed the ${agent.name} agent` : `Created the ${file.trim()} agent`
              )
            }
          >
            Review change
          </button>
          {agent && (
            <button
              type="button"
              className="quiet-danger"
              disabled={change.busy}
              onClick={() =>
                void change.start(
                  { dir: view.path, path: agent.path, text: null },
                  `Deleted the ${agent.name} agent`
                )
              }
            >
              <Icon name="trash" /> Delete…
            </button>
          )}
        </div>
      )}
      {change.shown}
    </section>
  );
}
