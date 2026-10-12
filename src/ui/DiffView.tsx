import { diffLines, withContext } from "../view/diff.ts";

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
          <span key={i} className={`diff-${row.kind}`}>
            {row.kind === "add" ? "+ " : row.kind === "remove" ? "- " : "  "}
            {row.text}
            {"\n"}
          </span>
        )
      )}
    </pre>
  );
}
