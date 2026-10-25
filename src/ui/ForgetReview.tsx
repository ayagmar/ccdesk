import { useEffect, useState } from "react";
import { type ForgetPreview } from "../shared/types.ts";
import { api, errorText } from "./api.ts";
import { plural, size, tilde } from "./format.ts";
import { reveal } from "./reveal.ts";

/**
 * Forgetting a directory whose folder is gone: what moves away and what stays, read when it opens,
 * and the button that does it while the store is still as shown.
 */
export function ForgetReview({
  path,
  onForgotten,
  onClose,
}: {
  path: string;
  /** Called with the toast's text once the store has moved away. */
  onForgotten: (text: string) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ForgetPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reading the preview again after a refusal: the button waits for the new revision.
  const [rereading, setRereading] = useState(false);

  useEffect(() => {
    api.previewForget(path).then(setPreview, (error: unknown) => setProblem(errorText(error)));
  }, [path]);

  const forget = (revision: string) => {
    setBusy(true);
    api.forgetDirectory(path, revision).then(
      () => onForgotten(`Forgot ${tilde(path)}. Recent changes can bring it back.`),
      (error: unknown) => {
        setBusy(false);
        setProblem(errorText(error));
        // The store may have changed since the review: show it as it is now, to forget again.
        setRereading(true);
        api
          .previewForget(path)
          .then(setPreview, () => setPreview(null))
          .finally(() => setRereading(false));
      }
    );
  };

  return (
    <section className="confirm" aria-label="Review forgetting this directory" ref={reveal}>
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {!preview && !problem && <p className="muted small">Reading the store…</p>}
      {preview && (
        <>
          <p>
            Forget <strong className="mono wrap">{tilde(preview.path)}</strong>? Its store moves
            into ccdesk's backups: {plural(preview.sessions, "session")},{" "}
            {plural(preview.memories, "memory", "memories")}, {size(preview.bytes)}, from{" "}
            <span className="mono wrap">{tilde(preview.store)}</span>.
          </p>
          {preview.recentlyActive && (
            <p className="flag warn">
              A session was written here in the last few minutes. If Claude Code is still running in
              this directory, quit it first: its next message would start a new store.
            </p>
          )}
          {preview.claudeJsonEntry && (
            <p className="muted small">
              Its entry in ~/.claude.json, with your trust answer, stays: ccdesk does not change
              that file.
            </p>
          )}
          <p className="muted small">
            If the folder comes back and you use Claude Code there again, Claude Code starts a new
            store. Recent changes can move this one back while no new store has its name. If this
            folder is on a drive that is not connected, connect it instead.
          </p>
        </>
      )}
      <div className="editor-buttons">
        {preview && (
          <button
            type="button"
            className="danger"
            disabled={busy || rereading}
            onClick={() => forget(preview.revision)}
          >
            {busy ? "Forgetting…" : "Forget directory"}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
