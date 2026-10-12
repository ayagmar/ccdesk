import { useEffect, useState } from "react";
import { storeDirName } from "../../shared/memory.ts";
import { type MemoryAction, type MemoryChangePreview } from "../../shared/types.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { api } from "../api.ts";
import { Bullet } from "../Bullet.tsx";
import { DiffView } from "../DiffView.tsx";
import { ago, tilde } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { Contents, Field, NameButton, PathValue } from "./kit.tsx";
import { type Actions, type SectionUi } from "./types.ts";

type R = RowOf<"memory">;

function TypeName({ type }: { type: string }) {
  return (
    <span className="type">
      <span className={`type-dot type-${type}`} aria-hidden="true" />
      {type}
    </span>
  );
}

export const memory: SectionUi<R> = {
  cells: (row, { sharedNames }, select) => {
    const m = row.item;
    return (
      <>
        <td>
          <Bullet line="memory" />
        </td>
        <td className="mono">
          <NameButton onClick={select}>{m.name}</NameButton>
        </td>
        <td>
          <TypeName type={m.type} />
        </td>
        <td className="desc">{m.description}</td>
        <td className="checks">
          {!m.inIndex && (
            <span className="flag bad" title="MEMORY.md does not mention it">
              not in index
            </span>
          )}
          {m.brokenLinks.length > 0 && (
            <span className="flag warn">
              {m.brokenLinks.length} broken link{m.brokenLinks.length === 1 ? "" : "s"}
            </span>
          )}
          {sharedNames.has(m.name) && <span className="flag">also elsewhere</span>}
        </td>
        <td className="num" title={new Date(m.mtime).toLocaleString()}>
          {ago(m.mtime)}
        </td>
      </>
    );
  },
  renderFacet: (type) => <TypeName type={type} />,
  Head: MemoryHead,
  Details: MemoryDetails,
};

function MemoryHead({ actions }: { actions: Actions }) {
  const store = actions.view.memory;
  const index = store.index;
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      {store.note && (
        <span className={`flag${store.loaded ? "" : " warn"}`} title={tilde(store.dir)}>
          {!store.loaded && <Icon name="warn" />} {store.note}
        </span>
      )}
      {index?.truncated && (
        <span
          className="flag warn"
          title="Claude Code reads only the first 200 lines or 25KB of MEMORY.md"
        >
          <Icon name="warn" /> MEMORY.md: lines past {index.loadedLines} are not loaded
        </span>
      )}
      {index && index.missingFiles.length > 0 && (
        <span className="fix">
          <span className="flag warn" title={index.missingFiles.join(", ")}>
            <Icon name="warn" /> {index.missingFiles.length} index{" "}
            {index.missingFiles.length === 1 ? "line points" : "lines point"} at missing files
          </span>
          {!store.custom && !reviewing && (
            <button type="button" className="head-action" onClick={() => setReviewing(true)}>
              <Icon name="trash" /> Remove {index.missingFiles.length === 1 ? "line" : "lines"}…
            </button>
          )}
        </span>
      )}
      {index && reviewing && (
        <MemoryReview
          action="remove-dead"
          path={index.path}
          verb="Remove lines"
          busyVerb="Removing…"
          message={`Removed ${index.missingFiles.length === 1 ? "the dead line" : "dead lines"} from MEMORY.md`}
          actions={actions}
          onClose={() => setReviewing(false)}
        />
      )}
    </>
  );
}

function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

/**
 * The exact change a memory action makes, read from disk when it opens and saved only while
 * nothing it was worked out from has changed.
 */
function MemoryReview({
  action,
  path,
  verb,
  busyVerb,
  message,
  danger = false,
  select,
  actions,
  onClose,
}: {
  action: MemoryAction;
  path: string;
  verb: string;
  busyVerb: string;
  message: string;
  danger?: boolean;
  select?: string | null;
  actions: Actions;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<MemoryChangePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .previewMemory(action, path)
      .then(setPreview, (error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error))
      );
  }, [action, path]);

  return (
    <section className="review memory-review" aria-label="Review memory change">
      {problem ? (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      ) : !preview ? (
        <p className="muted small">Reading the files…</p>
      ) : (
        preview.files.map((file) => (
          <div key={file.path} className="memory-review-file">
            <p className="sub-title small" title={tilde(file.path)}>
              <span className="mono">{fileName(file.path)}</span>
              {file.after === null && (
                <span className="muted"> is deleted; a backup is kept and you can undo it</span>
              )}
            </p>
            <DiffView before={file.before ?? ""} after={file.after ?? ""} />
          </div>
        ))
      )}
      <div className="editor-buttons">
        {preview && !problem && (
          <button
            type="button"
            className={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // Closed either way: a failure is reported in the toast, and reopening reviews afresh.
              void actions
                .onChange(() => api.changeMemory(action, path, preview.revision), message, select)
                .finally(onClose);
            }}
          >
            {busy ? busyVerb : verb}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function MemoryDetails({ row, actions }: { row: R; actions: Actions }) {
  const m = row.item;
  // A store set by autoMemoryDirectory: ccdesk shows it but only changes stores under ~/.claude.
  const readOnly = actions.view.memory.custom === true;
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const elsewhere = actions.overview?.sharedMemories.find((s) => s.name === m.name)?.stores ?? [];
  const storeName = m.path.split(/[/\\]/).at(-3);
  const others = elsewhere.filter((s) => storeDirName(s.projectPath) !== storeName);

  return (
    <>
      {m.description && <p className="verdict">{m.description}</p>}
      <dl className="fields">
        <Field label="Type">
          <TypeName type={m.type} />
        </Field>
        <Field label="File">
          <PathValue path={m.path} />
        </Field>
        <Field label="Changed">{ago(m.mtime)}</Field>
        <Field label="In MEMORY.md">
          {m.inIndex ? (
            "yes"
          ) : (
            <span className="fix">
              <span className="flag bad">no, so Claude won't see it at session start</span>
              {!readOnly && !adding && (
                <button type="button" className="head-action" onClick={() => setAdding(true)}>
                  <Icon name="plus" /> Add to MEMORY.md…
                </button>
              )}
            </span>
          )}
        </Field>
        {m.linkedFrom.length > 0 && (
          <Field label="Linked from">
            <span className="mono">{m.linkedFrom.join(", ")}</span>
          </Field>
        )}
        {m.brokenLinks.length > 0 && (
          <Field label="Broken links">
            <span className="mono">{m.brokenLinks.map((l) => `[[${l}]]`).join(", ")}</span>
          </Field>
        )}
      </dl>
      {adding && (
        <MemoryReview
          action="add"
          path={m.path}
          verb="Add to MEMORY.md"
          busyVerb="Adding…"
          message={`Added ${m.name} to MEMORY.md`}
          actions={actions}
          onClose={() => setAdding(false)}
        />
      )}
      {others.length > 0 && (
        <section className="sub">
          <h3>Also saved in</h3>
          <ul className="plain">
            {others.map((s) => (
              <li key={s.projectPath}>
                <button
                  type="button"
                  className="link"
                  onClick={() => actions.onOpenDirectory(s.projectPath)}
                >
                  {tilde(s.projectPath)}
                </button>
                <span className={`flag ${s.hash === m.hash ? "" : "warn"}`}>
                  {s.hash === m.hash ? "identical" : "different text"}
                </span>
              </li>
            ))}
          </ul>
          {others.some((s) => s.hash === m.hash) && (
            <p className="muted small">
              Deleting this copy keeps the identical one saved elsewhere.
            </p>
          )}
        </section>
      )}
      {!readOnly && (
        <div className="actions">
          {confirming ? (
            <section className="confirm" aria-label="Confirm delete">
              <p>
                Delete <strong>{m.file}</strong>
                {m.inIndex ? " and its line in MEMORY.md" : ""}?
                {m.linkedFrom.length > 0 &&
                  ` ${m.linkedFrom.length} other ${m.linkedFrom.length === 1 ? "memory links" : "memories link"} here and will have a broken link.`}
              </p>
              <MemoryReview
                action="delete"
                path={m.path}
                verb="Delete memory"
                busyVerb="Deleting…"
                message={`Deleted ${m.file}`}
                danger
                select={null}
                actions={actions}
                onClose={() => setConfirming(false)}
              />
            </section>
          ) : (
            <button type="button" className="quiet-danger" onClick={() => setConfirming(true)}>
              <Icon name="trash" /> Delete memory…
            </button>
          )}
        </div>
      )}
      <Contents text={m.body} />
    </>
  );
}
