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

/** Claude Code accepts spaces after either `---` (observed in v2.1.296; the docs do not say). */
export const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/** A value YAML reads as something else, or fails on, when it is not quoted. */
const NEEDS_QUOTES = /[{}[\]*&#!|>%@`]|: /;

/**
 * Frontmatter YAML as Claude Code reads it: when it does not parse, it quotes each top-level value
 * that holds a character YAML treats specially, such as `description: Use when: asked`, turns
 * leading tabs into two spaces each, and parses again (observed in v2.1.296; the docs say only
 * that a file whose YAML does not parse is skipped). Throws when that fails too.
 */
export function parseFrontmatterYaml(yaml: string): unknown {
  try {
    return parseYaml(yaml);
  } catch {
    const quoted = yaml
      .split("\n")
      .map((line) => {
        const [, key, value] = /^([a-zA-Z_-]+):\s+(\S.*)$/.exec(line) ?? [];
        if (!key || !value) return line;
        const quotedAlready =
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"));
        if (quotedAlready) return line;
        if (value.startsWith("[") && value.endsWith("]") && isList(value)) return line;
        if (!NEEDS_QUOTES.test(value)) return line;
        return `${key}: "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
      })
      .join("\n")
      .replace(/^\t+/gm, (tabs) => "  ".repeat(tabs.length));
    return parseYaml(quoted);
  }
}

function isList(value: string): boolean {
  try {
    return Array.isArray(parseYaml(value));
  } catch {
    return false;
  }
}

export function parseFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  try {
    const data = parseFrontmatterYaml(match[1] ?? "");
    return { data: isRecord(data) ? data : {}, body: text.slice(match[0].length) };
  } catch {
    return { data: {}, body: text.slice(match[0].length) };
  }
}
