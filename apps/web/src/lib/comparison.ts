/**
 * The shape of a comparison result, and the pure logic for presenting it.
 *
 * Everything here is display logic only: grouping, ordering and wording. No
 * value shown to the user is calculated here — old values, new values,
 * differences and page numbers all come from the engine, which derived them
 * from the documents themselves.
 */

export type ChangeType =
  | "PAGE_ADDED"
  | "PAGE_REMOVED"
  | "PAGE_MOVED"
  | "TEXT_ADDED"
  | "TEXT_REMOVED"
  | "TEXT_MODIFIED"
  | "TEXT_MOVED"
  | "NUMBER_CHANGED"
  | "DATE_CHANGED"
  | "IDENTIFIER_CHANGED"
  | "TABLE_CHANGED"
  | "IMAGE_CHANGED"
  | "LINK_CHANGED"
  | "METADATA_CHANGED"
  | "FORMATTING_CHANGED"
  | "LAYOUT_CHANGED";

export type EvidenceItem = {
  side: "old" | "new";
  page: number | null;
  excerpt: string | null;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  wordCount: number;
};

export type Change = {
  id: string;
  seq: number;
  type: ChangeType;
  kind: "added" | "removed" | "modified" | "moved";
  category: string;
  label: string | null;
  oldValue: string | null;
  newValue: string | null;
  delta: string | null;
  confidence: number;
  isNoise: boolean;
  noiseReason: string | null;
  oldPages: number[];
  newPages: number[];
  evidence: EvidenceItem[];
};

export type PdfOptions = { ignoreCase: boolean; ignorePunctuation: boolean };

export const DEFAULT_PDF_OPTIONS: PdfOptions = { ignoreCase: true, ignorePunctuation: false };

export type ComparisonResponse = {
  engineVersion: string;
  processingMs: number;
  documents: {
    previous: { pageCount: number; sha256: string };
    revised: { pageCount: number; sha256: string };
  };
  counts: { total: number; meaningful: number; noise: number };
  changes: Change[];
  /** The Ignore options the comparison applied (absent from older results). */
  options?: PdfOptions;
  /**
   * The pages the comparison paired, in reading order: an original page and
   * the revised page matched with it, or null where a page is only in one
   * version. Used to turn both versions to matching pages together.
   */
  pageLinks?: { previous: number | null; revised: number | null }[];
  diagnostics: {
    ocrRequired: boolean;
    previousScannedPages: number[];
    revisedScannedPages: number[];
    previousPagesWithoutText: number[];
    revisedPagesWithoutText: number[];
    notes: string[];
  };
};

export type ComparisonError = { code: string; message: string; side?: string | null };

/** Group headings, in the order they are shown. */
export const GROUPS = [
  { id: "numbers", title: "Numbers" },
  { id: "dates", title: "Dates" },
  { id: "text", title: "Text" },
  { id: "pages", title: "Pages" },
  { id: "other", title: "Other" },
] as const;

export type GroupId = (typeof GROUPS)[number]["id"];

export function groupOf(change: Change): GroupId {
  switch (change.type) {
    case "NUMBER_CHANGED":
      return "numbers";
    case "DATE_CHANGED":
      return "dates";
    case "TEXT_ADDED":
    case "TEXT_REMOVED":
    case "TEXT_MODIFIED":
    case "TEXT_MOVED":
      return "text";
    case "PAGE_ADDED":
    case "PAGE_REMOVED":
    case "PAGE_MOVED":
      return "pages";
    default:
      return "other";
  }
}

export function groupChanges(changes: Change[]): { id: GroupId; title: string; items: Change[] }[] {
  return GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    items: changes.filter((change) => groupOf(change) === group.id),
  })).filter((group) => group.items.length > 0);
}

/** Plain-language name for a change type, never abbreviations or code. */
export function describeType(type: ChangeType): string {
  const names: Record<ChangeType, string> = {
    PAGE_ADDED: "Page added",
    PAGE_REMOVED: "Page removed",
    PAGE_MOVED: "Page moved",
    TEXT_ADDED: "Text added",
    TEXT_REMOVED: "Text removed",
    TEXT_MODIFIED: "Text changed",
    TEXT_MOVED: "Text moved",
    NUMBER_CHANGED: "Number changed",
    DATE_CHANGED: "Date changed",
    IDENTIFIER_CHANGED: "Reference changed",
    TABLE_CHANGED: "Table changed",
    IMAGE_CHANGED: "Image changed",
    LINK_CHANGED: "Link changed",
    METADATA_CHANGED: "Document details changed",
    FORMATTING_CHANGED: "Formatting changed",
    LAYOUT_CHANGED: "Layout changed",
  };
  return names[type];
}

/** "3 changes found" / "1 change found" / "No changes found". */
export function summarize(count: number): string {
  if (count === 0) return "No changes found";
  return `${count} change${count === 1 ? "" : "s"} found`;
}

/** "page 3", "pages 2 and 4", "pages 1, 2 and 5". */
export function describePages(pages: number[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) return `page ${pages[0]}`;
  const head = pages.slice(0, -1).join(", ");
  return `pages ${head} and ${pages[pages.length - 1]}`;
}

/** Where a change sits, described from whichever side has evidence. */
export function changeLocation(change: Change): string | null {
  const newPages = describePages(change.newPages);
  const oldPages = describePages(change.oldPages);
  if (newPages && oldPages && newPages !== oldPages) {
    return `${oldPages} → ${newPages}`;
  }
  return newPages ?? oldPages;
}

/** The first excerpt from a given side, for the evidence line on a card. */
export function excerptFor(change: Change, side: "old" | "new"): string | null {
  return change.evidence.find((item) => item.side === side && item.excerpt)?.excerpt ?? null;
}
