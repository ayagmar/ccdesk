import { useCallback, useEffect, useState } from "react";
import { type BackupKind, type BackupSummary, type RestorePreview } from "../shared/types.ts";
import { api } from "./api.ts";
import { DiffView } from "./DiffView.tsx";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";

const WHAT: Record<BackupKind, string> = {
  settings: "Settings changed",
  mcp: "MCP servers changed",
  agent: "Agent changed",
  "memory-index": "MEMORY.md changed",
  "memory-delete": "Memory deleted",
  "memory-restore": "Memory restored",
};

/** Changes grouped under the day they were made, newest first, as they come from the server. */
function byDay(changes: BackupSummary[]): Array<[string, BackupSummary[]]> {
  const days = new Map<string, BackupSummary[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const change of changes) {
    const date = new Date(change.createdAt);
    const key = date.toDateString();
    const day =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : date.toLocaleDateString(undefined, { dateStyle: "long" });
    days.set(day, [...(days.get(day) ?? []), change]);
  }
  return [...days];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every change ccdesk made, from its backups, with a reviewed restore for each. */
export function ChangesPage({ onRestored }: { onRestored: (text: string) => void }) {
  const [backups, setBackups] = useState<BackupSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fail = (error: unknown) => setProblem(messageOf(error));
  const load = useCallback(() => {
    api.backups().then(
      (page) => {
        setBackups(page.changes);
        setMore(page.more);
      },
      (error: unknown) => setProblem(messageOf(error))
    );
  }, []);
  useEffect(load, [load]);
  const loadMore = () => {
    const last = backups?.at(-1);
    if (!last) return;
    api.backups(last.id).then((page) => {
      setBackups((list) => [...(list ?? []), ...page.changes]);
      setMore(page.more);
    }, fail);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Recent changes</h1>
        <p className="lede">
          Every file ccdesk changed or deleted, newest first. Each change kept a copy of the file as
          it was; restoring one backs up the current file first.
        </p>
      </header>
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {backups?.length === 0 && <p className="tt-empty">ccdesk has not changed anything yet.</p>}
      {byDay(backups ?? []).map(([day, changes]) => (
        <section key={day} className="change-day" aria-label={day}>
          <h2>{day}</h2>
          <ul className="plain changes">
            {changes.map((b) => (
              <li key={b.id} className="change">
                <div className="change-row">
                  <span className="change-what">
                    {WHAT[b.kind]}
                    {b.incomplete && (
                      <span
                        className="flag warn"
                        title="The change stopped halfway; review the restore to put the earlier text back"
                      >
                        incomplete
                      </span>
                    )}
                  </span>
                  <span className="change-file">
                    <span className="mono">{b.target.split(/[/\\]/).pop()}</span>
                    <span className="mono wrap muted">
                      {tilde(b.target.replace(/[/\\][^/\\]*$/, ""))}
                    </span>
                  </span>
                  <span className="muted num" title={new Date(b.createdAt).toLocaleString()}>
                    {new Date(b.createdAt).toLocaleTimeString(undefined, { timeStyle: "short" })}
                  </span>
                  <button
                    type="button"
                    className="head-action"
                    aria-expanded={open === b.id}
                    onClick={() => setOpen(open === b.id ? null : b.id)}
                  >
                    <Icon name="undo" /> {open === b.id ? "Close" : "Review restore"}
                  </button>
                </div>
                {open === b.id && b.kind === "memory-restore" && (
                  <p className="muted small review">
                    This put a deleted memory back. To undo it, delete the memory again.
                  </p>
                )}
                {open === b.id && b.kind !== "memory-restore" && (
                  <Restore
                    id={b.id}
                    onDone={(text) => {
                      setOpen(null);
                      load();
                      onRestored(text);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <button type="button" className="show-more" onClick={loadMore}>
          Show older changes
        </button>
      )}
    </div>
  );
}

function Restore({ id, onDone }: { id: string; onDone: (text: string) => void }) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = useCallback(
    (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
    []
  );

  useEffect(() => {
    api.previewRestore(id).then(setPreview, fail);
  }, [id, fail]);

  if (problem)
    return (
      <p className="flag bad" role="alert">
        {problem}
      </p>
    );
  if (!preview) return <p className="muted small">Reading the backup…</p>;
  const same = preview.before === preview.after && !preview.indexLines;
  // A delete that stopped halfway after Claude rewrote the memory: only MEMORY.md changes.
  const onlyIndex = preview.before === preview.after && preview.indexLines;
  return (
    <section className="review" aria-label="Review restore">
      {preview.blocked ? (
        <p className="flag warn">{preview.blocked}</p>
      ) : same ? (
        <p className="muted small">The file already matches this backup.</p>
      ) : (
        <>
          {onlyIndex ? (
            <p className="muted small">
              The delete stopped halfway and Claude has rewritten this memory since, so the memory
              stays as it is now.
            </p>
          ) : (
            <>
              <p className="muted small">
                {preview.removes
                  ? "ccdesk created this file, so undoing the change removes it. The file is backed up first, so you can put it back from here."
                  : preview.before === null
                    ? "The file does not exist now; restoring creates it."
                    : "Lines marked − are in the file now; lines marked + come back from the backup."}
              </p>
              <DiffView before={preview.before ?? ""} after={preview.after} />
            </>
          )}
          {preview.indexLines && (
            <p className="muted small">
              MEMORY.md gets {preview.indexLines.length === 1 ? "this line" : "these lines"} back:{" "}
              <span className="mono">{preview.indexLines.join(" · ")}</span>
            </p>
          )}
          <div className="editor-buttons">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                api.restore(id, preview.revision).then(
                  ({ target }) =>
                    onDone(`${preview.removes ? "Removed" : "Restored"} ${tilde(target)}`),
                  (error: unknown) => {
                    setBusy(false);
                    fail(error);
                  }
                );
              }}
            >
              {busy
                ? preview.removes
                  ? "Removing…"
                  : "Restoring…"
                : preview.removes
                  ? "Remove this file"
                  : "Restore this version"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
