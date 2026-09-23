/**
 * Finding things in the Comparison Workspace the way a person would: the
 * navigator of changes, the evidence panel, the filter controls.
 */
import { fireEvent, screen, within } from "@testing-library/react";

export function navigator() {
  return screen.getByRole("navigation", { name: "Differences" });
}

export function evidence() {
  return screen.getByRole("region", { name: "Evidence" });
}

/** The change entries listed in the navigator, by their accessible descriptions. */
export function listed(): string[] {
  return within(navigator())
    .queryAllByRole("button")
    .filter((button) => button.hasAttribute("aria-label"))
    .map((button) => button.getAttribute("aria-label") ?? "");
}

export function choose(pattern: RegExp) {
  fireEvent.click(within(navigator()).getByRole("button", { name: pattern }));
}

/** Opens the filter controls (they start folded away) and chooses one. */
export function filterBy(group: string, option: RegExp) {
  const toggle = screen.getByRole("button", { name: /^Filters/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  fireEvent.click(within(screen.getByRole("group", { name: group })).getByRole("button", { name: option }));
}

export function counter(): string {
  return screen.getAllByRole("status").find((node) => /^Change |^No changes/.test(node.textContent ?? ""))?.textContent ?? "";
}
