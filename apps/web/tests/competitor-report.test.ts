/**
 * Competitor Monitor's presentation layer: baselines, labels and grouping.
 *
 * The promises: a baseline from any of the three webpage tools is accepted; the
 * labels the person chose travel in their file and nowhere else; and grouping
 * by signal is a partition — every change lands in exactly one group.
 */

import { describe, expect, it } from "vitest";

import {
  COMPETITOR_ERRORS,
  NO_CHANGES_SENTENCE,
  PAGE_TYPES,
  baselineFilename,
  buildBaselineFile,
  cleanCompetitorName,
  fallbackCompetitorName,
  groupBySignal,
  headline,
  pageTypeLabel,
  readBaselineFile,
  type CompetitorChange,
  type CompetitorComparison,
} from "@/lib/competitor-report";

const SNAPSHOT = {
  schema_version: "1",
  source: {
    url: "https://acme.example.com/pricing",
    final_url: "https://acme.example.com/pricing",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Acme Pricing" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

describe("page types", () => {
  it("are exactly the agreed eight", () => {
    expect(PAGE_TYPES.map((type) => type.label)).toEqual([
      "Homepage",
      "Pricing",
      "Product",
      "Features",
      "Plans",
      "Changelog",
      "Documentation",
      "Other",
    ]);
  });

  it("fall back to Other for an unknown label", () => {
    expect(pageTypeLabel("pricing")).toBe("Pricing");
    expect(pageTypeLabel("nonsense")).toBe("Other");
    expect(pageTypeLabel(null)).toBe("Other");
  });
});

describe("the baseline file", () => {
  it("wraps the capture untouched with the person's labels", () => {
    const file = buildBaselineFile(SNAPSHOT, "  Acme   Corp ", "pricing");
    expect(file).toMatchObject({
      diffnexa: "competitor-baseline",
      version: 1,
      competitor: "Acme Corp",
      pageType: "pricing",
      capturedAt: "2026-03-12T09:30:00+00:00",
      url: "https://acme.example.com/pricing",
      title: "Acme Pricing",
    });
    expect(file.snapshot).toBe(SNAPSHOT);
  });

  it("is named for the competitor, the page type and the day, as a .diffnexa-snapshot.json", () => {
    const file = buildBaselineFile(SNAPSHOT, "Acme Corp", "pricing");
    expect(baselineFilename(file)).toBe("acme-corp-pricing-2026-03-12.diffnexa-snapshot.json");
  });

  it("never lets a name put a path or odd characters in the filename", () => {
    const file = buildBaselineFile(SNAPSHOT, "../../etc/Ác̈me <script>", "pricing");
    const name = baselineFilename(file);
    expect(name).toMatch(/^[a-z0-9-]+-pricing-2026-03-12\.diffnexa-snapshot\.json$/);
    expect(name).not.toContain("/");
  });

  it("limits the length of a competitor's name", () => {
    expect(cleanCompetitorName("x".repeat(500))).toHaveLength(80);
  });

  it("reads back its own file with the labels", () => {
    const read = readBaselineFile(JSON.stringify(buildBaselineFile(SNAPSHOT, "Acme", "changelog")));
    expect(read).toEqual({
      ok: true,
      snapshot: SNAPSHOT,
      competitor: "Acme",
      pageType: "changelog",
      url: "https://acme.example.com/pricing",
      capturedAt: "2026-03-12T09:30:00+00:00",
    });
  });

  it("accepts a Website Change Detector capture", () => {
    const read = readBaselineFile(JSON.stringify(SNAPSHOT));
    expect(read.ok && read.snapshot).toEqual(SNAPSHOT);
    expect(read.ok && read.competitor).toBeNull();
  });

  it("accepts a Policy Monitor baseline, without taking its policy type as a page type", () => {
    const policy = {
      diffnexa: "policy-baseline",
      version: 1,
      policyType: "privacy_policy",
      capturedAt: SNAPSHOT.source.fetched_at,
      url: SNAPSHOT.source.final_url,
      title: null,
      snapshot: SNAPSHOT,
    };
    const read = readBaselineFile(JSON.stringify(policy));
    expect(read.ok && read.snapshot).toEqual(SNAPSHOT);
    expect(read.ok && read.pageType).toBeNull();
  });

  it("ignores a page type it does not know", () => {
    const file = { ...buildBaselineFile(SNAPSHOT, "Acme", "pricing"), pageType: "<b>odd</b>" };
    const read = readBaselineFile(JSON.stringify(file));
    expect(read.ok && read.pageType).toBeNull();
  });

  it.each([["not json"], ["[]"], ["{}"], ['{"diffnexa":"competitor-baseline"}'], ["null"]])(
    "refuses %s with a plain message",
    (text) => {
      const read = readBaselineFile(text);
      expect(read.ok).toBe(false);
      expect(!read.ok && read.message).toContain(".diffnexa-snapshot.json");
    },
  );

  it("names a competitor from the address when the file has none", () => {
    expect(fallbackCompetitorName("https://www.acme.example.com/pricing")).toBe("acme.example.com");
  });
});

function change(id: string, signal: string | null): CompetitorChange {
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
    competitorSignal: signal
      ? {
          signal: signal as never,
          label: signal,
          basis: "section",
          matchedText: "x",
          reason: "it sits in the section “x”",
          summary: `Touches ${signal}`,
        }
      : null,
  };
}

const ORDER = [
  "pricing_commercial",
  "product_features",
  "messaging_positioning",
  "plans_packaging",
  "calls_to_action",
  "content_sections",
  "links_destinations",
  "seo_metadata",
  "other",
] as const;

function comparison(changes: CompetitorChange[]): CompetitorComparison {
  return {
    engineVersion: "test",
    processingMs: 1,
    documents: { previous: { sha256: "a" }, revised: { sha256: "b" } },
    counts: { total: changes.length, meaningful: changes.length, noise: 0 },
    changes,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
    competitor: {
      signalsVersion: "2026.09.1",
      signals: ORDER.map((id) => ({
        id,
        label: id,
        blurb: "",
        changeCount: changes.filter((c) => c.competitorSignal?.signal === id).length,
        changeIds: [],
      })),
      changedSignals: [],
    },
  };
}

describe("grouping by signal", () => {
  it("puts every change in exactly one group, in the taxonomy's order", () => {
    const changes = [
      change("c0", "links_destinations"),
      change("c1", "pricing_commercial"),
      change("c2", "links_destinations"),
      change("c3", "seo_metadata"),
    ];
    const groups = groupBySignal(comparison(changes), changes);
    expect(groups.map((group) => group.id)).toEqual([
      "pricing_commercial",
      "links_destinations",
      "seo_metadata",
    ]);
    const ids = groups.flatMap((group) => group.changes.map((c) => c.id)).sort();
    expect(ids).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("puts a change with no signal in Other rather than dropping it", () => {
    const changes = [change("c0", null)];
    const groups = groupBySignal(comparison(changes), changes);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("other");
    expect(groups[0].changes[0].id).toBe("c0");
  });
});

describe("wording", () => {
  it("says no changes were found without claiming the competitor changed nothing", () => {
    expect(headline(0)).toBe("No changes found");
    expect(NO_CHANGES_SENTENCE).toBe(
      "This page says the same as it did when you captured your baseline.",
    );
    expect(NO_CHANGES_SENTENCE.toLowerCase()).not.toContain("competitor has not changed");
    expect(headline(1)).toBe("1 change found");
    expect(headline(3)).toBe("3 changes found");
  });

  it("covers every failure the spec names", () => {
    expect(COMPETITOR_ERRORS.url_unreachable.title).toBe("Could not fetch this page");
    expect(COMPETITOR_ERRORS.url_not_allowed.title).toMatch(/can't be checked/);
    expect(COMPETITOR_ERRORS.snapshot_unreadable.title).toBe("That file isn't a valid baseline");
    expect(COMPETITOR_ERRORS.snapshot_mismatch.title).toBe("This baseline is for a different page");
    for (const explanation of Object.values(COMPETITOR_ERRORS)) {
      expect(explanation.whatNext).not.toMatch(/damaged|corrupt/i);
    }
  });
});
