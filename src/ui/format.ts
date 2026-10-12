import { type Formatter, formatter } from "../view/format.ts";

export { ago, plural, preview } from "../view/format.ts";

// The page shows one machine's paths; useConfig sets its home when the overview arrives.
let current = formatter("");

export function setFormatter(next: Formatter) {
  current = next;
}

/** The page's formatter, for code that hands it on, such as a section's label. */
export function pageFormatter(): Formatter {
  return current;
}

export const tilde = (path: string) => current.tilde(path);
export const relativeTo = (path: string, base: string) => current.relativeTo(path, base);
export const tildeAll = (text: string) => current.tildeAll(text);
export const sharedWithAgents = (realPath: string | undefined) =>
  current.sharedWithAgents(realPath);
