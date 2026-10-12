import { type SessionProfile } from "../shared/types.ts";
import { LINES, type Line } from "../view/lines.ts";
import { type SectionId } from "./sections/types.ts";

/**
 * Which page is open: a directory (undefined until the launch directory is known), all
 * directories, recent changes, or the settings of two directories compared.
 */
export type Page =
  | { kind: "directory"; dir: string | undefined; profile: SessionProfile }
  | { kind: "all" }
  | { kind: "changes" }
  | { kind: "compare"; dir: string; other: string };

export interface Sort {
  /** Index into the section's columns. */
  column: number;
  descending: boolean;
}

/** A list's key in the address: a directory section, or "dirs" for all directories. */
type ListId = SectionId | "dirs";

/** How a page's lists are narrowed and ordered; kept in the address so a reload or a shared link keeps it. */
export interface ListState {
  query: string;
  line: Line | null;
  sort: Partial<Record<ListId, Sort>>;
  /** One facet value per section, such as a memory type. */
  only: Partial<Record<ListId, string>>;
}

export const NO_LIST_STATE: ListState = { query: "", line: null, sort: {}, only: {} };

export function readPage(): Page {
  const params = new URLSearchParams(location.search);
  if (params.has("changes")) return { kind: "changes" };
  if (params.has("all")) return { kind: "all" };
  const dir = params.get("dir");
  const other = params.get("compare");
  if (dir && other) return { kind: "compare", dir, other };
  return {
    kind: "directory",
    dir: dir ?? undefined,
    profile: params.get("profile") === "print" ? "print" : "interactive",
  };
}

export function readListState(): ListState {
  const params = new URLSearchParams(location.search);
  const state: ListState = { ...NO_LIST_STATE, sort: {}, only: {} };
  state.query = params.get("q") ?? "";
  const line = params.get("line");
  state.line = LINES.find((l) => l.line === line)?.line ?? null;
  for (const [key, value] of params) {
    const [kind, section] = key.split(".") as [string, ListId | undefined];
    if (!section) continue;
    if (kind === "sort") {
      const match = /^(\d+)(d?)$/.exec(value);
      if (match) state.sort[section] = { column: Number(match[1]), descending: match[2] === "d" };
    } else if (kind === "only") state.only[section] = value;
  }
  return state;
}

function pageParams(page: Page): URLSearchParams {
  if (page.kind === "changes") return new URLSearchParams("changes");
  if (page.kind === "all") return new URLSearchParams("all");
  if (page.kind === "compare") return new URLSearchParams({ dir: page.dir, compare: page.other });
  const params = new URLSearchParams(page.dir ? { dir: page.dir } : {});
  if (page.profile !== "interactive") params.set("profile", page.profile);
  return params;
}

function write(params: URLSearchParams, push: boolean) {
  // "changes=" and "all=" read better without the equals sign.
  const query = params.toString().replace(/^(changes|all)=(&|$)/, "$1$2");
  const url = query ? `?${query}` : location.pathname;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

/** Opens another page; its lists start unfiltered. */
export function pushPage(page: Page) {
  write(pageParams(page), true);
}

export function replaceListState(page: Page, state: ListState) {
  const params = pageParams(page);
  if (state.query) params.set("q", state.query);
  if (state.line) params.set("line", state.line);
  for (const [section, sort] of Object.entries(state.sort))
    if (sort) params.set(`sort.${section}`, `${sort.column}${sort.descending ? "d" : ""}`);
  for (const [section, value] of Object.entries(state.only))
    if (value) params.set(`only.${section}`, value);
  write(params, false);
}
