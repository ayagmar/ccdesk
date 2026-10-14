import { LINES, type Line } from "../view/lines.ts";

/**
 * A route bullet: the letter and colour of the scope something comes from. To a screen reader it
 * is an image named for its scope, so it says "User" rather than "U"; where the scope's name is
 * written next to it, `ariaHidden` hides it so the name is not read twice.
 */
export function Bullet({
  line,
  hollow = false,
  ariaHidden = false,
}: {
  line: Line;
  hollow?: boolean;
  ariaHidden?: boolean;
}) {
  const info = LINES.find((l) => l.line === line);
  return (
    <span
      className={`bullet bullet-${line}${hollow ? " hollow" : ""}`}
      {...(ariaHidden ? { "aria-hidden": true } : { role: "img", "aria-label": info?.name })}
      title={info?.name}
    >
      {info?.letter}
    </span>
  );
}
