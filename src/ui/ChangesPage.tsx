import { useCallback, useEffect, useState } from "react";
import { type BackupKind, type BackupSummary, type RestorePreview } from "../shared/types.ts";
import { api, errorText } from "./api.ts";
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
  "mcp-claude": "MCP servers changed through claude mcp",
};

/** Changes grouped under the day they were made, newest first, as they come from the server. */
function byDay(changes: BackupSummary[]): [string, BackupSummary[]][] {
  const days = new Map<string, BackupSummary[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const change of changes) {
    const day = dayName(new Date(change.createdAt), today, yesterday);
    days.set(day, [...(days.get(day) ?? []), change]);
  }
  return [...days];
}

function dayName(date: Date, today: string, yesterday: string): string {
  const key = date.toDateString();
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return date.toLocaleDateString(undefined, { dateStyle: "long" });
}

/** Every change ccdesk made, from its backups, with a reviewed restore for each. */
export function ChangesPage({ onRestored }: { onRestored: (text: string) => void }) {
  const [backups, setBackups] = useState<BackupSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fail = (error: unknown) => setProblem(errorText(error));
  const load = useCallback(() => {
    api.backups().then(
      (page) => {
        setBackups(page.changes);
        setMore(page.more);
        setProblem(null);
      },
      (error: unknown) => setProblem(errorText(error))
    );
  }, []);
  useEffect(load, [load]);
  const loadMore = () => {
    const last = backups?.at(-1);
    if (!last) return;
    api.backups(last.id).then((page) => {
      setBackups((list) => [...(list ?? []), ...page.changes]);
      setMore(page.more);
      setProblem(null);
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
              <ChangeItem
                key={b.id}
                change={b}
                open={open === b.id}
                onToggle={() => setOpen(open === b.id ? null : b.id)}
                onDone={(text) => {
                  setOpen(null);
                  load();
                  onRestored(text);
                }}
              />
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

/** One change: what it did to which file and when, with its restore when opened. */
function ChangeItem({
  change: b,
  open,
  onToggle,
  onDone,
}: {
  change: BackupSummary;
  open: boolean;
  onToggle: () => void;
  onDone: (text: string) => void;
}) {
  let toggle = "Review restore";
  if (open) toggle = "Close";
  else if (b.kind === "mcp-claude") toggle = "Show change";
  return (
    <li className="change">
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
          <span className="mono wrap muted">{tilde(b.target.replace(/[/\\][^/\\]*$/, ""))}</span>
        </span>
        <span className="muted num" title={new Date(b.createdAt).toLocaleString()}>
          {new Date(b.createdAt).toLocaleTimeString(undefined, { timeStyle: "short" })}
        </span>
        <button type="button" className="head-action" aria-expanded={open} onClick={onToggle}>
          <Icon name="undo" /> {toggle}
        </button>
      </div>
      {open && b.kind === "memory-restore" && (
        <p className="muted small review">
          This put a deleted memory back. To undo it, delete the memory again.
        </p>
      )}
      {open && b.kind !== "memory-restore" && <Restore id={b.id} onDone={onDone} />}
    </li>
  );
}

function Restore({ id, onDone }: { id: string; onDone: (text: string) => void }) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = useCallback((error: unknown) => setProblem(errorText(error)), []);

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
  if (preview.undoCommands) return <ClaudeMcpChange preview={preview} />;
  const restore = () => {
    setBusy(true);
    api.restore(id, preview.revision).then(
      ({ target }) => onDone(`${preview.removes ? "Removed" : "Restored"} ${tilde(target)}`),
      (error: unknown) => {
        setBusy(false);
        fail(error);
      }
    );
  };
  return (
    <section className="review" aria-label="Review restore">
      <RestoreReview preview={preview} busy={busy} onRestore={restore} />
    </section>
  );
}

/** What restoring changes, or why it cannot, with the button that does it. */
function RestoreReview({
  preview,
  busy,
  onRestore,
}: {
  preview: RestorePreview;
  busy: boolean;
  onRestore: () => void;
}) {
  if (preview.blocked) return <p className="flag warn">{preview.blocked}</p>;
  const unchanged = preview.before === preview.after;
  if (unchanged && !preview.indexLines)
    return <p className="muted small">The file already matches this backup.</p>;
  let label = preview.removes ? "Remove this file" : "Restore this version";
  if (busy) label = preview.removes ? "Removing…" : "Restoring…";
  return (
    <>
      {unchanged ? (
        // A delete that stopped halfway after Claude rewrote the memory: only MEMORY.md changes.
        <p className="muted small">
          The delete stopped halfway and Claude has rewritten this memory since, so the memory stays
          as it is now.
        </p>
      ) : (
        <>
          <p className="muted small">{restoreHint(preview)}</p>
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
        <button type="button" className="primary" disabled={busy} onClick={onRestore}>
          {label}
        </button>
      </div>
    </>
  );
}

function restoreHint(preview: RestorePreview): string {
  if (preview.removes)
    return "ccdesk created this file, so undoing the change removes it. The file is backed up first, so you can put it back from here.";
  if (preview.before === null) return "The file does not exist now; restoring creates it.";
  return "Lines marked − are in the file now; lines marked + come back from the backup.";
}

/** A change made through `claude mcp`: what it did, and the commands that put it back. */
function ClaudeMcpChange({ preview }: { preview: RestorePreview }) {
  const commands = preview.undoCommands ?? [];
  return (
    <section className="review" aria-label="Change made through claude mcp">
      <p className="muted small">
        The servers before and after this change, with secret values hidden:
      </p>
      <DiffView before={preview.before ?? ""} after={preview.after} />
      <p className="flag warn">{preview.blocked}</p>
      {commands.map((c) => (
        <p key={c} className="mono wrap small">
          {c}
        </p>
      ))}
      {commands.some((c) => c.includes("•••")) && (
        <p className="muted small">Replace each ••• with the real value before you run it.</p>
      )}
    </section>
  );
}
