import { useEffect, useState } from "react";
import { type ComparedValue, type SettingsComparison } from "../shared/compare.ts";
import { api } from "./api.ts";
import { Bullet } from "./Bullet.tsx";
import { preview, relativeTo, tilde, tildeAll } from "./format.ts";

interface Props {
  dir: string;
  other: string;
  onOpen: (path: string) => void;
  onPickOther: () => void;
}

/** One side of a row: the value, and the files it comes from relative to that directory. */
function ValueCell({ value, dir }: { value: ComparedValue | null; dir: string }) {
  if (!value) return <td className="muted">not set</td>;
  const text = tildeAll(preview(value.value));
  return (
    <td>
      <span className="cmp-value mono" title={text}>
        {text}
      </span>
      <span className="cmp-from">
        {value.sources.map((s) => (
          <span key={s.path} title={s.path}>
            <Bullet line={s.scope} /> <span className="mono">{relativeTo(s.path, dir)}</span>
          </span>
        ))}
      </span>
    </td>
  );
}

/** The effective settings of two directories side by side, the keys that differ first. */
export function ComparePage({ dir, other, onOpen, onPickOther }: Props) {
  const [comparison, setComparison] = useState<SettingsComparison | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api
      .compare(dir, other)
      .then(setComparison, (error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error))
      );
  }, [dir, other]);

  const settings = comparison?.settings ?? [];
  const differing = settings.filter((s) => !s.same);
  const shown = all ? settings : differing;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Compare settings</h1>
        <p className="lede">
          The settings Claude Code uses in{" "}
          <button type="button" className="link mono" onClick={() => onOpen(dir)}>
            {tilde(dir)}
          </button>{" "}
          and in{" "}
          <button type="button" className="link mono" onClick={() => onOpen(other)}>
            {tilde(other)}
          </button>
          , with the files each value comes from. Hidden values count as the same.{" "}
          <button type="button" className="link" onClick={onPickOther}>
            Compare with another directory
          </button>
        </p>
      </header>
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {comparison && (
        <section className="tt-section" aria-labelledby="h-compare">
          <header className="tt-head">
            <h2 id="h-compare">Settings</h2>
            <span className="tt-count">{shown.length}</span>
            <fieldset className="segmented" aria-label="Keys shown">
              <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
                Different <span className="seg-count">{differing.length}</span>
              </button>
              <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
                All <span className="seg-count">{settings.length}</span>
              </button>
            </fieldset>
          </header>
          {shown.length === 0 ? (
            <p className="tt-empty">
              {settings.length === 0
                ? "No settings file sets anything in either directory."
                : "Both directories use the same settings."}
            </p>
          ) : (
            <table className="tt tt-compare">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col" title={dir}>
                    {tilde(dir)}
                  </th>
                  <th scope="col" title={other}>
                    {tilde(other)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.key} className={s.same ? "dim" : ""}>
                    <td className="mono">{s.key}</td>
                    <ValueCell value={s.a} dir={dir} />
                    <ValueCell value={s.b} dir={other} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
