import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import {
  type ComparedSetting,
  type ComparedValue,
  type Core,
  canonicalRoot,
  type DirectoryView,
  type ForgetPreview,
  type PathMatch,
  type Problem,
  type Scope,
} from "../core/index.ts";
import {
  ago,
  formatter,
  MATCH_KIND,
  plural,
  preview,
  sessionsHere,
  size,
  suggestedRules,
} from "../view/index.ts";

// The subcommands of `ccdesk`. They go through the core and print what the page would show: the
// scan is already redacted, so no value the page hides reaches the terminal. All but forget only
// read; forget asks first and saves what was reviewed, as the page does.

/** `ccdesk scan --json`: the DirectoryView the page gets for `dir`. */
export async function scanJson(core: Core, dir: string): Promise<string> {
  return JSON.stringify(await core.scanDirectory(dir), null, 2);
}

/**
 * `ccdesk explain`: what joins a session started in `dir` once Claude reads or edits `file`, as the
 * page's path test lists it. Both paths are absolute.
 */
export async function explainText(core: Core, dir: string, file: string): Promise<string> {
  const { tilde, relativeTo } = formatter(core.env.home);
  const result = await core.testPath(dir, file);
  if (!result.inside)
    return `${tilde(result.file)} is outside ${tilde(dir)}, so nothing there applies to it.`;

  const name = relativeTo(result.file, dir);
  const note = result.exists ? "" : " (the file does not exist yet; paths are checked anyway)";
  if (result.matches.length === 0) return `Nothing more loads for ${name}${note}.`;
  const shownName = (m: PathMatch) => m.name ?? relativeTo(m.path, dir);
  const width = (cells: string[]) => Math.max(...cells.map((cell) => cell.length));
  const scopeWidth = width(result.matches.map((m) => m.scope));
  const kindWidth = width(result.matches.map((m) => MATCH_KIND[m.kind]));
  const nameWidth = width(result.matches.map(shownName));
  return [
    `Once Claude reads or edits ${name} in ${tilde(dir)}${note}, these load:`,
    ...result.matches.map((m) =>
      [
        "",
        m.scope.padEnd(scopeWidth),
        MATCH_KIND[m.kind].padEnd(kindWidth),
        shownName(m).padEnd(nameWidth),
        m.glob ? `matches ${m.glob}` : "",
      ]
        .join("  ")
        .trimEnd()
    ),
  ].join("\n");
}

/** What `ccdesk check` counts beyond files Claude Code cannot read or parse. */
export interface CheckOptions {
  /** Also fail on files Claude Code reads with some entries skipped. */
  strict: boolean;
  /**
   * Also count files outside the repository and the Claude folder, ~/.claude.json and managed
   * settings, which in CI belong to the runner rather than the repository.
   */
  all: boolean;
}

/**
 * Something wrong with what a session started in a directory loads: a file Claude Code cannot read
 * or parse, or with `setting`, a value Claude Code ignores in that file, and `error` says why.
 */
export interface Finding extends Problem {
  /** The ignored key; for `env`, the key and the names of the ignored variables. */
  setting?: string;
}

/** A finding as `ccdesk check --json` prints it. */
interface CheckedProblem extends Finding {
  /** The path relative to the repository when inside it, otherwise under `~`. */
  file: string;
  /** Whether this problem makes the check fail, given --strict and --all. */
  counted: boolean;
}

/**
 * The problems the scan reports, in the order a reader should fix them: the ones that stop Claude
 * Code from starting, then files it cannot read or parse, then files it reads with entries skipped.
 */
const GROUPS: Array<{ heading: string; has: (p: Problem) => boolean }> = [
  {
    heading: "Claude Code will not start until these are fixed",
    has: (p) => p.blocksStart === true,
  },
  {
    heading: "Claude Code cannot read these files and may skip them",
    has: (p) => !p.blocksStart && !p.partial,
  },
  { heading: "Claude Code may skip entries in these files", has: (p) => p.partial === true },
];

const IGNORED = "Claude Code ignores these settings in the files they are in";

/**
 * What the scan of `view` finds wrong: its problems, then each value Claude Code ignores because of
 * the file it is in. Left out: values waiting for workspace trust, which apply once it is given, and
 * values another file overrules, such as a managed lock, which no edit to this file would fix.
 */
export function findings(view: DirectoryView): Finding[] {
  const ignored = view.effective.flatMap((s) =>
    s.ignored.flatMap((i) => {
      if (i.waitsForTrust || i.overruled) return [];
      // An ignored env holds only the ignored variables, with their values hidden.
      const names =
        s.key === "env" && typeof i.value === "object" && i.value !== null
          ? Object.keys(i.value)
          : [];
      const path = fileWith(view, i.scope, s.key, names[0]);
      if (path === undefined) return [];
      const setting = names.length > 0 ? `${s.key} ${names.join(", ")}` : s.key;
      return [{ path, setting, error: i.reason }];
    })
  );
  return [...view.problems, ...ignored];
}

/**
 * The file of `scope` that sets `key`, and for env the variable `name`: a scope can have two, such
 * as the local file in the folder a session starts in under the repository's own.
 */
function fileWith(
  view: DirectoryView,
  scope: Scope,
  key: string,
  name: string | undefined
): string | undefined {
  const files = view.settings.filter((l) => l.scope === scope && l.data);
  const sets = (data: Record<string, unknown> | null) => {
    const value = data?.[key];
    return name === undefined
      ? value !== undefined
      : typeof value === "object" && value !== null && name in value;
  };
  return (files.find((l) => sets(l.data)) ?? files[0])?.path;
}

/** One finding as a line under its heading. */
export function findingLine(file: string, f: Finding): string {
  return f.setting === undefined ? `${file}: ${f.error}` : `${file}: ${f.setting} (${f.error})`;
}

function isWithin(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * `ccdesk check`: the files Claude Code cannot read or parse in a session started in `dir`, what to
 * print about them, and the exit code: 0 when none counts, 1 when one does, 2 when the check could
 * not run. By default only the repository's own files count: those under the git root (or `dir`
 * outside git) and, for a linked worktree, under the main checkout it reads through to. The Claude
 * folder, ~/.claude.json and managed settings never count without --all, even inside the
 * repository, so the home folder of a CI runner cannot fail the check.
 */
export async function checkDirectory(
  core: Core,
  dir: string,
  options: CheckOptions & { json: boolean }
): Promise<{ output: string; exitCode: 0 | 1 | 2 }> {
  const { env } = core;
  const { tilde, relativeTo } = formatter(env.home);
  let view: DirectoryView;
  let roots: string[];
  try {
    // Git names the root by its real path, so the scan's paths must be real too to fall inside it.
    view = await core.scanDirectory(await realpath(dir));
    roots = [view.gitRoot ?? view.path, await canonicalRoot(view.path)];
  } catch (error) {
    // Not 1: that would read as a broken file in the repository.
    return { output: `ccdesk: ${(error as Error).message}`, exitCode: 2 };
  }
  const ofRunner = (path: string) =>
    path === env.claudeJson || isWithin(env.claudeDir, path) || isWithin(env.managedDir, path);
  const inRepository = (path: string) =>
    !ofRunner(path) && roots.some((root) => isWithin(root, path));
  const problems: CheckedProblem[] = findings(view).map((p) => ({
    ...p,
    file: relativeTo(p.path, roots[0] ?? view.path),
    counted: (options.all || inRepository(p.path)) && (options.strict || !p.partial),
  }));
  const failed = problems.some((p) => p.counted);
  const exitCode = failed ? 1 : 0;
  if (options.json) {
    const report = { dir: view.path, root: roots[0], failed, problems };
    return { output: JSON.stringify(report, null, 2), exitCode };
  }

  const lines: string[] = [];
  const shown = options.all ? problems : problems.filter((p) => inRepository(p.path));
  const ignored = shown.filter((p) => p.setting !== undefined);
  for (const { heading, has } of GROUPS) {
    const group = shown.filter((p) => p.setting === undefined && has(p));
    if (group.length === 0) continue;
    const note = group.some((p) => p.counted) ? "" : " (not counted; --strict counts them)";
    lines.push(`${heading}${note}:`, ...group.map((p) => `  ${findingLine(p.file, p)}`), "");
  }
  if (ignored.length > 0)
    lines.push(`${IGNORED}:`, ...ignored.map((p) => `  ${findingLine(p.file, p)}`), "");
  // Outside files with skipped entries are left out: --all alone would not count them either.
  const outside = problems.filter(
    (p) => !shown.includes(p) && (options.strict || !p.partial)
  ).length;
  if (outside > 0)
    lines.push(
      `Not counted: ${plural(outside, "problem")} in the Claude folder, ~/.claude.json, managed settings or outside the repository; --all counts them.`
    );
  const session = `a session started in ${tilde(view.path)}`;
  const counted = problems.filter((p) => p.counted).length;
  lines.push(
    failed
      ? `${plural(counted, "problem")} in ${session}.`
      : `No ${shown.length > 0 ? "counted " : ""}problems in ${session}.`
  );
  return { output: lines.join("\n"), exitCode };
}

/** `ccdesk compare --json`: the settings of `a` and `b` key by key, as the page's compare view gets them. */
export async function compareJson(core: Core, a: string, b: string): Promise<string> {
  return JSON.stringify(await core.compareSettings(a, b), null, 2);
}

/**
 * `ccdesk compare`: the settings Claude Code uses in `a` and in `b` that differ, each with its value
 * and the files it comes from in both, and with `all` the ones they share too. Both paths are
 * absolute.
 */
export async function compareText(core: Core, a: string, b: string, all: boolean): Promise<string> {
  const { tilde, tildeAll, relativeTo } = formatter(core.env.home);
  const { settings } = await core.compareSettings(a, b);
  const [nameA, nameB] = [tilde(a), tilde(b)];
  if (settings.length === 0) return `No settings file sets anything in ${nameA} or ${nameB}.`;

  const width = Math.max(nameA.length, nameB.length);
  const shown = (value: ComparedValue | null) =>
    value ? tildeAll(preview(value.value)) : "not set";
  const from = (value: ComparedValue | null, dir: string) =>
    value
      ? `  (${value.sources.map((s) => `${s.scope} ${relativeTo(s.path, dir)}`).join(", ")})`
      : "";
  const block = (s: ComparedSetting) => {
    const valueWidth = Math.max(shown(s.a).length, shown(s.b).length);
    const side = (name: string, value: ComparedValue | null, dir: string) =>
      `    ${name.padEnd(width)}  ${shown(value).padEnd(value ? valueWidth : 0)}${from(value, dir)}`;
    return [
      `  ${s.key}${s.hiddenDiffers ? "  (the hidden values differ)" : ""}`,
      side(nameA, s.a, a),
      side(nameB, s.b, b),
    ];
  };
  const differing = settings.filter((s) => !s.same);
  const shared = settings.filter((s) => s.same);
  const lines =
    differing.length > 0
      ? [`Settings that differ between ${nameA} and ${nameB}:`, ...differing.flatMap(block)]
      : [`${nameA} and ${nameB} use the same settings.`];
  if (shared.length > 0)
    lines.push(
      "",
      ...(all
        ? ["Settings both share:", ...shared.flatMap(block)]
        : [`Same in both: ${plural(shared.length, "setting")}; --all lists them.`])
    );
  return lines.join("\n");
}

/**
 * The allow rules the page suggests under Permissions for `dir`: counted against the rules in
 * effect there, as the page counts them, less any rule in effect.
 */
async function suggestions(core: Core, dir: string) {
  const view = await core.scanDirectory(dir);
  const rules = view.permissions.flatMap((p) =>
    p.kind === "rule" && p.inEffect ? [{ list: p.list, rule: p.rule }] : []
  );
  const usage = await core.readUsage(dir, rules, { profile: view.profile });
  return { view, usage, suggested: suggestedRules({ ...view, usage }) };
}

/** `ccdesk rules --suggest --json`: the suggested rules for `dir`, with the sessions they come from. */
export async function suggestJson(core: Core, dir: string): Promise<string> {
  const { view, usage, suggested } = await suggestions(core, dir);
  const { sessions, repository, since } = usage;
  const report = { dir: view.path, sessions, repository, since, suggestions: suggested };
  return JSON.stringify(report, null, 2);
}

/**
 * `ccdesk rules --suggest`: the allow rules that would have covered calls you approved by hand in
 * the sessions started in `dir`, most approved first. Only rule patterns and counts, as the page
 * shows. `dir` is absolute.
 */
export async function suggestText(core: Core, dir: string): Promise<string> {
  const { tilde } = formatter(core.env.home);
  const { usage, suggested } = await suggestions(core, dir);
  if (usage.sessions === 0)
    return `No sessions started in ${tilde(dir)} yet, so there are no calls to suggest rules from.`;
  if (suggested.length === 0)
    return `Nothing to suggest: no call you approved by hand in ${sessionsHere(usage)} needs a new allow rule.`;

  const width = Math.max(...suggested.map((a) => a.rule.length));
  return [
    `Allow rules for ${tilde(dir)}, from calls you approved in ${sessionsHere(usage)}:`,
    ...suggested.map(
      (a) =>
        `  ${a.rule.padEnd(width)}  approved ${plural(a.approved, "time")}, last ${ago(a.last)}`
    ),
    "",
    "Add one under permissions.allow in .claude/settings.local.json, or select it under Permissions on the page to review it first.",
  ].join("\n");
}

/** Prints the review and asks whether to go ahead with `question`; resolves true to go ahead. */
export type Confirm = (review: string, question: string) => Promise<boolean>;

/**
 * `ccdesk forget`: forgets each of `dirs`, or with `dirs` null every listed directory whose folder
 * is gone, as the page's Forget button does. Each store is reviewed first and `confirm` is asked
 * once for all of them; a store that changed since then is not forgotten. Exits 0 when every
 * directory asked for is forgotten, 1 when one is refused or `confirm` says no. Paths are absolute.
 */
export async function forgetDirectories(
  core: Core,
  dirs: string[] | null,
  launchDir: string,
  confirm: Confirm
): Promise<{ output: string; exitCode: 0 | 1 }> {
  const { tilde, tildeAll } = formatter(core.env.home);
  const targets =
    dirs ??
    (await core.scanOverview(launchDir)).projects.filter((p) => !p.exists).map((p) => p.path);
  if (targets.length === 0) return { output: "No directory whose folder is gone.", exitCode: 0 };

  const reviewed: ForgetPreview[] = [];
  const refused: string[] = [];
  const refuse = (dir: string, error: unknown) =>
    refused.push(`  ${tilde(dir)}: ${tildeAll((error as Error).message)}`);
  for (const dir of targets)
    await core.previewForget(dir, launchDir).then(
      (review) => reviewed.push(review),
      (error: unknown) => refuse(dir, error)
    );
  const lines: string[] = [];
  if (reviewed.length > 0)
    lines.push(
      `Forgetting moves ${reviewed.length === 1 ? "this store" : "these stores"} into ccdesk's backups:`,
      ...reviewed.flatMap((p) => [
        `  ${tilde(p.path)}  ${plural(p.sessions, "session")}, ${plural(p.memories, "memory", "memories")}, ${size(p.bytes)}, from ${tilde(p.store)}`,
        ...(p.recentlyActive
          ? [
              "    A session was written here in the last few minutes. If Claude Code is still running in this directory, quit it first: its next message would start a new store.",
            ]
          : []),
      ])
    );
  if (refused.length > 0) lines.push("Not forgotten:", ...refused);
  if (reviewed.some((p) => p.claudeJsonEntry))
    lines.push(
      "Entries in ~/.claude.json, with your trust answers, stay: ccdesk does not change that file."
    );
  if (reviewed.length === 0) return { output: lines.join("\n"), exitCode: 1 };

  const [only] = reviewed;
  const question = `Forget ${reviewed.length === 1 && only ? tilde(only.path) : plural(reviewed.length, "directory", "directories")}?`;
  if (!(await confirm(lines.join("\n"), question)))
    return { output: "Nothing forgotten.", exitCode: 1 };

  const done: string[] = [];
  const failed: string[] = [];
  for (const p of reviewed)
    await core.forgetDirectory(p.path, launchDir, p.revision).then(
      () => done.push(`Forgot ${tilde(p.path)}.`),
      (error: unknown) =>
        failed.push(`Not forgotten: ${tilde(p.path)}: ${tildeAll((error as Error).message)}`)
    );
  if (done.length > 0)
    done.push(`Recent changes on the page can move ${done.length === 1 ? "it" : "them"} back.`);
  return {
    output: [...done, ...failed].join("\n"),
    exitCode: refused.length + failed.length > 0 ? 1 : 0,
  };
}
