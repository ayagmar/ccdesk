import { useEffect, useState } from "react";
import { type ForgetPreview } from "../shared/types.ts";
import { api, errorText } from "./api.ts";
import { plural, tilde } from "./format.ts";

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
      }
    );
  };

  return (
    <section className="confirm" aria-label="Review forgetting this directory">
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
          {preview.claudeJsonEntry && (
            <p className="muted small">
              Its entry in ~/.claude.json, with your trust answer, stays: ccdesk does not change
              that file.
            </p>
          )}
          <p className="muted small">
            If the folder comes back and you use Claude Code there again, Claude Code starts a new
            store. Recent changes can move this one back while no new store has its name.
          </p>
        </>
      )}
      <div className="editor-buttons">
        {preview && !problem && (
          <button
            type="button"
            className="danger"
            disabled={busy}
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
