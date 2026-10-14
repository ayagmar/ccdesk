import { type DirectoryView } from "../shared/types.ts";
import { plural } from "./format.ts";
import { LINES, type Line } from "./lines.ts";

/** A stop on the route strip: one scope Claude Code loads from, in load order. */
export interface Stop {
  line: Line;
  name: string;
  /** What this stop contributes when Claude starts here. */
  facts: string[];
  /** Settings files of this scope that are there but could not be read, which Claude Code skips. */
  unreadable: number;
  /** Whether the stop has anything to show: something it contributes, or a file that failed. */
  active: boolean;
}

/** The directory's stops in load order; Plugin only when a plugin is enabled. */
export function routeStops(view: DirectoryView): Stop[] {
  const inv = view.inventory;
  return LINES.filter((l) => l.line !== "plugin" || inv.plugins.some((p) => p.enabled)).map(
    ({ line, name }) => {
      const facts: string[] = [];
      if (line === "memory") {
        const count = view.memory.memories.length;
        if (count) facts.push(plural(count, "memory", "memories"));
        return { line, name, facts, unreadable: 0, active: count > 0 };
      }
      if (line === "plugin") {
        const enabled = inv.plugins.filter((p) => p.enabled).length;
        if (enabled) facts.push(plural(enabled, "plugin"));
        return { line, name, facts, unreadable: 0, active: enabled > 0 };
      }
      const here = view.instructions.filter((i) => i.scope === line);
      const loaded = here.filter((i) => i.status !== "skipped").length;
      const skipped = here.length - loaded;
      if (loaded) facts.push(plural(loaded, "file"));
      if (skipped) facts.push(`${skipped} skipped`);
      const settings = view.effective.filter((s) => s.from.includes(line)).length;
      if (settings) facts.push(plural(settings, "setting"));
      const hooks = inv.hooks.filter((h) => h.source === line).length;
      if (hooks) facts.push(plural(hooks, "hook"));
      const servers = inv.mcpServers.filter((m) => m.scope === line).length;
      if (servers) facts.push(`${servers} MCP`);
      const extensions = [
        ...inv.agents,
        ...inv.skills,
        ...inv.commands,
        ...inv.outputStyles,
      ].filter((e) => e.scope === line).length;
      if (extensions) facts.push(plural(extensions, "extension"));
      // The same files the problems notice lists, so the strip never calls a broken scope unused.
      const unreadable = view.settings.filter((l) => l.scope === line && l.error).length;
      const extras = hooks + servers + extensions;
      return {
        line,
        name,
        facts,
        unreadable,
        active: loaded > 0 || settings > 0 || extras > 0 || unreadable > 0,
      };
    }
  );
}
