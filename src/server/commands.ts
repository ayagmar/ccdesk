import { type Core, type PathMatch } from "../core/index.ts";
import { formatter, MATCH_KIND } from "../view/index.ts";

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
