import { useCallback, useEffect, useState } from "react";
import {
  type BackupKind,
  type BackupSummary,
  type ChangeView,
  type RestorePreview,
} from "../shared/types.ts";
import { api, errorText } from "./api.ts";
import { Bullet } from "./Bullet.tsx";
import { DiffView } from "./DiffView.tsx";
import { ago, tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";

const WHAT: Record<BackupKind, string> = {
  settings: "Settings changed",
  mcp: "MCP servers changed",
  agent: "Agent changed",
  "memory-index": "MEMORY.md changed",
  "memory-delete": "Memory deleted",
  "memory-restore": "Memory restored",
  "mcp-claude": "MCP servers changed through claude mcp",
  "directory-forget": "Directory forgotten",
};

/** What an open change shows: what it did, or what restoring its backup would do. */
type Opened = { id: string; showing: "change" | "restore" };

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
  const [open, setOpen] = useState<Opened | null>(null);

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
                showing={open?.id === b.id ? open.showing : null}
                onToggle={(showing) =>
                  setOpen(
                    open?.id === b.id && open.showing === showing ? null : { id: b.id, showing }
                  )
                }
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

/**
 * One change: what it did to which file and when, opened on the diff it made or on its restore. A
 * claude mcp change shows its diff with the commands that undo it, which is all there is to show.
 */
function ChangeItem({
  change: b,
  showing,
  onToggle,
  onDone,
}: {
  change: BackupSummary;
  showing: Opened["showing"] | null;
  onToggle: (showing: Opened["showing"]) => void;
  onDone: (text: string) => void;
}) {
  const open = showing !== null;
  const canShow = b.kind !== "directory-forget";
  const canRestore = b.kind !== "memory-restore" && b.kind !== "mcp-claude";
  const button = (what: Opened["showing"], label: string, icon: "eye" | "undo") => (
    <button
      type="button"
      className="head-action"
      aria-expanded={showing === what}
      onClick={() => onToggle(what)}
    >
      <Icon name={showing === what ? "close" : icon} /> {showing === what ? "Close" : label}
    </button>
  );
  const folder = tilde(b.target.replace(/[/\\][^/\\]*$/, ""));
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
        <ChangeFile change={b} folder={folder} />
        <span className="mono muted num" title={new Date(b.createdAt).toLocaleString()}>
          {ago(b.createdAt)}
        </span>
        <span className="change-actions">
          {canShow && button("change", "Show change", "eye")}
          {canRestore && button("restore", "Review restore", "undo")}
        </span>
      </div>
      {open && b.projectPath && b.kind !== "directory-forget" && (
        <p className="muted small change-folder">
          Memory folder: <span className="mono wrap">{folder}</span>
        </p>
      )}
      {showing === "change" &&
        (b.kind === "mcp-claude" ? (
          <Restore id={b.id} onDone={onDone} />
        ) : (
          <ShowChange id={b.id} restorable={canRestore} />
        ))}
      {showing === "restore" && <Restore id={b.id} onDone={onDone} />}
    </li>
  );
}

/** Which file a change touched, and where: for a forgotten directory, the directory and its store. */
function ChangeFile({ change: b, folder }: { change: BackupSummary; folder: string }) {
  if (b.kind === "directory-forget")
    return (
      <span className="change-file">
        <span className="mono wrap">{tilde(b.projectPath ?? b.target)}</span>
        <span className="mono wrap muted">{tilde(b.target)}</span>
      </span>
    );
  return (
    <span className="change-file">
      <span className="mono">{b.target.split(/[/\\]/).pop()}</span>
      {b.projectPath ? (
        <span className="change-store">
          <Bullet line="memory" ariaHidden /> auto memory of{" "}
          <span className="mono wrap">{tilde(b.projectPath)}</span>
        </span>
      ) : (
        <span className="mono wrap muted">{folder}</span>
      )}
    </span>
  );
}

/** What a change did to its file: the diff from the text before it to the text right after it. */
function ShowChange({ id, restorable }: { id: string; restorable: boolean }) {
  const [view, setView] = useState<ChangeView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    api.showChange(id).then(setView, (error: unknown) => setProblem(errorText(error)));
  }, [id]);

  if (problem)
    return (
      <p className="flag bad" role="alert">
        {problem}
      </p>
    );
  if (!view) return <p className="muted small">Reading the backup…</p>;
  return (
    <section className="review" aria-label="What this change did">
      {view.after === undefined ? (
        <p className="muted small">
          The file changed outside ccdesk after this, so ccdesk no longer has its text from right
          after the change.{restorable && " Review restore compares the backup with the file now."}
        </p>
      ) : (
        <>
          <p className="muted small">{changeHint(view)}</p>
          <DiffView before={view.before ?? ""} after={view.after ?? ""} />
        </>
      )}
      {view.removedIndexLines && (
        <p className="muted small">
          MEMORY.md lost {view.removedIndexLines.length === 1 ? "this line" : "these lines"} with
          it: <span className="mono">{view.removedIndexLines.join(" · ")}</span>
        </p>
      )}
    </section>
  );
}

function changeHint(view: ChangeView): string {
  if (view.before === null) return "ccdesk created this file.";
  if (view.after === null) return "ccdesk deleted this file.";
  if (view.kind === "memory-restore")
    return "This put a deleted memory back. To undo it, delete the memory again.";
  return "Lines marked − were in the file before the change; lines marked + came with it.";
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
      ({ target }) => onDone(`${restoredText(preview)} ${tilde(target)}`),
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

function restoredText(preview: RestorePreview): string {
  if (preview.movesBack) return "Moved back";
  return preview.removes ? "Removed" : "Restored";
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
  if (preview.movesBack)
    return (
      <>
        <p className="muted small">
          Restoring moves the store back to{" "}
          <span className="mono wrap">{tilde(preview.movesBack)}</span> with its{" "}
          {preview.after.trim()}, and the directory is listed again.
        </p>
        <div className="editor-buttons">
          <button type="button" className="primary" disabled={busy} onClick={onRestore}>
            {busy ? "Moving back…" : "Move the store back"}
          </button>
        </div>
      </>
    );
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
          {preview.createsFolder && (
            <p className="flag warn">
              {tilde(preview.createsFolder)} no longer exists; restoring creates it again with only
              this file.
            </p>
          )}
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
