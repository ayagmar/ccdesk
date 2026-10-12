import { type Reference } from "../shared/types.ts";

// Claude Code's settings data, sent by the server once; useConfig shows no directory before it is set.
let loaded: Reference = { schemaSource: "", settings: {}, catalog: [], hookEvents: [] };

export function setReference(reference: Reference) {
  loaded = reference;
}

export function reference(): Reference {
  return loaded;
}
