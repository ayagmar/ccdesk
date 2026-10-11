let home = "";

export function setHome(path: string) {
  home = path;
}

/** True when `path` is `base` or inside it, with / or Windows \\ separators. */
function under(path: string, base: string): boolean {
  return path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/** `/home/me/projects/app` → `~/projects/app`. */
export function tilde(path: string): string {
  if (home && (path === home || under(path, home))) return `~${path.slice(home.length)}`;
  return path;
}

/** Path relative to `base` when inside it, otherwise the tilde form. */
export function relativeTo(path: string, base: string): string {
  if (under(path, base)) return path.slice(base.length + 1);
  return tilde(path);
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

/** Every home path inside free text (a hook command, an MCP target) in its tilde form. */
export function tildeAll(text: string): string {
  return home ? text.replaceAll(`${home}/`, "~/").replaceAll(`${home}\\`, "~\\") : text;
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

/** True for a file reached through a symlink into ~/.agents, which other coding agents read too. */
export function sharedWithAgents(realPath: string | undefined): boolean {
  return realPath !== undefined && /^~[/\\]\.agents[/\\]/.test(tilde(realPath));
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
