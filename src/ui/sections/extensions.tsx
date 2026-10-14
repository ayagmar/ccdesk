import { type Entry } from "../../shared/types.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { AgentEditor } from "../AgentEditor.tsx";
import { Bullet } from "../Bullet.tsx";
import { ago, tilde } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { Contents, Field, LinkMark, NameButton, PathValue } from "./kit.tsx";
import { type SectionUi } from "./types.ts";

type R = RowOf<"extensions">;

/**
 * Why an agent, skill or command is not offered to Claude as usual, if it is not: a word for the
 * row's badge and the full reason for its tooltip and the inspector.
 */
function notOffered(e: Entry): { badge: string; why: string } | null {
  if (e.skipped) return { badge: "skipped", why: `skipped by Claude Code: ${e.skipped}` };
  if (e.shadowedBy)
    return {
      badge: "shadowed",
      why: `not used: ${tilde(e.shadowedBy)} defines this name with higher priority`,
    };
  if (e.override === "off") return { badge: "hidden", why: "hidden by skillOverrides" };
  if (e.override === "user-invocable-only")
    return {
      badge: "on request",
      why: "only when you call it: skillOverrides hides it from Claude",
    };
  if (e.override === "name-only")
    return { badge: "name only", why: "listed to Claude by name only (skillOverrides)" };
  return null;
}

export const extensions: SectionUi<R> = {
  cells: (row, _actions, name) => {
    if (row.kind === "plugin") {
      const p = row.item;
      return (
        <>
          <td>
            <Bullet line="plugin" hollow={!p.enabled} />
          </td>
          <td>plugin</td>
          <td className="mono">
            <NameButton {...name}>{p.id}</NameButton>
          </td>
          <td className="desc">
            v{p.version} · {p.note}
          </td>
        </>
      );
    }
    const e = row.item;
    const off = notOffered(e);
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td>{row.kind}</td>
        <td className="mono">
          <NameButton {...name}>{e.id ?? e.name}</NameButton>
          <LinkMark realPath={e.realPath} />
        </td>
        <td className="desc">
          {e.synced && <span className="flag">claude.ai sync</span>}{" "}
          {off && (
            <span className="flag warn" title={off.why}>
              {off.badge}
            </span>
          )}{" "}
          {e.description}
        </td>
      </>
    );
  },
  Head: ({ actions }) => (
    <button
      type="button"
      className="head-action"
      data-adds="agent"
      onClick={() => actions.onAdd("agent")}
    >
      <Icon name="plus" /> Create agent
    </button>
  ),
  Details: ({ row, actions }) => {
    if (row.kind === "plugin") {
      const p = row.item;
      return (
        <dl className="fields">
          <Field label="Version">{p.version}</Field>
          <Field label="Status">{p.note}</Field>
          <Field label="Installed for">{p.scope}</Field>
          <Field label="Updated">{ago(p.updated)}</Field>
          <Field label="Folder">
            <PathValue path={p.installPath} />
          </Field>
        </dl>
      );
    }
    const e = row.item;
    const off = notOffered(e);
    return (
      <>
        {e.description && <p className="verdict">{e.description}</p>}
        <dl className="fields">
          <Field label="Kind">{row.kind}</Field>
          <Field label="Path">
            <PathValue path={e.path} />
          </Field>
          {e.realPath && (
            <Field label="Links to">
              <PathValue path={e.realPath} />
            </Field>
          )}
          {off ? (
            <Field label="Offered">{off.why}</Field>
          ) : (
            e.listed === false && (
              <Field label="Invoked">
                only when you call it; Claude does not pick it on its own
              </Field>
            )
          )}
          {e.paths && (
            <Field label="Applies to">
              <span className="mono">{e.paths.join(", ")}</span>
            </Field>
          )}
          {e.model && <Field label="Model">{e.model}</Field>}
          {e.plugin && <Field label="Plugin">{e.plugin}</Field>}
        </dl>
        {row.kind === "agent" && (e.scope === "user" || e.scope === "project") ? (
          <>
            <h3 className="sub-title">Change this agent</h3>
            <AgentEditor key={row.id} view={actions.view} agent={e} onSaved={actions.onSaved} />
          </>
        ) : (
          <Contents text={e.text} />
        )}
      </>
    );
  },
};
