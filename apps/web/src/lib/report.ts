/**
 * Turns a comparison result into the report the interface shows.
 *
 * Everything here is presentation logic over data the engine already produced:
 * grouping, counting, filtering and wording. No value shown to a user is
 * invented here — old values, new values, differences, pages and evidence all
 * come from the deterministic engine.
 *
 * One deliberate absence: there is no importance ranking. The engine does not
 * currently judge which changes matter most, so the interface does not pretend
 * to either. `AttentionLevel` exists as the slot that ranking will fill when the
 * engine can supply it honestly.
 */

import type { Change, ComparisonResponse } from "@/lib/comparison";
import { filterGroup, kindFilter, shorten, type FilterGroup, type WorkspaceChange } from "@/lib/workspace";

// ---------------------------------------------------------------- vocabulary

/** The four groups the product currently detects. */
export const CATEGORIES = [
  {
    id: "content",
    label: "Content",
    blurb: "Wording that was added, removed or rewritten",
  },
  {
    id: "values",
    label: "Values",
    blurb: "Figures, amounts and quantities",
  },
  {
    id: "dates",
    label: "Dates",
    blurb: "Dates and deadlines",
  },
  {
    id: "pages",
    label: "Pages",
    blurb: "Whole pages added, removed or moved",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Capabilities that are not built yet. Shown as future, never as results. */
export const PLANNED_CATEGORIES = [
  { label: "Tables", blurb: "Row, column and cell changes" },
  { label: "Images", blurb: "Replaced logos, diagrams and signatures" },
] as const;

export type EditKind = "added" | "removed" | "changed" | "moved";

/** Reserved for a future engine-supplied ranking. Nothing sets it today. */
export type AttentionLevel = "high" | "medium" | "low";

export function categoryOf(change: Change): CategoryId {
  switch (change.type) {
    case "NUMBER_CHANGED":
      return "values";
    case "DATE_CHANGED":
      return "dates";
    case "PAGE_ADDED":
    case "PAGE_REMOVED":
    case "PAGE_MOVED":
      return "pages";
    default:
      return "content";
  }
}

export function editKindOf(change: Change): EditKind {
  return change.kind === "modified" ? "changed" : change.kind;
}

/**
 * What a person would call this change. Technical names such as NUMBER_CHANGED
 * stay available as secondary detail; they are never the headline.
 */
export function headlineFor(change: Change): string {
  const category = categoryOf(change);
  const kind = editKindOf(change);

  if (category === "pages") {
    return { added: "Page added", removed: "Page removed", moved: "Page moved", changed: "Page changed" }[
      kind
    ];
  }
  if (category === "values") return "Value changed";
  if (category === "dates") return "Date changed";
  return { added: "Content added", removed: "Content removed", moved: "Content moved", changed: "Content rewritten" }[
    kind
  ];
}

export const EDIT_KIND_LABEL: Record<EditKind, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  moved: "Moved",
};

/** Symbols back up colour, so meaning survives greyscale and colour blindness. */
export const EDIT_KIND_MARK: Record<EditKind, string> = {
  added: "+",
  removed: "−",
  changed: "±",
  moved: "→",
};

// ---------------------------------------------------------------- page model

export type PageBucket = {
  page: number;
  count: number;
  /** Share of the busiest page's count, 0-1, used for the page map's height. */
  intensity: number;
};

/**
 * Which page a change belongs to in the revised document.
 *
 * The revised document is the one a reader is holding, so it anchors the page
 * map. A removal that exists only in the previous version keeps its own page
 * number, flagged so the interface can say so.
 */
export function primaryPage(change: Change): { page: number; side: "new" | "old" } | null {
  if (change.newPages.length > 0) return { page: change.newPages[0], side: "new" };
  if (change.oldPages.length > 0) return { page: change.oldPages[0], side: "old" };
  return null;
}

export function pageBuckets(changes: Change[], revisedPageCount: number): PageBucket[] {
  const counts = new Map<number, number>();
  for (const change of changes) {
    const anchor = primaryPage(change);
    if (anchor) counts.set(anchor.page, (counts.get(anchor.page) ?? 0) + 1);
  }
  const highest = Math.max(1, ...counts.values());
  const lastPage = Math.max(revisedPageCount, ...counts.keys(), 1);

  return Array.from({ length: lastPage }, (_, index) => {
    const page = index + 1;
    const count = counts.get(page) ?? 0;
    return { page, count, intensity: count === 0 ? 0 : count / highest };
  });
}

// ---------------------------------------------------------------- the report

export type CategorySummary = {
  id: CategoryId;
  label: string;
  blurb: string;
  count: number;
};

export type Report = {
  /** Changes the engine considers meaningful, in document order. */
  changes: Change[];
  /** Page furniture and pure moves, kept and explained rather than discarded. */
  minor: Change[];
  totalMeaningful: number;
  pagesAffected: number;
  categories: CategorySummary[];
  mix: { kind: EditKind; count: number }[];
  pages: PageBucket[];
  documents: ComparisonResponse["documents"];
  pageDelta: number;
  quantified: number;
  notes: string[];
};

function inDocumentOrder(a: Change, b: Change): number {
  const pageA = primaryPage(a)?.page ?? Number.MAX_SAFE_INTEGER;
  const pageB = primaryPage(b)?.page ?? Number.MAX_SAFE_INTEGER;
  return pageA === pageB ? a.seq - b.seq : pageA - pageB;
}

export function buildReport(result: ComparisonResponse): Report {
  const meaningful = result.changes.filter((change) => !change.isNoise).sort(inDocumentOrder);
  const minor = result.changes.filter((change) => change.isNoise).sort(inDocumentOrder);

  const pagesAffected = new Set(
    meaningful.map((change) => primaryPage(change)?.page).filter((page): page is number => !!page),
  ).size;

  const categories = CATEGORIES.map((category) => ({
    ...category,
    count: meaningful.filter((change) => categoryOf(change) === category.id).length,
  }));

  const mix = (["added", "removed", "changed", "moved"] as EditKind[])
    .map((kind) => ({ kind, count: meaningful.filter((c) => editKindOf(c) === kind).length }))
    .filter((entry) => entry.count > 0);

  return {
    changes: meaningful,
    minor,
    totalMeaningful: meaningful.length,
    pagesAffected,
    categories,
    mix,
    pages: pageBuckets(meaningful, result.documents.revised.pageCount),
    documents: result.documents,
    pageDelta: result.documents.revised.pageCount - result.documents.previous.pageCount,
    quantified: meaningful.filter((change) => !!change.delta).length,
    notes: result.diagnostics.notes,
  };
}

// ---------------------------------------------------------------- filtering

function isPageAnchor(change: Change): "added" | "removed" | null {
  if (change.type === "PAGE_ADDED") return "added";
  if (change.type === "PAGE_REMOVED") return "removed";
  return null;
}

export type Filters = {
  categories: CategoryId[];
  kinds: EditKind[];
  pages: number[];
  query: string;
  includeMinor: boolean;
};

export const NO_FILTERS: Filters = {
  categories: [],
  kinds: [],
  pages: [],
  query: "",
  includeMinor: false,
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.categories.length > 0 ||
    filters.kinds.length > 0 ||
    filters.pages.length > 0 ||
    filters.query.trim() !== ""
  );
}

/** Searches what the user can see: values, labels and evidence excerpts. */
function matchesQuery(change: Change, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    change.label,
    change.oldValue,
    change.newValue,
    headlineFor(change),
    ...change.evidence.map((item) => item.excerpt),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function applyFilters(report: Report, filters: Filters): Change[] {
  const pool = filters.includeMinor
    ? [...report.changes, ...report.minor].sort(inDocumentOrder)
    : report.changes;

  const passesChosenFilters = (change: Change) => {
    if (filters.categories.length > 0 && !filters.categories.includes(categoryOf(change)))
      return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(editKindOf(change))) return false;
    if (filters.pages.length > 0) {
      const location = primaryPage(change);
      if (!location || !filters.pages.includes(location.page)) return false;
    }
    return true;
  };

  const kept = pool.filter(
    (change) => passesChosenFilters(change) && matchesQuery(change, filters.query),
  );

  if (!filters.query.trim()) return kept;

  // Searching for wording that sits on a newly added page should still show
  // which page it is on. The page's own record rarely contains the search term,
  // so it is brought back to keep that context — but only when the filters the
  // user actually chose would have allowed it anyway. Narrowing to "Content"
  // still excludes page records, because that is what was asked for.
  const keptIds = new Set(kept.map((change) => change.id));
  const anchors = pool.filter(
    (change) =>
      !keptIds.has(change.id) &&
      isPageAnchor(change) !== null &&
      passesChosenFilters(change) &&
      kept.some((match) => sharesPageWithAnchor(match, change)),
  );

  return [...kept, ...anchors].sort(inDocumentOrder);
}

/** True when `change` is content belonging to the page `anchor` added or removed. */
function sharesPageWithAnchor(change: Change, anchor: Change): boolean {
  const wanted = isPageAnchor(anchor);
  if (wanted === null || isPageAnchor(change) !== null) return false;
  if (editKindOf(change) !== wanted) return false;
  const here = primaryPage(change);
  const there = primaryPage(anchor);
  return !!here && !!there && here.page === there.page && here.side === there.side;
}

/** Adds or removes one value, so clicking a summary element toggles it. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

// ---------------------------------------------------------------- grouping

/**
 * One card in the results list.
 *
 * A whole new page arrives from the engine as a PAGE_ADDED record plus one
 * record per piece of text on it. Showing twenty "Content added" cards is
 * accurate and useless: the reader needs to learn that a page is new before
 * reading its contents. So those records are presented as one page-level card
 * with the text changes nested inside it.
 *
 * This is presentation only. No record is merged, altered or dropped — the
 * members are the original Change objects, with their evidence intact, and the
 * summary keeps counting every one of them individually.
 */
export type ReportItem =
  | { type: "change"; key: string; change: Change }
  | {
      type: "page-group";
      key: string;
      anchor: Change;
      members: Change[];
      page: number;
      side: "new" | "old";
    };

/**
 * Groups whole-page additions and removals with the text they contain.
 *
 * A group forms only where the engine reported the page itself as added or
 * removed. A page that merely has some edited wording has no anchor, so its
 * changes stay as ordinary cards.
 */
export function groupIntoItems(changes: Change[]): ReportItem[] {
  const anchors = changes.filter((change) => isPageAnchor(change) !== null);
  if (anchors.length === 0) {
    return changes.map((change) => ({ type: "change", key: change.id, change }));
  }

  const claimed = new Set<string>();
  const membersByAnchor = new Map<string, Change[]>();

  for (const anchor of anchors) {
    const wanted = isPageAnchor(anchor);
    const anchorPage = primaryPage(anchor);
    if (!anchorPage) continue;

    const members = changes.filter((change) => {
      if (change.id === anchor.id || claimed.has(change.id)) return false;
      if (isPageAnchor(change) !== null) return false; // never nest a page inside a page
      if (editKindOf(change) !== wanted) return false; // an edit is not part of a new page
      const location = primaryPage(change);
      return !!location && location.page === anchorPage.page && location.side === anchorPage.side;
    });

    for (const member of members) claimed.add(member.id);
    membersByAnchor.set(anchor.id, members);
  }

  const items: ReportItem[] = [];
  for (const change of changes) {
    if (claimed.has(change.id)) continue; // shown inside its page group
    const members = membersByAnchor.get(change.id);
    if (members) {
      const location = primaryPage(change)!;
      items.push({
        type: "page-group",
        key: change.id,
        anchor: change,
        members,
        page: location.page,
        side: location.side,
      });
    } else {
      items.push({ type: "change", key: change.id, change });
    }
  }
  return items;
}

/** Every underlying record an item stands for, so counts stay honest. */
export function changesIn(item: ReportItem): Change[] {
  return item.type === "change" ? [item.change] : [item.anchor, ...item.members];
}

export function pageGroupHeadline(item: Extract<ReportItem, { type: "page-group" }>): string {
  return item.side === "new" ? `Page ${item.page} — new page added` : `Page ${item.page} — page removed`;
}

export function pageGroupSummary(item: Extract<ReportItem, { type: "page-group" }>): string {
  return item.side === "new"
    ? "This page does not appear in the previous version. All of its content is new."
    : "This page is not in the revised version. All of its content has gone.";
}

// ---------------------------------------------------------------- wording

export function describeScope(report: Report): string {
  if (report.totalMeaningful === 0) return "No differences found";
  const changes = `${report.totalMeaningful} change${report.totalMeaningful === 1 ? "" : "s"}`;
  const pages = `${report.pagesAffected} page${report.pagesAffected === 1 ? "" : "s"}`;
  return `${changes} across ${pages}`;
}

export function describePageDelta(report: Report): string | null {
  const { previous, revised } = report.documents;
  if (report.pageDelta === 0) return `Both versions have ${revised.pageCount} pages`;
  const direction = report.pageDelta > 0 ? "longer" : "shorter";
  const amount = Math.abs(report.pageDelta);
  return `${previous.pageCount} → ${revised.pageCount} pages · ${amount} page${
    amount === 1 ? "" : "s"
  } ${direction}`;
}

/** A short, plain description of where a change sits. */
export function describeLocation(change: Change): string {
  const from = change.oldPages[0];
  const to = change.newPages[0];
  if (from && to && from !== to) return `Page ${from} → ${to}`;
  if (to) return `Page ${to}`;
  if (from) return `Page ${from} (previous version)`;
  return "Location not recorded";
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? "under a second" : `${(ms / 1000).toFixed(1)} seconds`;
}

// ---------------------------------------------------------------- the comparison workspace

/**
 * Every change, in the workspace's shared shape.
 *
 * Meaningful changes come first, numbered 1…N in document order; minor ones
 * (page furniture, pure moves) follow with their own numbers, so the numbers a
 * reader sees run without gaps. The place is always a page the engine
 * recorded — never estimated — and says which version when only the original
 * has it.
 */
export function toWorkspaceChanges(result: ComparisonResponse): WorkspaceChange[] {
  const ordered = [
    ...result.changes.filter((change) => !change.isNoise).sort(inDocumentOrder),
    ...result.changes.filter((change) => change.isNoise).sort(inDocumentOrder),
  ];
  return ordered.map((change, index) => {
    const anchor = primaryPage(change);
    const category = categoryOf(change);
    const categoryLabel = CATEGORIES.find((item) => item.id === category)?.label ?? "Content";
    const title = headlineFor(change);
    const place = describeLocation(change);
    const values = category === "values" || category === "dates";
    const before = values ? change.oldValue : shorten(change.oldValue, 70);
    const after = values ? change.newValue : shorten(change.newValue, 70);
    const excerpt =
      change.evidence.find((item) => item.side === "new" && item.excerpt)?.excerpt ??
      change.evidence.find((item) => item.excerpt)?.excerpt ??
      null;
    const said = [change.oldValue && `from ${shorten(change.oldValue, 60)}`, change.newValue && `to ${shorten(change.newValue, 60)}`]
      .filter(Boolean)
      .join(" ");
    return {
      id: change.id,
      number: index + 1,
      group: anchor ? `${anchor.side}-${anchor.page}` : "unplaced",
      groupLabel: anchor ? (anchor.side === "new" ? `Page ${anchor.page}` : `Page ${anchor.page} (original)`) : "No page recorded",
      title,
      place,
      category: categoryLabel,
      kind: editKindOf(change),
      before,
      after,
      context: before || after ? null : shorten(excerpt, 80),
      description: `Change ${index + 1}: ${title}, ${place}${said ? `, ${said}` : ""}.`,
      searchText: [title, place, categoryLabel, change.label, change.oldValue, change.newValue, change.delta, ...change.evidence.map((item) => item.excerpt)]
        .filter(Boolean)
        .join(" "),
      tags: { category: [category], page: anchor && anchor.side === "new" ? [String(anchor.page)] : [] },
      minor: change.isNoise,
    };
  });
}

/** The filters PDF Compare offers: kind of change, and what changed. Pages are chosen from the page map. */
export function workspaceFilters(changes: WorkspaceChange[]): FilterGroup[] {
  return [
    kindFilter(changes),
    filterGroup("category", "What changed", changes, CATEGORIES.map(({ id, label }) => ({ id, label }))),
    filterGroup(
      "page",
      "Page",
      changes,
      [...new Set(changes.flatMap((change) => change.tags?.page ?? []))]
        .sort((a, b) => Number(a) - Number(b))
        .map((page) => ({ id: page, label: `Page ${page}` })),
      { inBar: false },
    ),
  ];
}
