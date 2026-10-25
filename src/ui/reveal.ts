/**
 * A ref that scrolls its element into view once it appears, for a review or an error that opens
 * below the button that asked for it. Stable, so React calls it only when the element mounts.
 */
export function reveal(element: HTMLElement | null): void {
  if (!element) return;
  // The inspector's sticky header grows when a long title wraps, so it is measured, not assumed.
  const head = element.closest(".inspector")?.querySelector<HTMLElement>(".insp-head");
  if (head) element.style.scrollMarginTop = `${head.offsetHeight + 6}px`;
  element.scrollIntoView({ block: "nearest" });
}
