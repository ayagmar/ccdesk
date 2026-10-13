import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FRONTMATTER, isRecord, parseJson } from "./scan/data.ts";

/**
 * A server URL as ccdesk shows it: a user name, password or query string can carry a key, so they
 * are hidden, as Claude Code hides the URL in its own status output (docs: mcp).
 */
export function shownUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password && !u.search) return url;
    if (u.username || u.password) {
      u.username = "•••";
      u.password = "";
    }
    if (u.search) u.search = "?•••";
    return decodeURI(u.toString());
  } catch {
    return url.replace(/\/\/[^/@]*@/, "//•••@").replace(/\?.*$/, "?•••");
  }
}

/** A flag whose value is a secret, such as `--token` or `--api-key`. */
const SECRET_FLAG = /^--(token|api[-_]?key|apikey|password|secret|auth|key)$/i;
/** A value that starts like a common API key or token. */
const KEY_PREFIX = /^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[bp]-|glpat-|AKIA[0-9A-Z]{16})/;

/**
 * A server's command-line arguments as ccdesk shows them: the value after a secret flag, given as
 * `--token value` or `--token=value`, a value that starts like a known key, and the credentials in
 * a URL are hidden.
 */
function shownArgs(args: unknown[]): unknown[] {
  return args.map((arg, i) => {
    if (typeof arg !== "string") return arg;
    const previous = args[i - 1];
    if (typeof previous === "string" && SECRET_FLAG.test(previous) && !arg.startsWith("-"))
      return "•••";
    const equals = arg.indexOf("=");
    if (equals > 0) {
      const name = arg.slice(0, equals);
      if (SECRET_FLAG.test(name) || KEY_PREFIX.test(arg.slice(equals + 1))) return `${name}=•••`;
    }
    if (KEY_PREFIX.test(arg)) return "•••";
    if (/^https?:\/\//i.test(arg)) return shownUrl(arg);
    return arg;
  });
}

/**
 * Replace values that commonly hold secrets with a placeholder, keeping the keys: env and headers
 * values, the user, password and query of a `url`, and secret values in the `args` of a command.
 */
export function redactSecrets(value: Record<string, unknown>): Record<string, unknown>;
export function redactSecrets(value: unknown): unknown;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return value;
  // Built with fromEntries: assigning a key named __proto__ would set the prototype instead.
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if ((key === "env" || key === "headers") && isRecord(inner))
        return [key, Object.fromEntries(Object.keys(inner).map((k) => [k, "•••"]))];
      if (key === "url" && typeof inner === "string") return [key, shownUrl(inner)];
      if (key === "args" && "command" in value && Array.isArray(inner))
        return [key, shownArgs(inner)];
      return [key, redactSecrets(inner)];
    })
  );
}

/**
 * A JSON parse failure without the parser's message, which quotes the text around the fault and
 * so can quote a secret.
 */
export function jsonSyntaxError(error: unknown): string {
  const at = /line (\d+) column (\d+)/.exec(String(error));
  return at ? `not valid JSON (line ${at[1]}, column ${at[2]})` : "not valid JSON";
}

/**
 * The text ccdesk shows for a file reached as an instruction, import, memory, agent or skill. A
 * settings or MCP file read this way, whatever it is named, would otherwise show its env and
 * headers values, so anything that parses as JSON is shown parsed with them hidden. Frontmatter can
 * hold the same values, in a subagent's inline MCP servers (docs: sub-agents#scope-mcp-servers-to-a-subagent),
 * so frontmatter that holds any is shown re-written with them hidden.
 */
export function shownText(text: string | null): string | null {
  if (text === null) return null;
  let data: unknown;
  try {
    data = parseJson(text);
  } catch {
    return shownFrontmatter(text);
  }
  return typeof data === "object" && data !== null
    ? `${JSON.stringify(redactSecrets(data), null, 2)}\n`
    : text;
}

function shownFrontmatter(text: string): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? "");
  } catch {
    return text;
  }
  const redacted = redactSecrets(data);
  if (JSON.stringify(redacted) === JSON.stringify(data)) return text;
  return `---\n${stringifyYaml(redacted)}---\n${text.slice(match[0].length)}`;
}

/** A file named .json that does not parse is not shown: its text could still hold a secret. */
export function shownJsonFile(text: string): string {
  try {
    parseJson(text);
  } catch {
    return "(a JSON file ccdesk could not parse, so its text is not shown; open it to see it)\n";
  }
  return shownText(text) ?? "";
}

/**
 * Helpers for the values ccdesk hides. What is hidden is decided only by redactSecrets; these
 * compare a value with its redacted form.
 */

/** A value as ccdesk shows it: JSON with hidden values as •••. */
export function shown(value: unknown): string {
  return `${JSON.stringify(redactSecrets(value), null, 2)}\n`;
}

interface Hidden {
  /** Where the value is, as JSON keys and indexes. */
  path: Array<string | number>;
  raw: unknown;
  shown: unknown;
}

/** Every value redactSecrets changes, with where it is, what it is, and how it is shown. */
function hiddenIn(value: unknown): Hidden[] {
  const found: Hidden[] = [];
  // redactSecrets keeps every key and list length, so the two can be walked side by side.
  const walk = (raw: unknown, shownValue: unknown, path: Array<string | number>) => {
    if (Array.isArray(raw) && Array.isArray(shownValue)) {
      for (const [i, inner] of raw.entries()) walk(inner, shownValue[i], [...path, i]);
    } else if (isRecord(raw) && isRecord(shownValue))
      for (const [key, inner] of Object.entries(raw)) walk(inner, shownValue[key], [...path, key]);
    else if (raw !== shownValue) found.push({ path, raw, shown: shownValue });
  };
  walk(value, redactSecrets(value), []);
  return found;
}

export function hasHiddenValues(value: unknown): boolean {
  return hiddenIn(value).length > 0;
}

/**
 * A fingerprint of the hidden values in a JSON file, so a restore can tell whether they changed.
 * Null for a file that is not valid JSON.
 */
export function hiddenValues(text: string | null): string | null {
  try {
    const data: unknown = text === null ? null : parseJson(text);
    return JSON.stringify(hiddenIn(data).map(({ path, raw }) => [path, raw]));
  } catch {
    return null;
  }
}

/**
 * The secret text in a value, to take out of a message that may quote it: an env or header value
 * or a hidden argument whole, the part after `=` of `--token=value`, and a URL's user name,
 * password and query. Longest first, so a secret that contains another is taken out whole.
 */
export function secretTexts(value: unknown): string[] {
  const found = hiddenIn(value).flatMap(({ raw, shown: hidden }): Array<string | undefined> => {
    if (typeof raw !== "string") return [];
    if (hidden === "•••") return [raw];
    if (typeof hidden === "string" && hidden.endsWith("=•••"))
      return [raw.slice(raw.indexOf("=") + 1)];
    if (shownUrl(raw) === raw) return [];
    const url = URL.parse(raw);
    return [url?.username, url?.password, url?.search.slice(1)];
  });
  return found
    .filter((s): s is string => s !== undefined && s !== "")
    .sort((a, b) => b.length - a.length);
}
