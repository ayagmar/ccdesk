/** Claude Code accepts spaces after either `---` (observed in v2.1.296; the docs do not say). */
export const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
