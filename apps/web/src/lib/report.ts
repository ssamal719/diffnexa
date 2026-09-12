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
  const pool = filters.includeMinor ? [...report.changes, ...report.minor].sort(inDocumentOrder) : report.changes;

  return pool.filter((change) => {
    if (filters.categories.length > 0 && !filters.categories.includes(categoryOf(change))) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(editKindOf(change))) return false;
    if (filters.pages.length > 0) {
      const anchor = primaryPage(change);
      if (!anchor || !filters.pages.includes(anchor.page)) return false;
    }
    return matchesQuery(change, filters.query);
  });
}

/** Adds or removes one value, so clicking a summary element toggles it. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
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
