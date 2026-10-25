/**
 * A ref that scrolls its element into view once it appears, for a review or an error that opens
 * below the button that asked for it. Stable, so React calls it only when the element mounts.
 */
export function reveal(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}
