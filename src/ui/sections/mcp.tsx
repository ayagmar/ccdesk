import { STATUS } from "../../view/sections/mcp.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { Bullet } from "../Bullet.tsx";
import { tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { McpEditor } from "../McpEditor.tsx";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { type SectionUi } from "./types.ts";

type R = RowOf<"mcp">;

export const mcp: SectionUi<R> = {
  cells: (row, _actions, name) => {
    const m = row.item;
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td className="mono">
          <NameButton {...name}>{m.name}</NameButton>
        </td>
        <td>{m.transport}</td>
        <td className="mono value">{tildeAll(m.target)}</td>
        <td>
          <span className={m.status === "active" ? "muted" : "flag warn"} title={m.note}>
            {STATUS[m.status]}
          </span>
        </td>
      </>
    );
  },
  Head: ({ actions }) => (
    <button type="button" className="head-action" onClick={() => actions.onAdd("mcp")}>
      <Icon name="plus" /> Add server
    </button>
  ),
  Details: ({ row, actions }) => {
    const m = row.item;
    return (
      <>
        <p className={`verdict ${m.status === "active" ? "ok" : "off"}`}>
          {m.note ??
            "Configured and allowed here, so Claude Code starts it with each session. ccdesk does not connect, so it cannot tell whether the server works."}
        </p>
        <dl className="fields">
          <Field label="Defined for">{m.scope}</Field>
          {m.plugin && <Field label="Plugin">{m.plugin}</Field>}
          <Field label="Transport">{m.transport}</Field>
          <Field label="Target">
            <span className="mono wrap">{tildeAll(m.target)}</span>
          </Field>
          <Field label="Defined in">
            <PathValue path={m.sourcePath} />
          </Field>
          {m.approvals && (
            <Field label="Approval">
              <ul className="plain">
                {m.approvals.map((a) => (
                  <li key={`${a.key}:${a.path}`}>
                    <span className="mono">{a.key}</span>{" "}
                    {a.source === "claude-json"
                      ? "from your answer to Claude Code's prompt"
                      : `in ${a.source} settings`}
                    {!a.counts && ", which counts once you trust this folder"}
                    <br />
                    <PathValue path={a.path} />
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
        <p className="muted small">Environment variables and headers are hidden.</p>
        <h3 className="sub-title">Change this server</h3>
        <McpEditor key={row.id} view={actions.view} server={m} onSaved={actions.onSaved} />
      </>
    );
  },
};
