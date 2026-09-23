/**
 * Price Monitor's presentation layer: baselines, labels and grouping.
 *
 * The promises: a baseline from any of the webpage tools is accepted; the
 * labels the person chose travel in their file and nowhere else; and grouping
 * by category is a partition — every change lands in exactly one group, and
 * "Other Changes" keeps everything that is not about pricing.
 */

import { describe, expect, it } from "vitest";

import {
  NO_CHANGES_SENTENCE,
  PAGE_TYPES,
  PRICE_ERRORS,
  baselineFilename,
  buildBaselineFile,
  cleanProductName,
  fallbackProductName,
  groupByCategory,
  headline,
  pageTypeLabel,
  readBaselineFile,
  type PriceChange,
  type PriceComparison,
} from "@/lib/price-report";

const SNAPSHOT = {
  schema_version: "1",
  source: {
    url: "https://tasklane.example.com/pricing",
    final_url: "https://tasklane.example.com/pricing",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Pricing — Tasklane" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

describe("page types", () => {
  it("are exactly the agreed six", () => {
    expect(PAGE_TYPES.map((type) => type.label)).toEqual([
      "Product",
      "Subscription Plan",
      "SaaS Pricing",
      "Service Pricing",
      "Pricing Table",
      "Other",
    ]);
  });

  it("fall back to Other for an unknown label", () => {
    expect(pageTypeLabel("saas_pricing")).toBe("SaaS Pricing");
    expect(pageTypeLabel("nonsense")).toBe("Other");
  });
});

describe("the baseline file", () => {
  it("wraps the unchanged capture with the person's labels, not a new snapshot format", () => {
    const file = buildBaselineFile(SNAPSHOT, "  GitHub   Copilot ", "subscription_plan");
    expect(file).toMatchObject({
      diffnexa: "price-baseline",
      version: 1,
      product: "GitHub Copilot",
      pageType: "subscription_plan",
      capturedAt: "2026-03-12T09:30:00+00:00",
      url: "https://tasklane.example.com/pricing",
    });
    expect(file.snapshot).toBe(SNAPSHOT);
  });

  it("is named for the product, page type and day, as a .diffnexa-snapshot.json", () => {
    const file = buildBaselineFile(SNAPSHOT, "GitHub Copilot", "subscription_plan");
    expect(baselineFilename(file)).toBe(
      "github-copilot-subscription-plan-2026-03-12.diffnexa-snapshot.json",
    );
  });

  it("never lets a name put a path or odd characters in the filename", () => {
    const name = baselineFilename(buildBaselineFile(SNAPSHOT, "../../etc/<b>Pro</b>", "product"));
    expect(name).toMatch(/^[a-z0-9-]+-product-2026-03-12\.diffnexa-snapshot\.json$/);
  });

  it("limits the length of a product name", () => {
    expect(cleanProductName("x".repeat(500))).toHaveLength(80);
  });

  it("round-trips: the downloaded file reads back to the same capture and labels", () => {
    const read = readBaselineFile(JSON.stringify(buildBaselineFile(SNAPSHOT, "Copilot", "saas_pricing")));
    expect(read).toEqual({
      ok: true,
      snapshot: SNAPSHOT,
      product: "Copilot",
      pageType: "saas_pricing",
      url: "https://tasklane.example.com/pricing",
      capturedAt: "2026-03-12T09:30:00+00:00",
    });
  });

  it.each(["competitor-baseline", "policy-baseline"])("accepts a %s, taking only its capture", (kind) => {
    const other = { diffnexa: kind, version: 1, competitor: "Acme", pageType: "pricing", url: SNAPSHOT.source.final_url, snapshot: SNAPSHOT };
    const read = readBaselineFile(JSON.stringify(other));
    expect(read.ok && read.snapshot).toEqual(SNAPSHOT);
    expect(read.ok && read.product).toBeNull();
    expect(read.ok && read.pageType).toBeNull();
  });

  it("accepts a plain Website Change Detector capture", () => {
    const read = readBaselineFile(JSON.stringify(SNAPSHOT));
    expect(read.ok && read.snapshot).toEqual(SNAPSHOT);
  });

  it.each([["not json"], ["[]"], ["{}"], ['{"diffnexa":"price-baseline"}'], ["null"]])(
    "refuses %s with a plain message",
    (text) => {
      const read = readBaselineFile(text);
      expect(read.ok).toBe(false);
      expect(!read.ok && read.message).toContain(".diffnexa-snapshot.json");
    },
  );

  it("names a product from the address when the file has none", () => {
    expect(fallbackProductName("https://www.tasklane.example.com/pricing")).toBe("tasklane.example.com");
  });
});

const ORDER = [
  "price",
  "discount_sale",
  "original_price",
  "currency",
  "billing_period",
  "product_plan",
  "availability",
  "pricing_details",
  "other",
] as const;

function change(id: string, category: (typeof ORDER)[number] | null): PriceChange {
  return {
    id,
    seq: Number(id.slice(1)),
    type: "TEXT_MODIFIED",
    kind: "modified",
    category: "text",
    subtype: null,
    label: null,
    oldValue: "a",
    newValue: "b",
    delta: null,
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    sections: [],
    evidence: [],
    priceCategory: category
      ? { category, label: category, basis: "money", matchedText: "$1", reason: "x" }
      : null,
  };
}

function comparison(changes: PriceChange[]): PriceComparison {
  return {
    engineVersion: "test",
    processingMs: 1,
    documents: { previous: { sha256: "a" }, revised: { sha256: "b" } },
    counts: { total: changes.length, meaningful: changes.length, noise: 0 },
    changes,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
    price: {
      rulesVersion: "2026.09.1",
      categories: ORDER.map((id) => ({
        id,
        label: id,
        blurb: "",
        changeCount: changes.filter((c) => c.priceCategory?.category === id).length,
        changeIds: [],
      })),
      changedCategories: [],
    },
  };
}

describe("grouping by category", () => {
  it("puts every change in exactly one group, in the rules' order", () => {
    const changes = [change("c0", "other"), change("c1", "price"), change("c2", "other"), change("c3", "availability")];
    const groups = groupByCategory(comparison(changes), changes);
    expect(groups.map((group) => group.id)).toEqual(["price", "availability", "other"]);
    expect(groups.flatMap((group) => group.changes.map((c) => c.id)).sort()).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("puts a change with no category in Other Changes rather than dropping it", () => {
    const changes = [change("c0", null)];
    const groups = groupByCategory(comparison(changes), changes);
    expect(groups.map((group) => group.id)).toEqual(["other"]);
  });
});

describe("wording", () => {
  it("states the result without evaluating it", () => {
    expect(headline(0)).toBe("No changes found");
    expect(headline(1)).toBe("1 change found");
    expect(headline(3)).toBe("3 changes found");
    expect(NO_CHANGES_SENTENCE).toBe("This page says the same as it did when you captured your baseline.");
  });

  it("explains failures without calling a page damaged", () => {
    expect(PRICE_ERRORS.url_unreachable.title).toBe("Could not fetch this page");
    expect(PRICE_ERRORS.snapshot_mismatch.title).toBe("This baseline is for a different page");
    for (const explanation of Object.values(PRICE_ERRORS)) {
      expect(explanation.whatNext).not.toMatch(/damaged|corrupt/i);
    }
  });
});
