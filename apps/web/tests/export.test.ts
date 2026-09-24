/**
 * Export files: what they contain and that they are safe to open.
 */

import { describe, expect, it } from "vitest";

import { exportName, toCsv, toHtml, toText, type ExportReport, type ExportRow } from "@/lib/export";

function row(fields: Partial<ExportRow>): ExportRow {
  return {
    number: 1,
    change: "Number changed",
    group: "Numbers",
    originalWhere: "Page 3 · Paragraph 12",
    revisedWhere: "Page 3 · Paragraph 12",
    before: "627",
    after: "654",
    difference: "+27",
    originalEvidence: "Total vacancies: 627",
    revisedEvidence: "Total vacancies: 654",
    ...fields,
  };
}

function report(rows: ExportRow[]): ExportReport {
  return {
    tool: "DiffNexa DOCX Compare",
    title: "Comparison: a.docx → b.docx",
    generatedAt: new Date("2026-09-01T10:00:00Z"),
    facts: [{ label: "Changes", value: String(rows.length) }],
    notes: ["Page numbers: as Word laid them out."],
    rows,
  };
}

describe("CSV", () => {
  it("has a header and one row per change, readable as UTF-8", () => {
    const csv = toCsv(report([row({}), row({ number: 2, before: "£2,500", after: "£2,750" })]));
    expect(csv.startsWith("﻿#,Change,Kind")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"£2,500"');
  });

  it("quotes commas, quotes and line breaks", () => {
    const csv = toCsv(report([row({ originalEvidence: 'He said "yes",\nthen left' })]));
    expect(csv).toContain('"He said ""yes"",\nthen left"');
  });

  it("never lets a spreadsheet run a cell as a formula, but leaves signed numbers alone", () => {
    const csv = toCsv(report([row({ before: "=HYPERLINK(\"x\")", after: "@SUM(A1)", difference: "+27", originalEvidence: "-3.5%", revisedEvidence: "+cmd" })]));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain(",+27,");
    expect(csv).toContain(",-3.5%,");
    expect(csv).toContain("'+cmd");
  });
});

describe("HTML", () => {
  it("escapes the document's words, so nothing in them runs", () => {
    const html = toHtml(report([row({ after: '<img src=x onerror="alert(1)">' })]));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toMatch(/<script/i);
  });

  it("is a complete page with every change, where it is and its evidence", () => {
    const html = toHtml(report([row({})]));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Page 3 · Paragraph 12");
    expect(html).toContain("<del>627</del>");
    expect(html).toContain("<ins>654</ins>");
    expect(html).toContain("AI explanations are not included");
  });

  it("says so when there are no changes", () => {
    expect(toHtml(report([]))).toContain("No changes were found.");
  });
});

describe("plain text", () => {
  it("lists every change with its values and evidence", () => {
    const text = toText(report([row({})]));
    expect(text).toContain("1. Number changed (Numbers)");
    expect(text).toContain("Before: 627");
    expect(text).toContain('Evidence (revised): "Total vacancies: 654"');
  });
});

describe("file names", () => {
  it("are made from the documents' names, safely", () => {
    expect(exportName(["Contract v1.docx", "Contract/v2?.docx"], "csv", new Date("2026-09-01T10:00:00Z"))).toBe(
      "DiffNexa - Contract v1 vs Contract v2 - 2026-09-01.csv",
    );
    expect(exportName([], "txt", new Date("2026-09-01T10:00:00Z"))).toBe("DiffNexa - comparison - 2026-09-01.txt");
  });
});
