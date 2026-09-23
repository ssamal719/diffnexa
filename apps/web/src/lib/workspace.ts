/**
 * The Comparison Workspace — the state behind the one screen every tool uses.
 *
 * Any tool can use the workspace by describing its changes in this one shape:
 * a number, what kind of change it is ("Value changed"), where it is in the
 * reader's own terms ("Page 2", "Pricing › Enterprise", "Pricing · F22" — never
 * an internal ID), a short category, and the value before and after.
 * Everything here is presentation over what the engine already decided —
 * ordering, grouping for the navigator, filtering, searching and stepping from
 * one change to the next. Nothing is ranked, scored or dropped: a filter only
 * narrows what is listed, and clearing it brings every change back.
 *
 * Pure functions only, so the behaviour is tested without a browser.
 */

export type EditKind = "added" | "removed" | "changed" | "moved";

export type WorkspaceChange = {
  id: string;
  /** 1-based, in reading order. Shown as "#3". */
  number: number;
  /** What the navigator groups by — a sheet, a page, a section, a signal. */
  group: string;
  /** How the group is labelled in the navigator: "Sheet: Pricing", "Page 2". */
  groupLabel: string;
  /** What kind of change this is, in a few words: "Value changed", "Heading renamed". */
  title: string;
  /** Where, in the reader's terms: "Page 2", "Payment Terms", "F22", "Whole page". */
  place: string;
  /**
   * How the place was worked out, when it is a fallback rather than a fixed
   * location a reader can look up — for a Word document, "Paragraph 18,
   * counted from the start; Word files have no fixed pages". Shown with the
   * place, so a fallback is never mistaken for a page number.
   */
  placeNote?: string | null;
  /** A short kind of change: "Number", "Formula", "Row added". */
  category: string;
  kind: EditKind;
  before: string | null;
  after: string | null;
  /** A short piece of the text around the change, when there are no values to show. */
  context?: string | null;
  /** One sentence a screen reader announces for this change. */
  description: string;
  /** Everything a reader can see for this change, for search. */
  searchText: string;
  /** The filter options this change belongs to, by filter group: { kind: ["added"], page: ["3"] }. */
  tags?: Record<string, string[]>;
  /**
   * The engine judged this a minor difference (a page number, a timestamp).
   * Kept, counted separately and listed on request — never discarded.
   */
  minor?: boolean;
};

export type WorkspaceMode = { id: string; label: string };

export type NavigatorGroup = { key: string; label: string; changes: WorkspaceChange[] };

/** Changes whose visible text contains every word of the query, in order. */
export function searchChanges(changes: WorkspaceChange[], query: string): WorkspaceChange[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return changes;
  return changes.filter((change) => {
    const haystack = `#${change.number} ${change.title} ${change.place} ${change.searchText}`.toLowerCase();
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
 * The change to move to from the active one. Stays within the visible (searched
 * and filtered) list; if the active change is not in it, the first or last
 * visible change is the next stop.
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

/** "Change 3 of 7", or "Change 2 of 4 shown · 7 in total" while searching or filtering. */
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

// ---------------------------------------------------------------- filters

export type FilterOption = { id: string; label: string; count: number };

export type FilterGroup = {
  id: string;
  label: string;
  options: FilterOption[];
  /**
   * False when the tool shows this group's controls itself — the policy
   * topics, for example, in their own summary — so the same control is never
   * on screen twice. The workspace still applies it.
   */
  inBar?: boolean;
};

/** For each filter group, the options chosen. Empty or missing means "all". */
export type FilterState = Record<string, string[]>;

export const NO_FILTERS: FilterState = {};

/**
 * A filter group with only the options that at least one change has, each
 * with its count — so a tool never offers a filter for a kind of change it did
 * not find, or cannot find at all.
 *
 * `options` fixes the order and labels; tags not listed there are added at the
 * end with the tag itself as the label.
 */
export function filterGroup(
  id: string,
  label: string,
  changes: WorkspaceChange[],
  options: { id: string; label: string }[] = [],
  extra: { inBar?: boolean } = {},
): FilterGroup {
  const counts = new Map<string, number>();
  for (const change of changes) {
    if (change.minor) continue;
    for (const tag of change.tags?.[id] ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const known = options.filter((option) => counts.has(option.id));
  const unknown = [...counts.keys()]
    .filter((tag) => !options.some((option) => option.id === tag))
    .map((tag) => ({ id: tag, label: tag }));
  return {
    id,
    label,
    options: [...known, ...unknown].map((option) => ({ ...option, count: counts.get(option.id) ?? 0 })),
    ...extra,
  };
}

/** The kind filter every tool offers: added, removed, changed, moved — only those present. */
export function kindFilter(changes: WorkspaceChange[]): FilterGroup {
  return filterGroup(
    "kind",
    "Kind of change",
    changes.map((change) => ({ ...change, tags: { ...change.tags, kind: [change.kind] } })),
    (["added", "removed", "changed", "moved"] as EditKind[]).map((kind) => ({ id: kind, label: EDIT_WORD[kind] })),
  );
}

export function hasFilters(state: FilterState): boolean {
  return Object.values(state).some((values) => values.length > 0);
}

/**
 * The changes a reader has asked to see: within a group, any chosen option
 * matches; across groups, every group with a choice must match. Minor
 * differences are included only when asked for.
 */
export function filterChanges(
  changes: WorkspaceChange[],
  state: FilterState,
  includeMinor: boolean,
): WorkspaceChange[] {
  const active = Object.entries(state).filter(([, values]) => values.length > 0);
  return changes.filter((change) => {
    if (change.minor && !includeMinor) return false;
    return active.every(([group, values]) => {
      const tags = group === "kind" ? [change.kind] : (change.tags?.[group] ?? []);
      return tags.some((tag) => values.includes(tag));
    });
  });
}

/** Adds or removes one option, so choosing a filter again turns it off. */
export function toggleFilter(state: FilterState, group: string, option: string): FilterState {
  const current = state[group] ?? [];
  const next = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
  return { ...state, [group]: next };
}

// ---------------------------------------------------------------- small helpers for adapters

/** The first few words of a passage, for the navigator. Never alters the words. */
export function shorten(text: string | null | undefined, max = 90): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
