import { type Entry } from "../../shared/types.ts";
import { AgentEditor } from "../AgentEditor.tsx";
import { Bullet } from "../Bullet.tsx";
import { ago, tilde } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { Contents, Field, LinkMark, NameButton, PathValue, stripFrontmatter } from "./kit.tsx";
import { defineSection, type EntryKind, type RowOf } from "./types.ts";

type R = RowOf<"extensions">;

const KINDS = ["agent", "skill", "command", "output style", "plugin"];

/** Why an agent, skill or command is not offered to Claude as usual, if it is not. */
function notOffered(e: Entry): string | null {
  if (e.shadowedBy)
    return `not used: ${tilde(e.shadowedBy)} defines this name with higher priority`;
  if (e.override === "off") return "hidden by skillOverrides";
  if (e.override === "user-invocable-only")
    return "only when you call it: skillOverrides hides it from Claude";
  if (e.override === "name-only") return "listed to Claude by name only (skillOverrides)";
  return null;
}

export const extensions = defineSection<R>({
  id: "extensions",
  title: "Agents, skills & plugins",
  short: "Extensions",
  rows: (view) => {
    const inv = view.inventory;
    const entries: Array<[EntryKind, typeof inv.agents]> = [
      ["agent", inv.agents],
      ["skill", inv.skills],
      ["command", inv.commands],
      ["output style", inv.outputStyles],
    ];
    return [
      ...entries.flatMap(([kind, list]) =>
        list.map(
          (item): R => ({
            id: `ent:${kind}:${item.path}`,
            section: "extensions",
            line: item.scope,
            item,
            kind,
          })
        )
      ),
      ...inv.plugins.map(
        (item): R => ({
          id: `plug:${item.id}`,
          section: "extensions",
          line: "plugin",
          item,
          kind: "plugin",
        })
      ),
    ];
  },
  columns: [
    { label: "", sort: (r) => r.line },
    { label: "Kind", sort: (r) => KINDS.indexOf(r.kind) },
    { label: "Name", sort: (r) => (r.kind === "plugin" ? r.item.id : (r.item.id ?? r.item.name)) },
    { label: "Description" },
  ],
  cells: (row, _actions, select) => {
    if (row.kind === "plugin") {
      const p = row.item;
      return (
        <>
          <td>
            <Bullet line="plugin" hollow={!p.enabled} />
          </td>
          <td>plugin</td>
          <td className="mono">
            <NameButton onClick={select}>{p.id}</NameButton>
          </td>
          <td className="desc">
            v{p.version} · {p.note}
          </td>
        </>
      );
    }
    const e = row.item;
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td>{row.kind}</td>
        <td className="mono">
          <NameButton onClick={select}>{e.id ?? e.name}</NameButton>
          <LinkMark realPath={e.realPath} />
        </td>
        <td className="desc">
          {notOffered(e) && <span className="flag warn">{notOffered(e)}</span>} {e.description}
        </td>
      </>
    );
  },
  empty: () => "No subagents, skills, commands or plugins.",
  dimmed: (row) =>
    row.kind === "plugin"
      ? !row.item.enabled
      : Boolean(row.item.shadowedBy) || row.item.override === "off",
  text: (row) =>
    row.kind === "plugin"
      ? `plugin ${row.item.id}`
      : `${row.kind} ${row.item.id ?? row.item.name} ${row.item.description}`,
  label: (row) =>
    row.kind === "plugin" ? `plugin ${row.item.id}` : `${row.kind} ${row.item.id ?? row.item.name}`,
  heading: (row) => (row.kind === "plugin" ? row.item.id : (row.item.id ?? row.item.name)),
  facet: { label: "Filter by kind", of: (row) => row.kind, order: KINDS },
  Head: ({ actions }) => (
    <button type="button" className="head-action" onClick={() => actions.onAdd("agent")}>
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
          {notOffered(e) ? (
            <Field label="Offered">{notOffered(e)}</Field>
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
          <Contents text={stripFrontmatter(e.text)} />
        )}
      </>
    );
  },
});
