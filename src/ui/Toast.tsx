import { useEffect, useState } from "react";
import { Icon } from "./Icon.tsx";

export interface ToastMessage {
  text: string;
  undo?: () => Promise<void>;
}

/** A short status line; one with Undo stays longer. */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  // The toast whose Undo is running; a second click would restore with a stale revision.
  const [undoing, setUndoing] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, toast.undo ? 12000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              disabled={undoing === toast}
              onClick={() => {
                setUndoing(toast);
                void toast.undo?.();
              }}
            >
              <Icon name="undo" /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
