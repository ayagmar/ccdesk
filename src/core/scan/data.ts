import { parse as parseYaml } from "yaml";

// Checks on parsed data shared by file reading and redaction, kept apart so neither imports the other.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

/**
 * JSON.parse after dropping a leading byte order mark, as Claude Code does before it parses a
 * settings, MCP or state file (observed in v2.1.296 and the SDK's safeParseJSON; the docs do not
 * say). Windows PowerShell 5.1 and some editors write one.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
}

export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  try {
    const data: unknown = parseYaml(match[1] ?? "");
    return { data: isRecord(data) ? data : {}, body: text.slice(match[0].length) };
  } catch {
    return { data: {}, body: text.slice(match[0].length) };
  }
}
