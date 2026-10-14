import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import {
  type Core,
  canonicalRoot,
  type DirectoryView,
  type PathMatch,
  type Problem,
} from "../core/index.ts";
import { formatter, MATCH_KIND, plural } from "../view/index.ts";

// The subcommands of `ccdesk`. They only read, through the core, and print what the page would
// show: the scan is already redacted, so no value the page hides reaches the terminal.

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

/** A problem as `ccdesk check --json` prints it. */
interface CheckedProblem extends Problem {
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
  const problems: CheckedProblem[] = view.problems.map((p) => ({
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
  for (const { heading, has } of GROUPS) {
    const group = shown.filter(has);
    if (group.length === 0) continue;
    const note = group.some((p) => p.counted) ? "" : " (not counted; --strict counts them)";
    lines.push(`${heading}${note}:`, ...group.map((p) => `  ${p.file}: ${p.error}`), "");
  }
  // Outside files with skipped entries are left out: --all alone would not count them either.
  const outside = problems.filter(
    (p) => !shown.includes(p) && (options.strict || !p.partial)
  ).length;
  if (outside > 0)
    lines.push(
      `Not counted: problems in ${plural(outside, "file")} outside the repository; --all counts them.`
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
