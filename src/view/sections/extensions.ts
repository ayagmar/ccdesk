import { defineSection, type EntryKind, type RowOf } from "./types.ts";

type R = RowOf<"extensions">;

const KINDS = ["agent", "skill", "command", "output style", "plugin"];

export const extensions = defineSection<R>({
  id: "extensions",
  title: "Agents, skills & plugins",
  short: "Extensions",
  rows: (view) => {
    const inv = view.inventory;
    const entries: [EntryKind, typeof inv.agents][] = [
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
          // Two skills-dir copies can share an id, so the folder tells them apart.
          id: `plug:${item.id}:${item.installPath}`,
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
  empty: () => "No subagents, skills, commands or plugins.",
  dimmed: (row) =>
    row.kind === "plugin"
      ? !row.item.enabled
      : Boolean(row.item.shadowedBy || row.item.skipped) || row.item.override === "off",
  text: (row) =>
    row.kind === "plugin"
      ? `plugin ${row.item.id}`
      : `${row.kind} ${row.item.id ?? row.item.name} ${row.item.synced ? "claude.ai sync " : ""}${row.item.description}`,
  label: (row) =>
    row.kind === "plugin"
      ? { kind: "plugin", name: row.item.id }
      : { kind: row.kind, name: row.item.id ?? row.item.name },
  heading: (row) => (row.kind === "plugin" ? row.item.id : (row.item.id ?? row.item.name)),
  facet: { label: "Filter by kind", of: (row) => row.kind, order: () => KINDS },
});
