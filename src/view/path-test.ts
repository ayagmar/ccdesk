import { type PathMatch } from "../shared/types.ts";

/** What each kind of path-test match is called, on the page and by `ccdesk explain`. */
export const MATCH_KIND: Record<PathMatch["kind"], string> = {
  rule: "path rule",
  skill: "skill",
  nested: "folder instructions",
};
