/**
 * Tests for the report layer: what the summary says, how filters narrow the
 * list, and how changes are described in plain language.
 *
 * These guard the promise that the interface only ever shows what the engine
 * found. Nothing here may invent a value, a page or an importance ranking.
 */

import { describe, expect, it } from "vitest";

import type { Change, ComparisonResponse } from "@/lib/comparison";
import {
  CATEGORIES,
  NO_FILTERS,
  applyFilters,
  buildReport,
  categoryOf,
  describeLocation,
  describePageDelta,
  describeScope,
  changesIn,
  editKindOf,
  groupIntoItems,
  headlineFor,
  pageGroupHeadline,
  pageGroupSummary,
  pageBuckets,
  primaryPage,
  toWorkspaceChanges,
  toggle,
  workspaceFilters,
} from "@/lib/report";

function change(overrides: Partial<Change> = {}): Change {
  return {
    id: "c0",
    seq: 0,
    type: "TEXT_MODIFIED",
    kind: "modified",
    category: "text",
    label: null,
    oldValue: "the supplier shall deliver",
    newValue: "the supplier must deliver",
    delta: null,
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    oldPages: [3],
    newPages: [3],
    evidence: [
      { side: "old", page: 3, excerpt: "the supplier shall deliver", bbox: null, wordCount: 4 },
      { side: "new", page: 3, excerpt: "the supplier must deliver", bbox: null, wordCount: 4 },
    ],
    ...overrides,
  };
}

function result(changes: Change[], previousPages = 10, revisedPages = 10): ComparisonResponse {
  return {
    engineVersion: "test",
    processingMs: 1200,
    documents: {
      previous: { pageCount: previousPages, sha256: "a".repeat(64) },
      revised: { pageCount: revisedPages, sha256: "b".repeat(64) },
    },
    counts: {
      total: changes.length,
      meaningful: changes.filter((c) => !c.isNoise).length,
      noise: changes.filter((c) => c.isNoise).length,
    },
    changes,
    diagnostics: {
      ocrRequired: false,
      previousScannedPages: [],
      revisedScannedPages: [],
      previousPagesWithoutText: [],
      revisedPagesWithoutText: [],
      notes: [],
    },
  };
}

// ---------------------------------------------------------------- vocabulary

describe("plain language", () => {
  it("never shows the engine's internal names as headlines", () => {
    const samples: Change[] = [
      change({ type: "TEXT_ADDED", kind: "added" }),
      change({ type: "NUMBER_CHANGED" }),
      change({ type: "DATE_CHANGED" }),
      change({ type: "PAGE_ADDED", kind: "added" }),
    ];
    for (const sample of samples) {
      const headline = headlineFor(sample);
      expect(headline).not.toMatch(/_/);
      expect(headline).not.toMatch(/[A-Z]{4,}/);
    }
  });

  it("describes each kind of change the way a person would", () => {
    expect(headlineFor(change({ type: "TEXT_ADDED", kind: "added" }))).toBe("Content added");
    expect(headlineFor(change({ type: "TEXT_REMOVED", kind: "removed" }))).toBe("Content removed");
    expect(headlineFor(change({ type: "TEXT_MODIFIED" }))).toBe("Content rewritten");
    expect(headlineFor(change({ type: "NUMBER_CHANGED" }))).toBe("Value changed");
    expect(headlineFor(change({ type: "DATE_CHANGED" }))).toBe("Date changed");
    expect(headlineFor(change({ type: "PAGE_ADDED", kind: "added" }))).toBe("Page added");
  });

  it("sorts every change type into one of the four working categories", () => {
    expect(categoryOf(change({ type: "NUMBER_CHANGED" }))).toBe("values");
    expect(categoryOf(change({ type: "DATE_CHANGED" }))).toBe("dates");
    expect(categoryOf(change({ type: "TEXT_ADDED" }))).toBe("content");
    expect(categoryOf(change({ type: "PAGE_REMOVED" }))).toBe("pages");
    // Anything the engine may add later lands in content rather than vanishing.
    expect(categoryOf(change({ type: "METADATA_CHANGED" }))).toBe("content");
    expect(CATEGORIES.map((c) => c.id)).toEqual(["content", "values", "dates", "pages"]);
  });

  it("calls a modification 'changed' rather than 'modified'", () => {
    expect(editKindOf(change({ kind: "modified" }))).toBe("changed");
    expect(editKindOf(change({ kind: "moved" }))).toBe("moved");
  });

  it("describes where a change is, including when it moved pages", () => {
    expect(describeLocation(change({ oldPages: [3], newPages: [3] }))).toBe("Page 3");
    expect(describeLocation(change({ oldPages: [3], newPages: [5] }))).toBe("Page 3 → 5");
    expect(describeLocation(change({ oldPages: [7], newPages: [] }))).toBe(
      "Page 7 (previous version)",
    );
  });
});

// ---------------------------------------------------------------- the summary

describe("the summary", () => {
  it("counts changes and the pages they sit on", () => {
    const report = buildReport(
      result([
        change({ id: "a", seq: 0, newPages: [2], oldPages: [2] }),
        change({ id: "b", seq: 1, newPages: [2], oldPages: [2] }),
        change({ id: "c", seq: 2, newPages: [8], oldPages: [8] }),
      ]),
    );
    expect(report.totalMeaningful).toBe(3);
    expect(report.pagesAffected).toBe(2);
    expect(describeScope(report)).toBe("3 changes across 2 pages");
  });

  it("uses singular wording for a single change on a single page", () => {
    const report = buildReport(result([change()]));
    expect(describeScope(report)).toBe("1 change across 1 page");
  });

  it("reports no differences when there are none", () => {
    const report = buildReport(result([]));
    expect(report.totalMeaningful).toBe(0);
    expect(describeScope(report)).toBe("No differences found");
  });

  it("keeps minor differences out of the headline but does not discard them", () => {
    const report = buildReport(
      result([
        change({ id: "real" }),
        change({ id: "footer", isNoise: true, noiseReason: "Repeated page footer" }),
      ]),
    );
    expect(report.totalMeaningful).toBe(1);
    expect(report.minor).toHaveLength(1);
    expect(report.minor[0].noiseReason).toBe("Repeated page footer");
  });

  it("explains the page-count difference between the two documents", () => {
    expect(describePageDelta(buildReport(result([], 10, 10)))).toBe("Both versions have 10 pages");
    expect(describePageDelta(buildReport(result([], 10, 13)))).toBe(
      "10 → 13 pages · 3 pages longer",
    );
    expect(describePageDelta(buildReport(result([], 10, 9)))).toBe("10 → 9 pages · 1 page shorter");
  });

  it("counts each category from the engine's own classification", () => {
    const report = buildReport(
      result([
        change({ id: "a", seq: 0, type: "NUMBER_CHANGED" }),
        change({ id: "b", seq: 1, type: "NUMBER_CHANGED" }),
        change({ id: "c", seq: 2, type: "DATE_CHANGED" }),
        change({ id: "d", seq: 3, type: "TEXT_ADDED", kind: "added" }),
      ]),
    );
    const counts = Object.fromEntries(report.categories.map((c) => [c.id, c.count]));
    expect(counts).toEqual({ content: 1, values: 2, dates: 1, pages: 0 });
  });

  it("shows the mix of additions, removals and rewrites", () => {
    const report = buildReport(
      result([
        change({ id: "a", seq: 0, kind: "added", type: "TEXT_ADDED" }),
        change({ id: "b", seq: 1, kind: "added", type: "TEXT_ADDED" }),
        change({ id: "c", seq: 2, kind: "removed", type: "TEXT_REMOVED" }),
        change({ id: "d", seq: 3, kind: "modified" }),
      ]),
    );
    expect(report.mix).toEqual([
      { kind: "added", count: 2 },
      { kind: "removed", count: 1 },
      { kind: "changed", count: 1 },
    ]);
  });

  it("does not claim an importance ranking the engine cannot provide", () => {
    const report = buildReport(result([change()]));
    expect(report).not.toHaveProperty("important");
    expect(Object.keys(report)).not.toContain("attention");
  });
});

// ---------------------------------------------------------------- the page map

describe("the page map", () => {
  it("has one column per page of the revised document", () => {
    expect(pageBuckets([], 6)).toHaveLength(6);
  });

  it("shows which pages changed and how much, relative to the busiest page", () => {
    const buckets = pageBuckets(
      [
        change({ id: "a", newPages: [2] }),
        change({ id: "b", newPages: [2] }),
        change({ id: "c", newPages: [2] }),
        change({ id: "d", newPages: [5] }),
      ],
      6,
    );
    expect(buckets[1]).toEqual({ page: 2, count: 3, intensity: 1 });
    expect(buckets[4]).toMatchObject({ page: 5, count: 1 });
    expect(buckets[4].intensity).toBeCloseTo(1 / 3);
    expect(buckets[0]).toEqual({ page: 1, count: 0, intensity: 0 });
  });

  it("anchors a change to the revised document, falling back to the previous one", () => {
    expect(primaryPage(change({ oldPages: [2], newPages: [4] }))).toEqual({ page: 4, side: "new" });
    expect(primaryPage(change({ oldPages: [2], newPages: [] }))).toEqual({ page: 2, side: "old" });
    expect(primaryPage(change({ oldPages: [], newPages: [] }))).toBeNull();
  });

  it("still shows a removal that exists only beyond the revised document's length", () => {
    const buckets = pageBuckets([change({ oldPages: [12], newPages: [] })], 8);
    expect(buckets).toHaveLength(12);
    expect(buckets[11].count).toBe(1);
  });
});

// ---------------------------------------------------------------- filtering

describe("filters", () => {
  const report = buildReport(
    result([
      change({
        id: "text1",
        seq: 0,
        type: "TEXT_ADDED",
        kind: "added",
        oldValue: null,
        newValue: "The supplier shall provide quarterly reports.",
        newPages: [2],
        oldPages: [],
        evidence: [
          {
            side: "new",
            page: 2,
            excerpt: "The supplier shall provide quarterly reports.",
            bbox: null,
            wordCount: 6,
          },
        ],
      }),
      change({
        id: "num1",
        seq: 1,
        type: "NUMBER_CHANGED",
        label: "Contract value",
        oldValue: "50,000",
        newValue: "75,000",
        delta: "+25,000 (+50%)",
        newPages: [4],
        oldPages: [4],
        evidence: [
          { side: "old", page: 4, excerpt: "Contract value: 50,000", bbox: null, wordCount: 3 },
          { side: "new", page: 4, excerpt: "Contract value: 75,000", bbox: null, wordCount: 3 },
        ],
      }),
      change({
        id: "date1",
        seq: 2,
        type: "DATE_CHANGED",
        label: "Delivery date",
        oldValue: "30 June 2026",
        newValue: "15 July 2026",
        delta: "15 days later",
        newPages: [4],
        oldPages: [4],
        evidence: [
          { side: "old", page: 4, excerpt: "Delivery date: 30 June 2026", bbox: null, wordCount: 5 },
          { side: "new", page: 4, excerpt: "Delivery date: 15 July 2026", bbox: null, wordCount: 5 },
        ],
      }),
      change({
        id: "minor1",
        seq: 3,
        isNoise: true,
        noiseReason: "Repeated header",
        newPages: [9],
        oldPages: [9],
      }),
    ]),
  );

  it("shows every meaningful change when nothing is selected", () => {
    expect(applyFilters(report, NO_FILTERS).map((c) => c.id)).toEqual(["text1", "num1", "date1"]);
  });

  it("narrows to a category when a summary tile is clicked", () => {
    expect(applyFilters(report, { ...NO_FILTERS, categories: ["values"] }).map((c) => c.id)).toEqual(
      ["num1"],
    );
  });

  it("combines categories, because tiles are additive", () => {
    expect(
      applyFilters(report, { ...NO_FILTERS, categories: ["values", "dates"] }).map((c) => c.id),
    ).toEqual(["num1", "date1"]);
  });

  it("narrows to a page when a page column is clicked", () => {
    expect(applyFilters(report, { ...NO_FILTERS, pages: [4] }).map((c) => c.id)).toEqual([
      "num1",
      "date1",
    ]);
  });

  it("narrows to a kind of edit when a mix segment is clicked", () => {
    expect(applyFilters(report, { ...NO_FILTERS, kinds: ["added"] }).map((c) => c.id)).toEqual([
      "text1",
    ]);
  });

  it("applies several filters together", () => {
    const filtered = applyFilters(report, {
      ...NO_FILTERS,
      categories: ["values", "dates"],
      pages: [4],
      kinds: ["changed"],
    });
    expect(filtered.map((c) => c.id)).toEqual(["num1", "date1"]);
  });

  it("searches values, wording and evidence", () => {
    expect(applyFilters(report, { ...NO_FILTERS, query: "75,000" }).map((c) => c.id)).toEqual([
      "num1",
    ]);
    expect(applyFilters(report, { ...NO_FILTERS, query: "quarterly" }).map((c) => c.id)).toEqual([
      "text1",
    ]);
    // Searching a label finds the change even when the wording differs.
    expect(applyFilters(report, { ...NO_FILTERS, query: "delivery" }).map((c) => c.id)).toEqual([
      "date1",
    ]);
    expect(applyFilters(report, { ...NO_FILTERS, query: "nothing here" })).toEqual([]);
  });

  it("hides minor differences unless they are asked for", () => {
    expect(applyFilters(report, NO_FILTERS).some((c) => c.isNoise)).toBe(false);
    const withMinor = applyFilters(report, { ...NO_FILTERS, includeMinor: true });
    expect(withMinor.map((c) => c.id)).toContain("minor1");
  });

  it("returns changes in document order so the list reads like the document", () => {
    const pages = applyFilters(report, { ...NO_FILTERS, includeMinor: true }).map(
      (c) => primaryPage(c)?.page,
    );
    expect(pages).toEqual([...pages].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("toggles a selection off when the same element is clicked again", () => {
    expect(toggle(["values"], "values")).toEqual([]);
    expect(toggle([], "values")).toEqual(["values"]);
    expect(toggle(["values"], "dates")).toEqual(["values", "dates"]);
  });
});

// ---------------------------------------------------------------- integrity

describe("the report never invents anything", () => {
  it("passes engine values through untouched", () => {
    const original = change({ oldValue: "50,000", newValue: "75,000", delta: "+25,000 (+50%)" });
    const [shown] = applyFilters(buildReport(result([original])), NO_FILTERS);
    expect(shown.oldValue).toBe("50,000");
    expect(shown.newValue).toBe("75,000");
    expect(shown.delta).toBe("+25,000 (+50%)");
  });

  it("keeps every change's evidence intact", () => {
    const [shown] = applyFilters(buildReport(result([change()])), NO_FILTERS);
    expect(shown.evidence).toHaveLength(2);
    expect(shown.evidence.every((item) => item.page !== null && item.excerpt)).toBe(true);
  });

  it("never adds a change that was not in the result", () => {
    const report = buildReport(result([change({ id: "only" })]));
    expect([...report.changes, ...report.minor].map((c) => c.id)).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------- page grouping

describe("whole pages that were added or removed", () => {
  const pageAdded = change({
    id: "page3",
    seq: 0,
    type: "PAGE_ADDED",
    kind: "added",
    oldValue: null,
    newValue: "Page 3",
    oldPages: [],
    newPages: [3],
    evidence: [{ side: "new", page: 3, excerpt: "Annexure A", bbox: null, wordCount: 2 }],
  });

  const textOnNewPage = (id: string, seq: number, text: string): Change =>
    change({
      id,
      seq,
      type: "TEXT_ADDED",
      kind: "added",
      oldValue: null,
      newValue: text,
      oldPages: [],
      newPages: [3],
      evidence: [{ side: "new", page: 3, excerpt: text, bbox: null, wordCount: 4 }],
    });

  const newPageSet = [
    pageAdded,
    textOnNewPage("t1", 1, "Schedule of deliverables"),
    textOnNewPage("t2", 2, "Acceptance testing shall complete within 30 days"),
    textOnNewPage("t3", 3, "Payment milestones are defined below"),
  ];

  function itemsFor(changes: Change[], filters = NO_FILTERS) {
    const report = buildReport(result(changes));
    return groupIntoItems(applyFilters(report, filters));
  }

  it("shows one page card instead of a card per fragment", () => {
    const items = itemsFor(newPageSet);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("page-group");
  });

  it("keeps every underlying change inside the group", () => {
    const [item] = itemsFor(newPageSet);
    expect(item.type).toBe("page-group");
    if (item.type !== "page-group") return;
    expect(item.members.map((m) => m.id)).toEqual(["t1", "t2", "t3"]);
    expect(item.anchor.id).toBe("page3");
    expect(changesIn(item).map((c) => c.id)).toEqual(["page3", "t1", "t2", "t3"]);
  });

  it("keeps each member's evidence intact and traceable", () => {
    const [item] = itemsFor(newPageSet);
    if (item.type !== "page-group") throw new Error("expected a page group");
    for (const member of item.members) {
      expect(member.evidence.length).toBeGreaterThan(0);
      expect(member.evidence[0].page).toBe(3);
      expect(member.evidence[0].excerpt).toBeTruthy();
    }
  });

  it("describes the page in plain language, without inventing importance", () => {
    const [item] = itemsFor(newPageSet);
    if (item.type !== "page-group") throw new Error("expected a page group");
    expect(pageGroupHeadline(item)).toBe("Page 3 — new page added");
    expect(pageGroupSummary(item)).toContain("All of its content is new");
    expect(pageGroupHeadline(item)).not.toMatch(/_|critical|high|important/i);
  });

  it("does not change the summary counts", () => {
    const report = buildReport(result(newPageSet));
    // Four records were detected, and four are counted. Grouping is presentation.
    expect(report.totalMeaningful).toBe(4);
    const counts = Object.fromEntries(report.categories.map((c) => [c.id, c.count]));
    expect(counts).toEqual({ content: 3, values: 0, dates: 0, pages: 1 });
  });

  it("does not double-count a grouped page in the page map", () => {
    const report = buildReport(result(newPageSet));
    const page3 = report.pages.find((bucket) => bucket.page === 3);
    expect(page3?.count).toBe(4);
    expect(report.pagesAffected).toBe(1);
  });

  it("groups a removed page the same way, from the previous document", () => {
    const removed = [
      change({
        id: "gone",
        seq: 0,
        type: "PAGE_REMOVED",
        kind: "removed",
        oldValue: "Page 7",
        newValue: null,
        oldPages: [7],
        newPages: [],
        evidence: [{ side: "old", page: 7, excerpt: "Appendix B", bbox: null, wordCount: 2 }],
      }),
      change({
        id: "gone-text",
        seq: 1,
        type: "TEXT_REMOVED",
        kind: "removed",
        oldValue: "This appendix is withdrawn",
        newValue: null,
        oldPages: [7],
        newPages: [],
        evidence: [
          { side: "old", page: 7, excerpt: "This appendix is withdrawn", bbox: null, wordCount: 4 },
        ],
      }),
    ];
    const [item] = itemsFor(removed);
    if (item.type !== "page-group") throw new Error("expected a page group");
    expect(item.side).toBe("old");
    expect(pageGroupHeadline(item)).toBe("Page 7 — page removed");
    expect(item.members.map((m) => m.id)).toEqual(["gone-text"]);
  });

  it("leaves a page that was merely edited as individual changes", () => {
    const edited = [
      change({ id: "a", seq: 0, newPages: [5], oldPages: [5] }),
      change({ id: "b", seq: 1, type: "NUMBER_CHANGED", newPages: [5], oldPages: [5] }),
    ];
    const items = itemsFor(edited);
    expect(items.map((item) => item.type)).toEqual(["change", "change"]);
  });

  it("does not absorb an edit that happens to sit on an added page", () => {
    // A modification is not part of "this page is new"; only additions are.
    const mixed = [
      ...newPageSet,
      change({ id: "edit", seq: 4, kind: "modified", newPages: [3], oldPages: [3] }),
    ];
    const items = itemsFor(mixed);
    expect(items.map((item) => item.type)).toEqual(["page-group", "change"]);
  });

  it("does not group changes from a different page", () => {
    const items = itemsFor([
      ...newPageSet,
      change({
        id: "elsewhere",
        seq: 5,
        type: "TEXT_ADDED",
        kind: "added",
        oldValue: null,
        newValue: "A sentence on another page",
        oldPages: [],
        newPages: [9],
      }),
    ]);
    expect(items).toHaveLength(2);
    const group = items.find((item) => item.type === "page-group");
    if (group?.type !== "page-group") throw new Error("expected a page group");
    expect(group.members.map((m) => m.id)).not.toContain("elsewhere");
  });

  it("never nests one page inside another", () => {
    const items = itemsFor([
      pageAdded,
      change({
        id: "page4",
        seq: 4,
        type: "PAGE_ADDED",
        kind: "added",
        oldValue: null,
        newValue: "Page 4",
        oldPages: [],
        newPages: [4],
      }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type === "page-group")).toBe(true);
  });

  it("shows a page's text as ordinary cards when the page record is filtered out", () => {
    // Filtering to Content excludes the page record, so its text stands alone
    // rather than vanishing with the group.
    const items = itemsFor(newPageSet, { ...NO_FILTERS, categories: ["content"] });
    expect(items.map((item) => item.type)).toEqual(["change", "change", "change"]);
  });

  it("keeps a group when a search matches only text inside it", () => {
    const items = itemsFor(newPageSet, { ...NO_FILTERS, query: "acceptance testing" });
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item.type !== "page-group") throw new Error("expected a page group");
    expect(item.members.map((m) => m.id)).toEqual(["t2"]);
  });

  it("finds a page group by searching its own text", () => {
    const items = itemsFor(newPageSet, { ...NO_FILTERS, query: "annexure" });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("page-group");
  });

  it("takes a page-map click to the page-level result", () => {
    const items = itemsFor(newPageSet, { ...NO_FILTERS, pages: [3] });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("page-group");
  });

  it("changes nothing when no page was added or removed", () => {
    const ordinary = [change({ id: "a", seq: 0 }), change({ id: "b", seq: 1 })];
    expect(groupIntoItems(ordinary).map((item) => item.key)).toEqual(["a", "b"]);
  });
});

describe("in the comparison workspace", () => {
  it("numbers meaningful changes first, in document order, and keeps minor ones after them", () => {
    const items = toWorkspaceChanges(
      result([
        change({ id: "late", seq: 0, oldPages: [5], newPages: [5] }),
        change({ id: "noise", seq: 1, oldPages: [1], newPages: [1], isNoise: true, noiseReason: "Page number" }),
        change({ id: "early", seq: 2, oldPages: [2], newPages: [2] }),
      ]),
    );
    expect(items.map((item) => [item.id, item.number, Boolean(item.minor)])).toEqual([
      ["early", 1, false],
      ["late", 2, false],
      ["noise", 3, true],
    ]);
  });

  it("places a change only on a page the engine recorded, and says which version when only the original has it", () => {
    const [moved, removed, unplaced] = toWorkspaceChanges(
      result([
        change({ id: "a", seq: 0, oldPages: [2], newPages: [3] }),
        change({ id: "b", seq: 1, kind: "removed", type: "TEXT_REMOVED", newValue: null, oldPages: [4], newPages: [] }),
        change({ id: "c", seq: 2, oldPages: [], newPages: [], evidence: [] }),
      ]),
    );
    expect([moved.place, moved.groupLabel]).toEqual(["Page 2 → 3", "Page 3"]);
    expect([removed.place, removed.groupLabel]).toEqual(["Page 4 (previous version)", "Page 4 (original)"]);
    expect([unplaced.place, unplaced.groupLabel]).toEqual(["Location not recorded", "No page recorded"]);
    expect(unplaced.tags?.page).toEqual([]);
  });

  it("shows values in full and long wording shortened, never altered", () => {
    const [value, words] = toWorkspaceChanges(
      result([
        change({ id: "v", type: "NUMBER_CHANGED", category: "number", oldValue: "627", newValue: "654", delta: "+27" }),
        change({ id: "w", seq: 1, oldValue: "x ".repeat(80).trim(), newValue: null, kind: "removed" }),
      ]),
    );
    expect([value.before, value.after, value.title, value.category]).toEqual(["627", "654", "Value changed", "Values"]);
    expect(words.before!.endsWith("…")).toBe(true);
    expect("x ".repeat(80)).toContain(words.before!.slice(0, -1));
  });

  it("offers filters only for what was found, with pages chosen from the page map", () => {
    const filters = workspaceFilters(
      toWorkspaceChanges(result([change(), change({ id: "d", seq: 1, type: "DATE_CHANGED", category: "date", newPages: [7], oldPages: [7] })])),
    );
    expect(filters.map((group) => [group.id, group.options.map((option) => option.id), group.inBar !== false])).toEqual([
      ["kind", ["changed"], true],
      ["category", ["content", "dates"], true],
      ["page", ["3", "7"], false],
    ]);
  });
});
