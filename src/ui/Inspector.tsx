import { useEffect, useRef } from "react";
import { AgentEditor } from "./AgentEditor.tsx";
import { Bullet } from "./Bullet.tsx";
import { HookEditor } from "./HookEditor.tsx";
import { Icon } from "./Icon.tsx";
import { McpEditor } from "./McpEditor.tsx";
import { PermissionEditor } from "./PermissionEditor.tsx";
import { SettingEditor } from "./SettingEditor.tsx";
import { pageContext, sectionOf } from "./sections/index.ts";
import { type Row } from "../view/sections/types.ts";
import { type Actions, type Adding } from "./sections/types.ts";

interface Props {
  row: Row | null;
  /** Show the form that adds this instead of a row. */
  adding: Adding | null;
  actions: Actions;
  onClose: () => void;
}

const TITLES: Record<Adding, string> = {
  setting: "Add a setting",
  permission: "Add a permission rule",
  hook: "Add a hook",
  mcp: "Add an MCP server",
  agent: "Create an agent",
};

/** The panel beside the tables: the selected row's file, why it applies, and what can change. */
export function Inspector({ row, adding, actions, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shownId = adding ?? row?.id ?? null;
  // On narrow screens the panel covers the page, so focus moves into it when it opens.
  useEffect(() => {
    if (shownId && matchMedia("(max-width: 1180px)").matches) heading.current?.focus();
  }, [shownId]);

  if (adding) {
    const title = TITLES[adding];
    return (
      <aside className="inspector" aria-label={title}>
        <header className="insp-head">
          <Icon name="plus" />
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="insp-body">
          {adding === "setting" && (
            <SettingEditor
              view={actions.view}
              settingKey={null}
              defaultScope="user"
              onSaved={actions.onSaved}
            />
          )}
          {adding === "permission" && (
            <PermissionEditor view={actions.view} rule={null} onSaved={actions.onSaved} />
          )}
          {adding === "agent" && (
            <AgentEditor view={actions.view} agent={null} onSaved={actions.onSaved} />
          )}
          {adding === "mcp" && (
            <McpEditor view={actions.view} server={null} onSaved={actions.onSaved} />
          )}
          {adding === "hook" && (
            <HookEditor view={actions.view} hook={null} onSaved={actions.onSaved} />
          )}
        </div>
      </aside>
    );
  }
  if (!row) return null;
  const section = sectionOf(row.section);
  const { Details } = section;
  return (
    <aside className="inspector" aria-label="Details">
      <header className="insp-head">
        {row.line ? <Bullet line={row.line} /> : <Icon name="command" />}
        <h2 ref={heading} tabIndex={-1}>
          {section.heading(row, pageContext())}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>
      </header>
      <div className="insp-body">
        <Details key={row.id} row={row} actions={actions} />
      </div>
    </aside>
  );
}
