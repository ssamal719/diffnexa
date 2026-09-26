/**
 * The example guides, linked page turning and the exports for PDF, Excel and
 * the web monitoring tools.
 *
 * The guide shown with each example says what was changed between the two
 * versions. These tests hold every figure it mentions to the engine's real
 * output for that example, so the guide can never describe a change the
 * comparison does not show.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXAMPLE_FILES, EXAMPLE_GUIDES, type ExampleTool } from "@/lib/examples";
import { toCsv } from "@/lib/export";
import { counterpartPage } from "@/lib/pdf-links";
import { excelExportReport, pdfExportReport, webExportReport } from "@/lib/tool-exports";
import type { WebChange } from "@/lib/web-report";

const FIXTURES = join(import.meta.dirname, "fixtures");
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const RESULTS: Record<ExampleTool, { changes: { oldValue: string | null; newValue: string | null; label?: string | null; evidence: { excerpt?: string | null }[] }[] }> = {
  pdf: read("examples/pdf.json"),
  docx: read("docx-example.json"),
  excel: read("examples/excel.json"),
  web: read("examples/web.json"),
  policy: read("examples/policy.json"),
  competitor: read("examples/competitor.json"),
  price: read("examples/price.json"),
};

/** Figures, dates and quoted words in a sentence: "627", "$15", "30 September 2026", "“Try Northwind free”". */
function claims(sentence: string): string[] {
  const found = [
    ...(sentence.match(/\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December)(?: \d{4})?/g) ?? []),
    ...(sentence.match(/\d{1,2} (?:Oct|Nov) \d{4}/g) ?? []),
    ...(sentence.match(/[£$]?\d[\d,.]*/g) ?? []).filter((value) => !/^\d{4}$/.test(value) && value.length > 1),
    ...[...sentence.matchAll(/“([^”]+)”/g)].map((match) => match[1]),
  ];
  return [...new Set(found)];
}

describe("the example guides", () => {
  it.each(Object.keys(EXAMPLE_GUIDES) as ExampleTool[])("%s mentions only figures its example's comparison shows", (tool) => {
    const text = JSON.stringify(RESULTS[tool]);
    const guide = EXAMPLE_GUIDES[tool];
    expect(guide.steps.length).toBeGreaterThanOrEqual(3);
    expect(guide.changed.length).toBeGreaterThanOrEqual(3);
    let checked = 0;
    for (const sentence of guide.changed) {
      for (const claim of claims(sentence)) {
        expect(text, `${tool}: “${claim}” from “${sentence}”`).toContain(claim.replace(/[.,]$/, ""));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  it("names every example file as an example", () => {
    for (const pair of Object.values(EXAMPLE_FILES)) {
      for (const file of [pair.original, pair.revised]) {
        expect(file.name.startsWith("Example - ")).toBe(true);
        expect(file.url.startsWith("/examples/")).toBe(true);
      }
    }
  });
});

describe("linked page turning", () => {
  const INSERTED = [
    { previous: 1, revised: 1 },
    { previous: null, revised: 2 },
    { previous: 2, revised: 3 },
    { previous: 3, revised: null },
  ];

  it("turns to the page the comparison paired", () => {
    expect(counterpartPage(INSERTED, "original", 2, 3)).toBe(3);
    expect(counterpartPage(INSERTED, "revised", 3, 3)).toBe(2);
  });

  it("stays on the nearest paired page across a page only one version has", () => {
    expect(counterpartPage(INSERTED, "revised", 2, 3)).toBe(1);
    expect(counterpartPage(INSERTED, "original", 3, 3)).toBe(3);
  });

  it("matches page N with page N when the result has no pairs, within the other version's pages", () => {
    expect(counterpartPage(undefined, "original", 2, 5)).toBe(2);
    expect(counterpartPage([], "revised", 7, 5)).toBe(5);
  });
});

describe("exports", () => {
  it("PDF: one row per meaningful change, with its pages and both quotations", () => {
    const result = read("examples/pdf.json");
    const report = pdfExportReport(result, { name: "a.pdf" }, { name: "b.pdf" }, new Date("2026-09-01"));
    expect(report.rows).toHaveLength(result.counts.meaningful);
    const vacancies = report.rows.find((row) => row.before === "627")!;
    expect(vacancies.after).toBe("654");
    expect(vacancies.originalWhere).toBe("Page 2");
    expect(vacancies.revisedEvidence).toContain("654");
    expect(report.facts.find((fact) => fact.label === "Matching")?.value).toBe("capitalisation ignored · punctuation compared");
  });

  it("PDF: minor differences are counted in a note, not listed", () => {
    const result = read("examples/pdf.json");
    const withMinor = {
      ...result,
      changes: [...result.changes, { ...result.changes[0], id: "minor", seq: 99, isNoise: true, noiseReason: "page number" }],
    };
    const report = pdfExportReport(withMinor, { name: "a.pdf" }, { name: "b.pdf" });
    expect(report.rows).toHaveLength(result.counts.meaningful);
    expect(report.notes[0]).toMatch(/^1 minor difference/);
  });

  it("Excel: every change with its sheet and cell in each workbook", () => {
    const result = read("examples/excel.json");
    const report = excelExportReport(result, { name: "a.xlsx" }, { name: "b.xlsx" });
    expect(report.rows).toHaveLength(result.changes.length);
    const price = report.rows.find((row) => row.before === "$299.00")!;
    expect(price.originalWhere).toBe("Pricing · B3");
    expect(price.revisedWhere).toBe("Pricing · B3");
    expect(price.change).toContain("Number changed");
    const moved = report.rows.find((row) => row.before === "15 Oct 2026")!;
    expect(moved.originalWhere).toBe("Pricing · F4");
    expect(moved.revisedWhere).toBe("Pricing · F5");
  });

  it("web tools: the tool's own label is added to each change, and set-aside differences are counted", () => {
    const result = read("examples/policy.json") as { changes: (WebChange & { policyTopics?: { label: string }[] })[] };
    const report = webExportReport(
      "Policy and Terms Monitor",
      result,
      { url: "https://example.com/terms", baseline: "1 January 2026" },
      (change) => (change as WebChange & { policyTopics?: { label: string }[] }).policyTopics?.map((topic) => topic.label).join(", ") || null,
    );
    expect(report.rows).toHaveLength(result.changes.filter((change) => !change.isNoise).length);
    expect(report.rows.find((row) => row.before === "14")?.group).toContain("Refunds");
    expect(report.notes[0]).toMatch(/^1 unimportant difference/);
    expect(toCsv(report)).toContain("Governing law");
  });
});
