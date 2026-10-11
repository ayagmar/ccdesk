import { type Scope } from "../shared/types.ts";

/** A scope on the route strip. Auto memory and plugins get their own lines. */
export type Line = Scope | "memory" | "plugin";

export const LINES: Array<{ line: Line; letter: string; name: string }> = [
  { line: "managed", letter: "M", name: "Managed" },
  { line: "user", letter: "U", name: "User" },
  { line: "project", letter: "P", name: "Project" },
  { line: "local", letter: "L", name: "Local" },
  { line: "memory", letter: "A", name: "Auto memory" },
  { line: "plugin", letter: "X", name: "Plugin" },
];

export function lineName(line: Line): string {
  return LINES.find((l) => l.line === line)?.name ?? line;
}
