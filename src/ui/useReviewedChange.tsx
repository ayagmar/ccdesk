import { useState } from "react";
import { type Change, type SettingsEditPreview } from "../shared/types.ts";
import { errorText } from "./api.ts";
import { DiffView } from "./DiffView.tsx";
import { tilde } from "./format.ts";

/** A saved edit: the change to undo, what to tell you, and the row to show afterwards. */
export interface Saved {
  /** null for a change ccdesk made through Claude Code's own commands, which it cannot undo. */
  change: Change | null;
  message: string;
  select?: string | null;
}

/**
 * One change to a settings file: reviewed as a diff first, then saved only while the file is still
 * as reviewed. `shown` is the problem or the review to render where the change was started.
 */
export function useReviewedChange<E>(
  preview: (edit: E) => Promise<SettingsEditPreview>,
  /** Resolves with null for a change that cannot be undone from ccdesk. */
  save: (edit: E, revision: string) => Promise<Change | null>,
  /** Gets the edit too, for a caller that shows its row afterwards. */
  onSaved: (saved: Saved, edit: E) => void
) {
  const [review, setReview] = useState<{
    edit: E;
    preview: SettingsEditPreview;
    message: string;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (edit: E, message: string) => {
    setProblem(null);
    setBusy(true);
    try {
      setReview({ edit, preview: await preview(edit), message });
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const change = await save(review.edit, review.preview.revision);
      onSaved({ change, message: review.message }, review.edit);
      setReview(null);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setReview(null);
    setProblem(null);
  };
  const shown = (
    <>
      {problem && (
        <p className="flag bad" role="alert">
          {problem}
        </p>
      )}
      {review && (
        <Review
          preview={review.preview}
          busy={busy}
          onSave={() => void confirm()}
          onCancel={() => setReview(null)}
        />
      )}
    </>
  );
  return {
    start,
    busy,
    reviewing: review !== null,
    cancel,
    /** Shows a problem found before anything was sent, such as JSON that does not parse. */
    fail: setProblem,
    shown,
  };
}

export type ReviewedChange<E> = ReturnType<typeof useReviewedChange<E>>;

/** A change's diff, or why it cannot be saved, with Save and Cancel. */
function Review({
  preview,
  busy,
  onSave,
  onCancel,
}: {
  preview: SettingsEditPreview;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const blocked = preview.errors.length > 0;
  return (
    <section className="review" aria-label="Review change">
      <h3 className="sub-title">
        {blocked ? "This value does not fit the schema" : `Change to ${tilde(preview.path)}`}
      </h3>
      {blocked ? (
        <ul className="plain">
          {preview.errors.map((e) => (
            <li key={e} className="flag bad">
              {e}
            </li>
          ))}
        </ul>
      ) : (
        <DiffView before={preview.before ?? ""} after={preview.after} />
      )}
      {!blocked && preview.commands && (
        <div className="muted small">
          <p>
            ccdesk does not write this file itself; Claude Code rewrites it all the time. Saving
            runs Claude Code's own command instead (values hidden here):
          </p>
          {preview.commands.map((c) => (
            <p key={c} className="mono wrap">
              {c}
            </p>
          ))}
          {preview.commands.some((c) => c.includes(" add-json ")) && (
            <p>
              The real values are passed to claude on its command line, where other programs on this
              computer can see them while it runs.
            </p>
          )}
          <p>
            Recent changes lists this change and the command that puts it back, but ccdesk cannot
            undo it for you.
          </p>
        </div>
      )}
      <div className="editor-buttons">
        {!blocked && (
          <button type="button" className="primary" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          {blocked ? "Back" : "Cancel"}
        </button>
      </div>
      {!blocked && !preview.commands && preview.before !== null && (
        <p className="muted small">
          {preview.reformats
            ? "ccdesk writes the whole file with 2-space indentation, as Claude Code does. "
            : ""}
          The old file is backed up first.
        </p>
      )}
    </section>
  );
}
