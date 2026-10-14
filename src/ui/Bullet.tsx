import { LINES, type Line } from "../view/lines.ts";

/** A route bullet: the letter and colour of the scope something comes from. */
export function Bullet({ line, hollow = false }: { line: Line; hollow?: boolean }) {
  const info = LINES.find((l) => l.line === line);
  return (
    // An image named for its scope, so a screen reader says "User" rather than the letter "U".
    <span
      className={`bullet bullet-${line}${hollow ? " hollow" : ""}`}
      role="img"
      aria-label={info?.name}
      title={info?.name}
    >
      {info?.letter}
    </span>
  );
}
