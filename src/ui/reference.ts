import { type Reference } from "../shared/types.ts";

// Claude Code's settings data, sent by the server once; useConfig shows no directory before it is set.
let loaded: Reference = { schemaSource: "", settings: {}, catalog: [], hookEvents: [] };

export function setReference(next: Reference) {
  loaded = next;
}

export function reference(): Reference {
  return loaded;
}
