import { type SubmitEvent, useId, useState } from "react";
import { type ContextBlock, type DirectoryView, type PathTest } from "../shared/types.ts";
import { MATCH_KIND } from "../view/path-test.ts";
import { api, errorText } from "./api.ts";
import { Bullet } from "./Bullet.tsx";
import { relativeTo, tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";

/** A rough size in tokens; real counts depend on the model's tokenizer. */
function tokens(bytes: number): number {
  return Math.round(bytes / 4);
}

function count(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** ccdesk's own threshold for "this is a lot to load every session", not a Claude Code limit. */
const LARGE_TOKENS = 8000;

/** Listings ccdesk assembles, and rows it cannot measure, are labels rather than files. */
function isFile(block: ContextBlock): boolean {
  return ["instruction", "import", "memory-index", "output-style"].includes(block.kind);
}

function label(block: ContextBlock, view: DirectoryView): string {
  if (block.kind === "memory-index") return "MEMORY.md";
  return isFile(block) ? relativeTo(block.path, view.path) : block.path;
}

function note(block: ContextBlock, view: DirectoryView): string {
  if (block.kind === "memory-index") return `auto memory index, first ${block.lines} lines`;
  if (block.kind === "output-style") return "output style";
  if (block.kind === "import" && block.text !== null)
    return `imported by ${relativeTo(block.via ?? "", view.path)}`;
  // The full reason is inside the row; the summary only says the size is missing.
  return block.text === null ? "not counted" : "";
}

/** Everything Claude Code puts in context when a session starts here, in the order it loads. */
export function ContextView({ view }: { view: DirectoryView }) {
  const blocks = view.context;
  const total = blocks.reduce((sum, b) => sum + b.bytes, 0);
  const measured = blocks.filter((b) => b.text !== null);
  const later = view.instructions.filter((i) => i.status === "on-match").length;
  let running = 0;

  if (measured.length === 0) {
    return (
      <section className="context">
        <p className="tt-empty">
          Nothing is loaded at session start here: no instruction files and no auto memory.
        </p>
        <PathTester view={view} />
      </section>
    );
  }

  return (
    <section className="context" aria-label="What Claude sees">
      <p className="context-summary">
        At session start your config adds about <strong>≈{count(tokens(total))}</strong> tokens from{" "}
        <strong>{measured.length}</strong> {measured.length === 1 ? "part" : "parts"}. Sizes are
        estimates at four characters per token.
      </p>
      {later > 0 && (
        <p className="muted small">
          {later} path {later === 1 ? "rule loads" : "rules load"} later, when Claude touches
          matching files.
        </p>
      )}
      {tokens(total) > LARGE_TOKENS && (
        <p className="flag warn context-large">
          <Icon name="warn" /> That is a lot to load in every session. ccdesk suggests moving parts
          Claude needs only sometimes into path rules or skills.
        </p>
      )}
      <div className="context-bar" aria-hidden="true">
        {measured.map((b) => (
          <span
            key={`${b.kind}:${b.via ?? ""}:${b.path}`}
            className={`bar-${b.scope ?? "mixed"}`}
            style={{ flexGrow: Math.max(b.bytes, 1) }}
          />
        ))}
      </div>
      <div className="context-head" aria-hidden="true">
        <span>#</span>
        <span />
        <span>Part</span>
        <span>Lines</span>
        <span>Tokens</span>
        <span>Total</span>
      </div>
      <ol className="context-list">
        {blocks.map((b, i) => {
          running += b.bytes;
          return (
            <li key={`${b.kind}:${b.via ?? ""}:${b.path}`}>
              <details>
                <summary>
                  <span className="num">{i + 1}</span>
                  {b.scope ? <Bullet line={b.scope} hollow={b.text === null} /> : <span />}
                  <span className="context-name">
                    <span className="mono" title={tilde(b.path)}>
                      {label(b, view)}
                    </span>
                    {note(b, view) && <span className="muted small">{note(b, view)}</span>}
                  </span>
                  <span className="num">{b.text === null ? "" : `${b.lines} lines`}</span>
                  {/* The heads above are hidden from screen readers, so each number says what it is. */}
                  <span className="num">
                    {b.text !== null && (
                      <>
                        ≈{count(tokens(b.bytes))}
                        <span className="visually-hidden"> tokens</span>
                      </>
                    )}
                  </span>
                  <span className="num muted" title="Running total">
                    {b.text !== null && (
                      <>
                        <span className="visually-hidden">running total </span>≈
                        {count(tokens(running))}
                      </>
                    )}
                  </span>
                </summary>
                {b.text === null ? (
                  <p className="muted small context-hidden">{b.note ?? "Not counted."}</p>
                ) : (
                  <>
                    {b.note && <p className="muted small context-hidden">{b.note}</p>}
                    <pre className="raw">{b.text}</pre>
                  </>
                )}
              </details>
            </li>
          );
        })}
      </ol>
      <PathTester view={view} />
    </section>
  );
}

/** Which rules, skills and folder instructions join the session once Claude touches a file. */
function PathTester({ view }: { view: DirectoryView }) {
  const [file, setFile] = useState("");
  const [result, setResult] = useState<PathTest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();

  const run = (e: SubmitEvent) => {
    e.preventDefault();
    if (!file.trim()) return;
    setProblem(null);
    api.pathTest(view.path, file.trim()).then(setResult, (error: unknown) => {
      setResult(null);
      setProblem(errorText(error));
    });
  };

  return (
    <section className="path-tester" aria-labelledby={`${inputId}-h`}>
      <h3 id={`${inputId}-h`} className="sub-title">
        When Claude touches a file
      </h3>
      <p className="muted small">
        Path rules, skills with <span className="mono">paths</span>, and instructions in the folders
        on the way load once Claude reads or edits a matching file.
      </p>
      <form className="path-form" onSubmit={run}>
        <input
          aria-label={`File path, relative to ${tilde(view.path)}`}
          className="mono"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="e.g. src/api/users.ts"
          spellCheck={false}
        />
        <button type="submit">Check</button>
      </form>
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {result && (
        <div role="status">
          <PathResult result={result} dir={view.path} />
        </div>
      )}
    </section>
  );
}

/** What the path tester found for one file. */
function PathResult({ result, dir }: { result: PathTest; dir: string }) {
  if (!result.inside)
    return (
      <p className="muted small">
        {tilde(result.file)} is outside {tilde(dir)}, so nothing here applies to it.
      </p>
    );
  if (result.matches.length === 0)
    return (
      <p className="muted small">
        Nothing more loads for {relativeTo(result.file, dir)}
        {result.exists ? "" : " (the file does not exist yet; paths are checked anyway)"}.
      </p>
    );
  return (
    <ul className="plain path-matches">
      {result.matches.map((m) => (
        <li key={`${m.kind}:${m.path}`}>
          <Bullet line={m.scope} />
          <span className="muted">{MATCH_KIND[m.kind]}</span>
          <span className="mono wrap" title={tilde(m.path)}>
            {m.name ?? relativeTo(m.path, dir)}
          </span>
          {m.glob && <span className="muted small mono">matches {m.glob}</span>}
        </li>
      ))}
    </ul>
  );
}
