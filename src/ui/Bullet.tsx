import { LINES, type Line } from "../view/lines.ts";

/** A route bullet: the letter and colour of the scope something comes from. */
export function Bullet({ line, hollow = false }: { line: Line; hollow?: boolean }) {
  const info = LINES.find((l) => l.line === line);
  return (
    <span className={`bullet bullet-${line}${hollow ? " hollow" : ""}`} title={info?.name}>
      {info?.letter}
    </span>
  );
}
