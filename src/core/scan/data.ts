import { parse as parseYaml } from "yaml";

// Checks on parsed data shared by file reading and redaction, kept apart so neither imports the other.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
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
