/** Paths shown the way you read them: under your home folder as `~`. */
export interface Formatter {
  /** `/home/me/projects/app` → `~/projects/app`. */
  tilde(path: string): string;
  /** Path relative to `base` when inside it, otherwise the tilde form. */
  relativeTo(path: string, base: string): string;
  /** Every home path inside free text (a hook command, an MCP target) in its tilde form. */
  tildeAll(text: string): string;
  /** True for a file reached through a symlink into ~/.agents, which other coding agents read too. */
  sharedWithAgents(realPath: string | undefined): boolean;
}

/** True when `path` is `base` or inside it, with / or Windows \\ separators. */
function under(path: string, base: string): boolean {
  return path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/** A formatter for `home`; with an empty home, paths are shown in full. */
export function formatter(home: string): Formatter {
  const tilde = (path: string) =>
    home && (path === home || under(path, home)) ? `~${path.slice(home.length)}` : path;
  return {
    tilde,
    relativeTo: (path, base) => (under(path, base) ? path.slice(base.length + 1) : tilde(path)),
    tildeAll: (text) =>
      home ? text.replaceAll(`${home}/`, "~/").replaceAll(`${home}\\`, "~\\") : text,
    sharedWithAgents: (realPath) =>
      realPath !== undefined && /^~[/\\]\.agents[/\\]/.test(tilde(realPath)),
  };
}

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 60) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const PLAIN_KEY = /^[A-Za-z_$][\w$@.-]*$/;

/** A one-line value for a table cell: JSON, minus the quotes on plain keys, with spaces to read by. */
export function preview(value: unknown): string {
  if (typeof value === "string") return value;
  return compact(value);
}

function compact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(
      ([k, v]) => `${PLAIN_KEY.test(k) ? k : JSON.stringify(k)}: ${compact(v)}`
    );
    return entries.length ? `{ ${entries.join(", ")} }` : "{}";
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * A description's first sentence and the rest, which is empty for a single sentence. A sentence
 * ends at a full stop followed by a space and a capital or a quote, as in "true. Default", but not
 * at the one in "e.g." or "i.e.", or one listed as a character, as in "_ - . , only".
 */
export function firstSentence(text: string): [first: string, rest: string] {
  const [, first, rest] = /^(.+?(?<!\b(?:e\.g|i\.e))\.)\s+(?=[A-Z"'`])(.+)$/s.exec(text) ?? [];
  return first && rest ? [first, rest] : [text, ""];
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** A size in KB, or in MB from one MB up. */
export function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A path typed in full: absolute, or under the home folder with ~. */
export function typedPath(query: string, home: string | undefined): string | null {
  const q = query.trim();
  if (home && (q === "~" || q.startsWith("~/"))) return withoutTrailingSlash(home + q.slice(1));
  return q.startsWith("/") || /^[A-Za-z]:[\\/]/.test(q) ? withoutTrailingSlash(q) : null;
}

/** ".../acme-api/" as ".../acme-api", so it matches the directory it names; a root keeps its slash. */
function withoutTrailingSlash(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed === "" || /^[A-Za-z]:$/.test(trimmed) ? path : trimmed;
}
