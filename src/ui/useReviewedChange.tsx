import { useState } from "react";
import { type Change, type SettingsEditPreview } from "../shared/types.ts";
import { Review, type Saved } from "./SettingEditor.tsx";

/**
 * One change to a settings file: reviewed as a diff first, then saved only while the file is still
 * as reviewed. `shown` is the problem or the review to render where the change was started.
 */
export function useReviewedChange<E>(
  preview: (edit: E) => Promise<SettingsEditPreview>,
  save: (edit: E, revision: string) => Promise<Change>,
  onSaved: (saved: Saved) => void
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
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!review) return false;
    setBusy(true);
    try {
      const change = await save(review.edit, review.preview.revision);
      onSaved({ change, message: review.message });
      setReview(null);
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
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
    save: confirm,
    busy,
    reviewing: review !== null,
    cancel,
    /** Shows a problem found before anything was sent, such as JSON that does not parse. */
    fail: setProblem,
    shown,
  };
}
