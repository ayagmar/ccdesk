import { type McpStatus } from "../../shared/types.ts";
import { defineSection, type RowOf } from "./types.ts";

type R = RowOf<"mcp">;

export const STATUS: Record<McpStatus, string> = {
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
  empty: () => "No MCP servers are configured for this directory.",
  dimmed: (row) => row.item.status !== "active",
  text: (row) => `${row.item.name} ${row.item.target}`,
  label: (row) => ({ kind: "MCP server", name: row.item.name }),
  heading: (row) => row.item.name,
  facet: {
    label: "Filter MCP servers by status",
    of: (row) => STATUS[row.item.status],
    order: () => Object.values(STATUS),
  },
});
