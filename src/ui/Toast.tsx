import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

/**
 * Moves focus to the page's scroller, for when the element it should go back to is gone, as the
 * button that saved a change usually is. The scroller is focusable only until focus leaves it, so a
 * click on the page does not land there, and while it has focus the keys still scroll it.
 */
function restInPage() {
  const scroller = document.querySelector<HTMLElement>(".work-main, .page");
  if (!scroller) return;
  scroller.tabIndex = -1;
  scroller.addEventListener("blur", () => scroller.removeAttribute("tabindex"), { once: true });
  scroller.focus({ preventScroll: true });
}

export interface ToastMessage {
  text: string;
  undo?: () => Promise<void>;
}

/**
 * A short status line; one with Undo stays longer. None goes while the pointer is on it or focus is in
 * it, so its Undo can still be reached.
 */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  // The toast whose Undo is running; a second click would restore with a stale revision.
  const [undoing, setUndoing] = useState<ToastMessage | null>(null);
  // The toast under the pointer, and the one focus is in. Kept per toast, so a toast that goes while
  // held does not hold the next; the pointer and focus each let go only of their own hold.
  const [hovered, setHovered] = useState<ToastMessage | null>(null);
  const [focused, setFocused] = useState<ToastMessage | null>(null);
  // Where focus came from, to go back to when Undo takes the toast's button away.
  const cameFrom = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!toast || hovered === toast || focused === toast) return;
    const timer = setTimeout(onDone, toast.undo ? 12000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, hovered, focused, onDone]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only hold the toast up; they do nothing.
        <div
          className="toast"
          // A move, not an enter: a toast that replaces one under a resting pointer is held too.
          onMouseMove={() => setHovered(toast)}
          onMouseLeave={() => setHovered(null)}
          onFocus={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              cameFrom.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
            setFocused(toast);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setFocused(null);
          }}
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              disabled={undoing === toast}
              onClick={() => {
                setUndoing(toast);
                if (cameFrom.current?.isConnected) cameFrom.current.focus({ preventScroll: true });
                else restInPage();
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
