/**
 * Scrolls one scrollable box so an element inside it is visible, without
 * moving the page or any other box.
 *
 * `element.scrollIntoView` scrolls every scrollable ancestor, including the
 * page, which makes the whole screen jump when a pane moves to a change. The
 * workspace's panes move on their own; the reader's place on the page stays put.
 */
export function scrollWithin(
  container: HTMLElement | null,
  element: HTMLElement | null,
  align: "nearest" | "center" = "nearest",
): void {
  if (!container || !element) return;
  const box = container.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  const top = target.top - box.top + container.scrollTop;
  const bottom = top + target.height;
  if (align === "center") {
    container.scrollTop = Math.max(0, top - Math.max(0, (container.clientHeight - target.height) / 2));
    return;
  }
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}
