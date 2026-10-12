import { isRecord, redactSecrets, shownUrl } from "./scan/files.ts";

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
    const data: unknown = text === null ? null : JSON.parse(text);
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
  const found = hiddenIn(value).flatMap(({ raw, shown }): Array<string | undefined> => {
    if (typeof raw !== "string") return [];
    if (shown === "•••") return [raw];
    if (typeof shown === "string" && shown.endsWith("=•••"))
      return [raw.slice(raw.indexOf("=") + 1)];
    if (shownUrl(raw) === raw) return [];
    const url = URL.parse(raw);
    return [url?.username, url?.password, url?.search.slice(1)];
  });
  return found.filter((s): s is string => !!s).sort((a, b) => b.length - a.length);
}
