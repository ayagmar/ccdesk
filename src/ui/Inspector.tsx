import { useEffect, useRef } from "react";
import { Bullet } from "./Bullet.tsx";
import { Icon } from "./Icon.tsx";
import { PermissionEditor } from "./PermissionEditor.tsx";
import { SettingEditor } from "./SettingEditor.tsx";
import { SECTIONS, sectionOf } from "./sections/index.ts";
import { type Actions, type Row } from "./sections/types.ts";

interface Props {
  row: Row | null;
  /** Show a form that adds a setting or a permission rule instead of a row. */
  adding: "setting" | "permission" | null;
  actions: Actions;
  onClose: () => void;
}

/** The panel beside the tables: the selected row's file, why it applies, and what can change. */
export function Inspector({ row, adding, actions, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shownId = adding ?? row?.id ?? null;
  // On narrow screens the panel covers the page, so focus moves into it when it opens.
  useEffect(() => {
    if (shownId && matchMedia("(max-width: 1180px)").matches) heading.current?.focus();
  }, [shownId]);

  if (adding) {
    const title = adding === "setting" ? "Add a setting" : "Add a permission rule";
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
          {adding === "setting" ? (
            <SettingEditor
              view={actions.view}
              settingKey={null}
              defaultScope="user"
              onSaved={actions.onSaved}
            />
          ) : (
            <PermissionEditor view={actions.view} rule={null} onSaved={actions.onSaved} />
          )}
        </div>
      </aside>
    );
  }
  if (!row) {
    return (
      <aside className="inspector empty" aria-label="Details">
        <p>Select a row to see the file behind it.</p>
        <p className="muted">
          <kbd>j</kbd> <kbd>k</kbd> move · <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> sections ·{" "}
          <kbd>/</kbd> filter · <kbd>Ctrl</kbd> <kbd>K</kbd> jump anywhere
        </p>
      </aside>
    );
  }
  const section = sectionOf(row.section);
  const { Details } = section;
  return (
    <aside className="inspector" aria-label="Details">
      <header className="insp-head">
        {row.line ? <Bullet line={row.line} /> : <Icon name="command" />}
        <h2 ref={heading} tabIndex={-1}>
          {section.heading(row)}
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
