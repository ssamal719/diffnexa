/**
 * Turning a Word document comparison into the report the interface shows.
 *
 * Presentation only. Every value shown — before, after, difference, where it
 * is, the quoted evidence and the group a change is in — comes from the
 * engine's response. Groups say what kind of content changed; nothing here
 * ranks a change or says whether it is good, bad or important.
 */

import { citedText, readView, type ContentView } from "@/lib/content-view";
import { filterGroup, kindFilter, shorten, type FilterGroup, type WorkspaceChange } from "@/lib/workspace";

// ---------------------------------------------------------------- the API shape

export type DocxEvidence = {
  side: "old" | "new";
  scope: "node" | "document";
  nodeId: string | null;
  path: string | null;
  sectionPath: string[];
  field: string | null;
  excerpt: string | null;
  /** Where this is, in words a reader can find in Word: "Table 2, row 3, column 2". */
  location: string;
  /**
   * The page the first cited word was on when Microsoft Word last saved the
   * document — null when the file carries no page layout DiffNexa can trust.
   */
  page?: number | null;
};

/** Whether a document's pages can be shown, and if not, why. */
export type DocxLayoutSummary = {
  status: "recorded" | "unavailable";
  reason: "no_statistics" | "statistics_out_of_date" | "pages_disagree" | "empty" | null;
  pages: number | null;
};

/** What counted as the same words in this comparison, as the engine applied it. */
export type DocxOptions = { ignoreCase: boolean; ignorePunctuation: boolean };

export const DEFAULT_DOCX_OPTIONS: DocxOptions = { ignoreCase: true, ignorePunctuation: false };

export type DocxGroupId =
  | "text"
  | "headings"
  | "lists"
  | "tables"
  | "numbers"
  | "dates"
  | "structure"
  | "other";

export type DocxChange = {
  id: string;
  seq: number;
  type: string;
  kind: "added" | "removed" | "modified" | "moved";
  category: string;
  subtype: string | null;
  label: string | null;
  oldValue: string | null;
  newValue: string | null;
  delta: string | null;
  confidence: number;
  sections: string[];
  group: DocxGroupId;
  /** Words added to or removed from a block that is still there, not a whole block. */
  withinBlock: boolean;
  evidence: DocxEvidence[];
};

export type DocxGroup = {
  id: DocxGroupId;
  label: string;
  changeCount: number;
  changeIds: string[];
};

export type DocxComparison = {
  engineVersion: string;
  processingMs: number;
  /** The matching options the engine used; older results have none (the defaults). */
  options?: DocxOptions;
  /** Whether each document's pages could be read from the file. */
  layout?: { previous: DocxLayoutSummary; revised: DocxLayoutSummary };
  documents: {
    previous: { sha256: string; nodeCount: number };
    revised: { sha256: string; nodeCount: number };
  };
  counts: { total: number; meaningful: number; noise: number };
  changes: DocxChange[];
  groups: DocxGroup[];
  diagnostics: {
    notes: string[];
    previousWarnings: string[];
    revisedWarnings: string[];
    droppedUntraceable: number;
  };
  /** Both documents' content with every change's evidence marked, for the side-by-side view (see content-view.ts). */
  view?: unknown;
};

export type DocxFailure = { code: string; message: string; side?: "original" | "revised" | null };

// ---------------------------------------------------------------- wording

export const NO_CHANGES_HEADLINE = "No changes found";
export const NO_CHANGES_SENTENCE = "This document says the same as the original.";

export function headline(total: number): string {
  if (total === 0) return NO_CHANGES_HEADLINE;
  return `${total} change${total === 1 ? "" : "s"} found`;
}

/** What each group holds, in a line. Descriptive, never evaluative. */
export const GROUP_BLURBS: Record<DocxGroupId, string> = {
  text: "Paragraphs added, removed or reworded",
  headings: "Headings added, removed or renamed",
  lists: "Bulleted and numbered list items",
  tables: "Tables, rows and cells",
  numbers: "Amounts, quantities and other numbers in the text",
  dates: "Dates in the text",
  structure: "The same words, moved or given a different role",
  other: "Links and document properties",
};

export type EditKind = "added" | "removed" | "changed" | "moved";

export function editKindOf(change: DocxChange): EditKind {
  return change.kind === "modified" ? "changed" : change.kind;
}

/** A symbol as well as a word, so meaning never rests on colour alone. */
export const EDIT_MARK: Record<EditKind, string> = { added: "+", removed: "−", changed: "±", moved: "→" };

const BY_KIND = (added: string, removed: string, changed: string, moved: string) =>
  ({ added, removed, changed, moved }) as Record<EditKind, string>;

/** What this change is, in plain words. The engine's internal names never appear. */
export function headlineFor(change: DocxChange): string {
  const kind = editKindOf(change);
  if (change.category === "metadata") {
    return change.subtype === "subject" ? "Document subject changed" : "Document title changed";
  }
  if (change.category === "link") {
    return BY_KIND("Link added", "Link removed", "Link now points elsewhere", "Link moved")[kind];
  }
  if (change.subtype === "heading_level") return "Heading level changed";
  if (change.subtype === "block_type") return "Paragraph type changed";
  if (change.subtype === "table") return BY_KIND("Table added", "Table removed", "Table changed", "Table moved")[kind];
  if (change.subtype === "row") {
    return BY_KIND("Table row added", "Table row removed", "Table row changed", "Table row moved")[kind];
  }
  if (change.subtype === "table_cell") {
    if (change.category === "number") return "Number in a table changed";
    if (change.category === "date") return "Date in a table changed";
    return BY_KIND("Table cell added", "Table cell removed", "Table cell changed", "Table cell moved")[kind];
  }
  if (change.category === "number") return "Number changed";
  if (change.category === "date") return "Date changed";
  if (change.withinBlock) {
    const block =
      change.subtype === "heading" ? "a heading" : change.subtype === "list_item" ? "a list item" : "a paragraph";
    return kind === "added" ? `Words added to ${block}` : `Words removed from ${block}`;
  }
  if (change.subtype === "heading") {
    return BY_KIND("Heading added", "Heading removed", "Heading changed", "Heading moved")[kind];
  }
  if (change.subtype === "list_item") {
    return BY_KIND("List item added", "List item removed", "List item changed", "List item moved")[kind];
  }
  return BY_KIND("Text added", "Text removed", "Text changed", "Text moved")[kind];
}

/** Values compared side by side, rather than as passages of text. */
export function showsValuesInline(change: DocxChange): boolean {
  return (
    change.category === "number" ||
    change.category === "date" ||
    change.category === "layout" ||
    change.subtype === "table_cell"
  );
}

/** A piece of evidence's place: its page first when the file records pages, then its paragraph or cell. */
export function whereOf(item: DocxEvidence): string {
  if (item.scope === "document") return "Document properties";
  return typeof item.page === "number" ? `Page ${item.page} · ${item.location}` : item.location;
}

/**
 * Where the change is, in the revised document if it is there and in the
 * original if it was removed. Taken from the evidence the engine cited.
 */
export function locationOf(change: DocxChange): string | null {
  const revised = change.evidence.find((item) => item.side === "new");
  const original = change.evidence.find((item) => item.side === "old");
  const item = revised ?? original;
  if (!item) return null;
  const side = revised ? "Revised" : "Original";
  return item.scope === "document" ? "Document properties" : `${side}: ${whereOf(item)}`;
}

/**
 * The page a change is on: in the revised document when it is there, in the
 * original when it was removed. Null when that document records no pages.
 */
export function pageOf(change: DocxChange): { page: number; side: "old" | "new" } | null {
  const revised = change.evidence.find((item) => item.side === "new" && item.scope === "node");
  const original = change.evidence.find((item) => item.side === "old" && item.scope === "node");
  const item = revised ?? original;
  return item && typeof item.page === "number" ? { page: item.page, side: item.side } : null;
}

const LAYOUT_REASONS: Record<NonNullable<DocxLayoutSummary["reason"]>, string> = {
  no_statistics: "the file does not record a page layout",
  statistics_out_of_date:
    "the file was not last saved by Microsoft Word, or the page layout saved in it is out of date",
  pages_disagree: "the page layout saved in the file does not match its own page count",
  empty: "the document has no text",
};

/**
 * What the reader needs to know about page numbers, once: where they come
 * from, or why there are none. Null for results from before pages existed.
 */
export function layoutNote(result: DocxComparison): { title: string; text: string } | null {
  const layout = result.layout;
  if (!layout) return null;
  const sides = [
    ["original", layout.previous],
    ["revised", layout.revised],
  ] as const;
  const missing = sides.filter(([, summary]) => summary.status !== "recorded");
  if (missing.length === 0) {
    return {
      title: "Page numbers",
      text: "Pages are the ones Microsoft Word showed when each document was last saved, read from the page layout Word stores in the file. Paragraph numbers are shown beside them.",
    };
  }
  const which =
    missing.length === 2 ? "either document" : `the ${missing[0][0]} document`;
  const reasons = [...new Set(missing.map(([, summary]) => LAYOUT_REASONS[summary.reason ?? "no_statistics"]))];
  return {
    title: "Page numbers",
    text: `Page numbers are not shown for ${which}, because ${reasons.join("; and ")}. Changes there are located by heading and paragraph instead. Opening the document in Microsoft Word and saving it records its pages.`,
  };
}

// ---------------------------------------------------------------- grouping and filtering

export type GroupedChanges = { id: DocxGroupId; label: string; blurb: string; changes: DocxChange[] };

/** The groups that have changes, in the engine's order, each in reading order. */
export function groupChanges(result: DocxComparison, changes: DocxChange[] = result.changes): GroupedChanges[] {
  const wanted = new Set(changes.map((change) => change.id));
  const byId = new Map(result.changes.map((change) => [change.id, change]));
  return result.groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      blurb: GROUP_BLURBS[group.id],
      changes: group.changeIds
        .filter((id) => wanted.has(id))
        .map((id) => byId.get(id)!)
        .filter(Boolean)
        .sort((a, b) => a.seq - b.seq),
    }))
    .filter((group) => group.changes.length > 0);
}

/** Searches everything a reader can see on a card, including its evidence. */
export function matchesQuery(change: DocxChange, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    change.label,
    change.oldValue,
    change.newValue,
    change.delta,
    headlineFor(change),
    ...change.sections,
    ...change.evidence.flatMap((item) => [item.excerpt, item.location]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function filterChanges(
  result: DocxComparison,
  { query, group }: { query: string; group: DocxGroupId | null },
): DocxChange[] {
  return result.changes.filter(
    (change) => (group === null || change.group === group) && matchesQuery(change, query),
  );
}

/**
 * What the documents contain that V1 does not compare, said once per document.
 */
export function readingNotes(result: DocxComparison): { title: string; text: string }[] {
  const notes: { title: string; text: string }[] = [];
  const original = result.diagnostics.previousWarnings;
  const revised = result.diagnostics.revisedWarnings;
  if (original.length > 0) notes.push({ title: "About the original document", text: original.join(" ") });
  if (revised.length > 0) notes.push({ title: "About the revised document", text: revised.join(" ") });
  for (const note of result.diagnostics.notes) notes.push({ title: "Worth knowing", text: note });
  return notes;
}

// ---------------------------------------------------------------- the comparison workspace

/**
 * Where a Word change is, in the document's own terms: the headings it sits
 * under. When there is no heading above the change, that is said plainly.
 * Pages are added by the caller, and only when the file records them: a
 * Word file's pages depend on the fonts and printer of whoever lays it out,
 * so DiffNexa uses the layout Word saved and never works pages out itself.
 */
export function docxPlace(change: DocxChange, view: ContentView | null = null): string {
  if (change.category === "metadata") return "Document properties";
  const path = sectionPathOf(change);
  if (change.subtype === "heading" || change.subtype === "heading_level") {
    // A heading's own place is the heading itself, under whatever headings are above it.
    const name = citedText(view, change.evidence);
    const parts = [...path, name ? `“${name}”` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(" › ") : "A top-level heading";
  }
  return path.length > 0 ? path.join(" › ") : "Before the first heading";
}

/** The headings above a change: in the revised document when it is there, otherwise in the original. */
function sectionPathOf(change: DocxChange): string[] {
  const revised = change.evidence.find((item) => item.side === "new" && item.scope === "node");
  const original = change.evidence.find((item) => item.side === "old" && item.scope === "node");
  return (revised ?? original)?.sectionPath ?? [];
}

/**
 * The structural location the engine recorded — "Paragraph 18", "Table 2, row
 * 3, column 2" — as a secondary detail, labelled so it is never mistaken for a
 * page. Paragraph numbers are counted from the start of the document.
 */
export function docxPlaceNote(change: DocxChange): string | null {
  const where = locationOf(change);
  if (!where || change.category === "metadata") return null;
  if (pageOf(change)) {
    return `In Word: ${where}. Pages are as Word laid out the document when it was last saved; paragraphs are counted from the start of the document.`;
  }
  return `In Word: ${where}. Paragraphs are counted from the start of the document; this file does not record its pages.`;
}

export function docxWorkspaceChanges(result: DocxComparison): WorkspaceChange[] {
  const labels = new Map(result.groups.map((group) => [group.id, group.label]));
  const view = readView(result.view);
  return [...result.changes]
    .sort((a, b) => a.seq - b.seq)
    .map((change, index) => {
      const title = headlineFor(change);
      const place = docxPlace(change, view);
      const inline = showsValuesInline(change);
      const before = inline ? change.oldValue : shorten(change.oldValue, 70);
      const after = inline ? change.newValue : shorten(change.newValue, 70);
      const excerpt =
        change.evidence.find((item) => item.side === "new" && item.excerpt)?.excerpt ??
        change.evidence.find((item) => item.excerpt)?.excerpt;
      const said = [change.oldValue && `from ${shorten(change.oldValue, 60)}`, change.newValue && `to ${shorten(change.newValue, 60)}`]
        .filter(Boolean)
        .join(" ");
      const heading = change.subtype === "heading" || change.subtype === "heading_level";
      const top = sectionPathOf(change)[0] ?? (heading ? (citedText(view, change.evidence) ?? undefined) : undefined);
      // With the pages recorded, a change is found by its page first — the
      // way a reader finds it in a long document — with its headings or
      // paragraph after. Without them, by the headings it sits under.
      const paged = pageOf(change);
      const pageLabel = paged ? `Page ${paged.page}${paged.side === "old" ? " (original)" : ""}` : null;
      const firstNode = change.evidence.find((item) => item.scope === "node");
      const pagePlace = paged
        ? `${pageLabel} · ${sectionPathOf(change).length > 0 ? place : (firstNode?.location ?? place)}`
        : place;
      return {
        id: change.id,
        number: index + 1,
        group: paged
          ? `p:${paged.side}:${paged.page}`
          : top
            ? `s:${top}`
            : change.category === "metadata"
              ? "properties"
              : "top",
        groupLabel:
          pageLabel ?? top ?? (change.category === "metadata" ? "Document properties" : "Before the first heading"),
        title,
        place: pagePlace,
        placeNote: docxPlaceNote(change),
        category: labels.get(change.group) ?? "Other",
        kind: editKindOf(change),
        before,
        after,
        context: before || after ? null : shorten(excerpt, 80),
        description: `Change ${index + 1}: ${title}, ${pagePlace}${said ? `, ${said}` : ""}.`,
        searchText: [
          title,
          pagePlace,
          labels.get(change.group),
          change.label,
          change.oldValue,
          change.newValue,
          change.delta,
          ...change.sections,
          ...change.evidence.flatMap((item) => [item.excerpt, item.location]),
        ]
          .filter(Boolean)
          .join(" "),
        tags: { group: [change.group], ...(paged ? { page: [String(paged.page)] } : {}) },
      };
    });
}

export function docxFilters(result: DocxComparison, changes: WorkspaceChange[]): FilterGroup[] {
  const pages = [...new Set(changes.flatMap((change) => change.tags?.page ?? []))]
    .map(Number)
    .sort((a, b) => a - b)
    .map((page) => ({ id: String(page), label: `Page ${page}` }));
  const groups = [
    kindFilter(changes),
    filterGroup(
      "group",
      "What changed",
      changes,
      result.groups.map(({ id, label }) => ({ id, label })),
      { inBar: false },
    ),
  ];
  if (pages.length > 0) groups.push(filterGroup("page", "Page", changes, pages, { inBar: false }));
  return groups;
}
