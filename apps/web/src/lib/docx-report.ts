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
};

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
  return item.scope === "document" ? "Document properties" : `${side}: ${item.location}`;
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
 * under. A Word file stores no page numbers — pages depend on the printer,
 * fonts and window size — so none are ever shown. When there is no heading
 * above the change, that is said plainly.
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
  return `In Word: ${where}. Paragraphs are counted from the start of the document; Word files have no fixed page numbers.`;
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
      return {
        id: change.id,
        number: index + 1,
        group: top ? `s:${top}` : change.category === "metadata" ? "properties" : "top",
        groupLabel: top ?? (change.category === "metadata" ? "Document properties" : "Before the first heading"),
        title,
        place,
        placeNote: docxPlaceNote(change),
        category: labels.get(change.group) ?? "Other",
        kind: editKindOf(change),
        before,
        after,
        context: before || after ? null : shorten(excerpt, 80),
        description: `Change ${index + 1}: ${title}, ${place}${said ? `, ${said}` : ""}.`,
        searchText: [
          title,
          place,
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
        tags: { group: [change.group] },
      };
    });
}

export function docxFilters(result: DocxComparison, changes: WorkspaceChange[]): FilterGroup[] {
  return [
    kindFilter(changes),
    filterGroup(
      "group",
      "What changed",
      changes,
      result.groups.map(({ id, label }) => ({ id, label })),
      { inBar: false },
    ),
  ];
}
