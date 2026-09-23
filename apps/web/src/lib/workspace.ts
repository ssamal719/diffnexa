/**
 * Comparison Workspace V2 — the state behind the shared comparison screen.
 *
 * Any tool can use the workspace by describing its changes in this one shape:
 * a number, where it is in the reader's own terms ("Pricing · F22", not an
 * internal ID), a short category, and the value before and after. Everything
 * here is presentation over what the engine already decided — ordering,
 * grouping for the navigator, searching and stepping from one change to the
 * next. Nothing is ranked, scored or hidden.
 *
 * Pure functions only, so the behaviour is tested without a browser.
 */

export type EditKind = "added" | "removed" | "changed" | "moved";

export type WorkspaceChange = {
  id: string;
  /** 1-based, in reading order. Shown as "#3". */
  number: number;
  /** What the navigator groups by — for a workbook, the sheet. */
  group: string;
  /** How the group is labelled in the navigator: "Sheet: Pricing". */
  groupLabel: string;
  /** Where, in the reader's terms, within the group: "F22", "Row 4", "A5:F5". */
  place: string;
  /** A short kind of change: "Number", "Formula", "Row added". */
  category: string;
  kind: EditKind;
  before: string | null;
  after: string | null;
  /** One sentence a screen reader announces for this change. */
  description: string;
  /** Everything a reader can see for this change, for search. */
  searchText: string;
};

export type WorkspaceMode = { id: string; label: string };

export type NavigatorGroup = { key: string; label: string; changes: WorkspaceChange[] };

/** Changes whose visible text contains every word of the query, in order. */
export function searchChanges(changes: WorkspaceChange[], query: string): WorkspaceChange[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return changes;
  return changes.filter((change) => {
    const haystack = `#${change.number} ${change.searchText}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Changes grouped for the navigator, keeping reading order and the first-seen group order. */
export function navigatorGroups(changes: WorkspaceChange[]): NavigatorGroup[] {
  const groups: NavigatorGroup[] = [];
  const byKey = new Map<string, NavigatorGroup>();
  for (const change of changes) {
    let group = byKey.get(change.group);
    if (!group) {
      group = { key: change.group, label: change.groupLabel, changes: [] };
      byKey.set(change.group, group);
      groups.push(group);
    }
    group.changes.push(change);
  }
  return groups;
}

/**
 * The change to move to from the active one. Stays within the visible (searched)
 * list; if the active change is not in it, the first or last visible change is
 * the next stop.
 */
export function stepChange(
  visible: WorkspaceChange[],
  activeId: string | null,
  direction: 1 | -1,
): string | null {
  if (visible.length === 0) return null;
  const index = visible.findIndex((change) => change.id === activeId);
  if (index === -1) return direction === 1 ? visible[0].id : visible[visible.length - 1].id;
  const next = index + direction;
  if (next < 0 || next >= visible.length) return visible[index].id;
  return visible[next].id;
}

/** "Change 3 of 7", or "Change 2 of 4 shown · 7 in total" while searching. */
export function counterText(visible: WorkspaceChange[], total: number, activeId: string | null): string {
  if (total === 0) return "No changes";
  const index = visible.findIndex((change) => change.id === activeId);
  const position = index === -1 ? "–" : String(index + 1);
  if (visible.length === total) return `Change ${position} of ${total}`;
  return `Change ${position} of ${visible.length} shown · ${total} in total`;
}

export const EDIT_MARK: Record<EditKind, string> = { added: "+", removed: "−", changed: "±", moved: "→" };

export const EDIT_WORD: Record<EditKind, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  moved: "Moved",
};
