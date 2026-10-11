import { type McpStatus } from "../../shared/types.ts";
import { Bullet } from "../Bullet.tsx";
import { tildeAll } from "../format.ts";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"mcp">;

const STATUS: Record<McpStatus, string> = {
  active: "configured",
  pending: "needs approval",
  shadowed: "overridden",
  disabled: "turned off",
  rejected: "rejected",
  blocked: "blocked",
  invalid: "invalid",
};

export const mcp = defineSection<R>({
  id: "mcp",
  title: "MCP servers",
  rows: (view) =>
    view.inventory.mcpServers.map((item) => ({
      id: `mcp:${item.scope}:${item.plugin ?? ""}:${item.name}`,
      section: "mcp",
      line: item.scope,
      item,
    })),
  columns: [
    { label: "", sort: (r) => r.item.scope },
    { label: "Server", sort: (r) => r.item.name },
    { label: "Transport", sort: (r) => r.item.transport },
    { label: "Target" },
    { label: "Status", sort: (r) => Object.keys(STATUS).indexOf(r.item.status) },
  ],
  cells: (row, _actions, select) => {
    const m = row.item;
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td className="mono">
          <NameButton onClick={select}>{m.name}</NameButton>
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
  empty: () => "No MCP servers are configured for this directory.",
  dimmed: (row) => row.item.status !== "active",
  text: (row) => `${row.item.name} ${row.item.target}`,
  label: (row) => `MCP ${row.item.name}`,
  heading: (row) => row.item.name,
  facet: {
    label: "Filter MCP servers by status",
    of: (row) => STATUS[row.item.status],
    order: Object.values(STATUS),
  },
  Details: ({ row }) => {
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
        </dl>
        <p className="muted small">Environment variables and headers are hidden.</p>
      </>
    );
  },
});
