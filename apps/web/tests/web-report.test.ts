/**
 * The Website Change Detector report layer.
 *
 * These guard two promises: the interface shows only what the engine found, and
 * it says it in words a person actually uses. No internal name may reach the
 * screen, and no page concept may leak into a tool about web pages.
 */

import { describe, expect, it } from "vitest";

import {
  NO_WEB_FILTERS,
  WEB_CATEGORIES,
  applyWebFilters,
  baselineFilename,
  buildWebReport,
  categoryOf,
  checkUrl,
  describePage,
  editKindOf,
  formatCapturedAt,
  headlineFor,
  locationOf,
  sectionTree,
  summariseWeb,
  toggleValue,
  type Baseline,
  type WebChange,
  type WebComparison,
} from "@/lib/web-report";

function change(overrides: Partial<WebChange> = {}): WebChange {
  return {
    id: "c0",
    seq: 0,
    type: "TEXT_MODIFIED",
    kind: "modified",
    category: "text",
    subtype: null,
    label: null,
    oldValue: "within 30 days",
    newValue: "within 14 days",
    delta: null,
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    sections: ["Terms › Payment"],
    evidence: [
      { side: "old", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Terms", "Payment"], field: null, excerpt: "Payment is due within 30 days." },
      { side: "new", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Terms", "Payment"], field: null, excerpt: "Payment is due within 14 days." },
    ],
    ...overrides,
  };
}

function comparison(changes: WebChange[]): WebComparison {
  return {
    engineVersion: "test",
    processingMs: 900,
    documents: {
      previous: { url: "https://example.com/terms", sha256: "a".repeat(64), nodeCount: 9 },
      revised: { url: "https://example.com/terms", sha256: "b".repeat(64), nodeCount: 9 },
    },
    counts: {
      total: changes.length,
      meaningful: changes.filter((c) => !c.isNoise).length,
      noise: changes.filter((c) => c.isNoise).length,
    },
    changes,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
  };
}

// ---------------------------------------------------------------- wording

describe("plain language", () => {
  it("never shows the engine's internal names", () => {
    const samples = [
      change({ category: "number", type: "NUMBER_CHANGED" }),
      change({ category: "date", type: "DATE_CHANGED" }),
      change({ category: "link", type: "LINK_CHANGED" }),
      change({ category: "metadata", subtype: "title" }),
      change({ subtype: "heading" }),
      change({ category: "table", subtype: "row", kind: "added" }),
    ];
    for (const sample of samples) {
      expect(headlineFor(sample)).not.toMatch(/_/);
      expect(headlineFor(sample)).not.toMatch(/[A-Z]{4,}/);
    }
  });

  it("uses no PDF vocabulary anywhere", () => {
    const words = [
      ...WEB_CATEGORIES.flatMap((c) => [c.label, c.blurb]),
      headlineFor(change()),
      summariseWeb(buildWebReport(comparison([change()]))),
    ].join(" ").toLowerCase();
    for (const banned of ["page number", "page map", "pdf", "bounding box"]) {
      expect(words).not.toContain(banned);
    }
  });

  it("names each kind of change the way a reader would", () => {
    expect(headlineFor(change({ category: "number" }))).toBe("Number changed");
    expect(headlineFor(change({ category: "date" }))).toBe("Date changed");
    expect(headlineFor(change({ category: "link" }))).toBe("Link now points elsewhere");
    expect(headlineFor(change({ subtype: "heading" }))).toBe("Heading renamed");
    expect(headlineFor(change({ subtype: "list_item", kind: "added" }))).toBe("List item added");
    expect(headlineFor(change({ subtype: "table_cell" }))).toBe("Table value changed");
    expect(headlineFor(change({ category: "table", subtype: "row", kind: "added" }))).toBe("Table row added");
    expect(headlineFor(change({ category: "metadata", subtype: "title" }))).toBe("Page title");
    expect(headlineFor(change({ category: "metadata", subtype: "meta_description" }))).toBe("Page description");
  });

  it("describes where a change is by its section", () => {
    expect(locationOf(change())).toBe("Terms › Payment");
    expect(locationOf(change({ sections: [], category: "metadata", subtype: "title" }))).toBe("Whole page");
  });

  it("counts changes and sections in readable wording", () => {
    expect(summariseWeb(buildWebReport(comparison([])))).toBe("No changes found");
    expect(summariseWeb(buildWebReport(comparison([change()])))).toBe("1 change across 1 section");
    const two = buildWebReport(comparison([change(), change({ id: "c1", seq: 1, sections: ["FAQ"] })]));
    expect(summariseWeb(two)).toBe("2 changes across 2 sections");
  });
});

// ---------------------------------------------------------------- categories

describe("categories", () => {
  it("sorts every change into a website-native group", () => {
    expect(categoryOf(change({ category: "number" }))).toBe("values");
    expect(categoryOf(change({ category: "date" }))).toBe("dates");
    expect(categoryOf(change({ category: "link" }))).toBe("links");
    expect(categoryOf(change({ category: "metadata" }))).toBe("details");
    expect(categoryOf(change({ subtype: "table_cell", category: "number" }))).toBe("tables");
    expect(categoryOf(change({ category: "table", subtype: "row" }))).toBe("tables");
    expect(categoryOf(change())).toBe("content");
  });

  it("calls a modification 'changed'", () => {
    expect(editKindOf(change({ kind: "modified" }))).toBe("changed");
  });

  it("counts each category", () => {
    const report = buildWebReport(
      comparison([
        change({ id: "a", seq: 0, category: "number" }),
        change({ id: "b", seq: 1, category: "date" }),
        change({ id: "c", seq: 2, category: "link" }),
        change({ id: "d", seq: 3 }),
      ]),
    );
    const counts = Object.fromEntries(report.categories.map((c) => [c.id, c.count]));
    expect(counts).toEqual({ content: 1, values: 1, dates: 1, tables: 0, links: 1, details: 0 });
  });
});

// ---------------------------------------------------------------- sections

describe("the section map", () => {
  it("builds the page's heading hierarchy", () => {
    const tree = sectionTree([
      change({ id: "a", sections: ["Pricing › Starter"] }),
      change({ id: "b", sections: ["Pricing › Enterprise"] }),
      change({ id: "c", sections: ["FAQ"] }),
    ]);
    expect(tree.map((node) => node.name)).toEqual(["FAQ", "Pricing"]);
    const pricing = tree.find((node) => node.name === "Pricing")!;
    expect(pricing.children.map((child) => child.name)).toEqual(["Enterprise", "Starter"]);
  });

  it("rolls child counts up into the parent", () => {
    const tree = sectionTree([
      change({ id: "a", sections: ["Pricing › Starter"] }),
      change({ id: "b", sections: ["Pricing › Starter"] }),
      change({ id: "c", sections: ["Pricing › Enterprise"] }),
    ]);
    const pricing = tree[0];
    expect(pricing.count).toBe(3);
    expect(pricing.children.find((c) => c.name === "Starter")!.count).toBe(2);
  });

  it("is empty when nothing has a section", () => {
    expect(sectionTree([change({ sections: [] })])).toEqual([]);
  });
});

// ---------------------------------------------------------------- filters

describe("filters and search", () => {
  const report = buildWebReport(
    comparison([
      change({ id: "text", seq: 0, sections: ["Terms › Payment"] }),
      change({
        id: "price", seq: 1, category: "number", oldValue: "50,000", newValue: "75,000",
        delta: "+25000 (+50%)", sections: ["Pricing › Enterprise"], label: "Pricing",
        evidence: [
          { side: "old", scope: "node", nodeId: "n7", path: "main > p", sectionPath: ["Pricing", "Enterprise"], field: null, excerpt: "The plan costs 50,000 a year." },
          { side: "new", scope: "node", nodeId: "n7", path: "main > p", sectionPath: ["Pricing", "Enterprise"], field: null, excerpt: "The plan costs 75,000 a year." },
        ],
      }),
      change({
        id: "link", seq: 2, category: "link", kind: "modified",
        oldValue: "https://example.com/a", newValue: "https://example.com/b", sections: ["Resources"],
        evidence: [
          { side: "old", scope: "node", nodeId: "n9", path: "main > a", sectionPath: ["Resources"], field: null, excerpt: "the guide" },
          { side: "new", scope: "node", nodeId: "n9", path: "main > a", sectionPath: ["Resources"], field: null, excerpt: "the guide" },
        ],
      }),
      change({ id: "minor", seq: 3, isNoise: true, noiseReason: "A view counter", sections: ["Terms"] }),
    ]),
  );

  it("shows meaningful changes by default", () => {
    expect(applyWebFilters(report, NO_WEB_FILTERS).map((c) => c.id)).toEqual(["text", "price", "link"]);
  });

  it("narrows by category", () => {
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, categories: ["values"] }).map((c) => c.id)).toEqual(["price"]);
  });

  it("narrows by section, including everything beneath a parent", () => {
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, sections: ["Pricing"] }).map((c) => c.id)).toEqual(["price"]);
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, sections: ["Pricing › Enterprise"] }).map((c) => c.id)).toEqual(["price"]);
  });

  it("searches values, sections and evidence", () => {
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, query: "75,000" }).map((c) => c.id)).toEqual(["price"]);
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, query: "resources" }).map((c) => c.id)).toEqual(["link"]);
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, query: "Payment is due" }).map((c) => c.id)).toEqual(["text"]);
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, query: "nothing here" })).toEqual([]);
  });

  it("hides unimportant differences unless asked for", () => {
    expect(applyWebFilters(report, NO_WEB_FILTERS).some((c) => c.isNoise)).toBe(false);
    expect(applyWebFilters(report, { ...NO_WEB_FILTERS, includeMinor: true }).map((c) => c.id)).toContain("minor");
  });

  it("toggles a selection off when chosen again", () => {
    expect(toggleValue(["values"], "values")).toEqual([]);
    expect(toggleValue([], "values")).toEqual(["values"]);
  });
});

// ---------------------------------------------------------------- addresses

describe("checking an address before asking the server", () => {
  it("accepts an ordinary address and adds the scheme", () => {
    const result = checkUrl("example.com/pricing");
    expect(result).toEqual({ ok: true, url: "https://example.com/pricing" });
  });

  it("keeps an address that already has a scheme", () => {
    expect(checkUrl("http://example.com/a")).toEqual({ ok: true, url: "http://example.com/a" });
  });

  it.each([
    ["", "Enter the address"],
    ["   ", "Enter the address"],
    ["not a url", "doesn't look like a web address"],
    ["ftp://example.com/x", "open in a web browser"],
    ["https://user:pass@example.com", "username and password"],
    ["http://localhost:3000/", "publicly on the internet"],
    ["http://127.0.0.1/", "publicly on the internet"],
    ["http://192.168.1.1/", "publicly on the internet"],
  ])("explains why %j cannot be used", (input, expected) => {
    const result = checkUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(expected);
      expect(result.message).not.toMatch(/SSRF|scheme|protocol|hostname/i);
    }
  });
});

// ---------------------------------------------------------------- baselines

describe("baselines", () => {
  const baseline: Baseline = {
    schema_version: "1",
    source: {
      url: "https://www.example.com/pricing",
      final_url: "https://www.example.com/pricing",
      fetched_at: "2026-03-12T09:30:00+00:00",
    },
    metadata: { title: "Pricing — Example" },
    nodes: [],
    content_sha256: "c".repeat(64),
  };

  it("names a page by its title", () => {
    expect(describePage(baseline)).toBe("Pricing — Example");
  });

  it("falls back to the address when there is no title", () => {
    expect(describePage({ ...baseline, metadata: { title: null } })).toBe("www.example.com/pricing");
  });

  it("suggests a filename a person can recognise", () => {
    expect(baselineFilename(baseline)).toBe("example.com-2026-03-12.diffnexa.json");
  });

  it("shows the capture time in readable form", () => {
    expect(formatCapturedAt("2026-03-12T09:30:00+00:00")).toMatch(/2026/);
    expect(formatCapturedAt("not a date")).toBe("not a date");
  });
});
