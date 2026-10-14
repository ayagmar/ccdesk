import { diffLines, withContext } from "../view/diff.ts";

const MARK = { add: "+ ", remove: "- ", same: "  " } as const;

/**
 * Starts a wrapped line's next lines under its text: past the mark and the line's own indent, up to
 * a point. The 10px is the line's padding in styles.css.
 */
function hanging(text: string): { paddingLeft: string; textIndent: string } {
  // Columns from the start of the line, mark included; a tab goes to the next stop of 8.
  let column = MARK.add.length;
  for (const char of text) {
    if (char === " ") column += 1;
    else if (char === "\t") column += 8 - (column % 8);
    else break;
  }
  // The browser counts tab stops from where the text indent leaves the line, so a line with a tab
  // keeps them where they were only with a hang of whole stops; at least one, to clear the mark.
  if (text.includes("\t")) column = Math.max(8, column - (column % 8));
  const hang = `${Math.min(column, 16)}ch`;
  return { paddingLeft: `calc(10px + ${hang})`, textIndent: `-${hang}` };
}

/** A line diff with unchanged stretches folded, as the settings review and restore show it. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const rows = withContext(diffLines(before, after));
  return (
    <pre className="diff">
      {rows.map((row, i) =>
        row.kind === "skip" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a diff is rendered once and never reordered.
          <span key={i} className="diff-skip">
            {`  … ${row.count} unchanged ${row.count === 1 ? "line" : "lines"}\n`}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a diff is rendered once and never reordered.
          <span key={i} className={`diff-${row.kind}`} style={hanging(row.text)}>
            {MARK[row.kind]}
            {row.text}
            {"\n"}
          </span>
        )
      )}
    </pre>
  );
}
