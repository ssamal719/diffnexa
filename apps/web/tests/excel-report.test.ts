/**
 * Turning an Excel comparison into what the workspace shows.
 *
 * The fixture is real engine output for the "multiple-changes" golden pair: two
 * company workbooks saved by a spreadsheet application (see
 * tests/fixtures/excel-comparison.json). These check that every place is a
 * sheet and a cell, that nothing is lost or invented, and that highlighting
 * covers exactly the cells each change is about.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NO_CHANGES_NOTE,
  cellKey,
  columnLetters,
  columnNumber,
  counterpartSheet,
  detailCounts,
  headline,
  headlineFor,
  highlightMaps,
  locationFor,
  mappedRow,
  overview,
  parseRange,
  parseRef,
  placeFor,
  toWorkspaceChanges,
  type ExcelComparison,
} from "@/lib/excel-report";
import { checkXlsxBytes } from "@/lib/validation";

const RESULT: ExcelComparison = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"),
);

const byNumber = (n: number) => RESULT.changes.find((change) => change.number === n)!;

describe("cell addresses", () => {
  it("convert between letters and numbers the way Excel counts", () => {
    expect([1, 26, 27, 52, 703, 16384].map(columnLetters)).toEqual(["A", "Z", "AA", "AZ", "AAA", "XFD"]);
    expect(["A", "Z", "AA", "XFD"].map(columnNumber)).toEqual([1, 26, 27, 16384]);
    expect(parseRef("F22")).toEqual({ row: 22, col: 6 });
    expect(parseRef("$F$22")).toEqual({ row: 22, col: 6 });
    expect(parseRef("row 4")).toBeNull();
    expect(parseRange("A4:F4")).toEqual({ start: { row: 4, col: 1 }, end: { row: 4, col: 6 } });
  });
});

describe("the reader's location", () => {
  it("is always a sheet and a cell, never an internal identifier", () => {
    for (const change of toWorkspaceChanges(RESULT)) {
      expect(change.groupLabel).toMatch(/^Sheet: /);
      expect(change.place).not.toMatch(/^c\d+$|node|token|paragraph/i);
    }
    expect(locationFor(byNumber(5))).toBe("Pricing · B3");
  });

  it("names the original address when rows moved the cell", () => {
    expect(locationFor(byNumber(8))).toBe("Pricing · F5 (was F4)");
    expect(byNumber(8).original?.ref).toBe("F4");
    expect(byNumber(8).revised?.ref).toBe("F5");
  });

  it("names rows, columns and whole sheets in words", () => {
    expect(placeFor(byNumber(7))).toBe("Row 4");
    expect(placeFor(byNumber(10))).toBe("Row 5");
    expect(placeFor(byNumber(11))).toBe("Whole sheet");
  });
});

describe("headlines", () => {
  it("say what happened in plain words", () => {
    expect(RESULT.changes.map(headlineFor)).toEqual([
      "Formula changed",
      "Formula changed",
      "Formula changed",
      "Link changed",
      "Number changed",
      "Formula result changed",
      "Row added",
      "Date changed",
      "Text changed",
      "Row removed",
      "Sheet added",
    ]);
  });

  it("never rank or judge", () => {
    const words = RESULT.changes.map(headlineFor).join(" ").toLowerCase();
    for (const judgement of ["important", "minor", "major", "critical", "risky", "better", "worse"]) {
      expect(words).not.toContain(judgement);
    }
  });
});

describe("highlighting", () => {
  const maps = highlightMaps(RESULT);

  it("marks a changed cell on both sides, at its own address on each", () => {
    expect(maps.original.get("Pricing")?.get(cellKey(4, 6))?.changeId).toBe(byNumber(8).id);
    expect(maps.revised.get("Pricing")?.get(cellKey(5, 6))?.changeId).toBe(byNumber(8).id);
  });

  it("marks every cell of an added row in the revised workbook only", () => {
    const row = maps.revised.get("Pricing")!;
    for (let col = 1; col <= 6; col += 1) expect(row.get(cellKey(4, col))?.kind).toBe("added");
    expect(maps.original.get("Pricing")?.get(cellKey(4, 1))).toBeUndefined();
  });

  it("marks a removed row in the original workbook only", () => {
    expect(maps.original.get("Employees")?.get(cellKey(5, 1))?.kind).toBe("removed");
  });
});

describe("the two workbooks together", () => {
  it("pairs sheets and rows so both views can move together", () => {
    expect(counterpartSheet(RESULT, "revised", "Regions")).toBeNull();
    expect(counterpartSheet(RESULT, "original", "Pricing")).toBe("Pricing");
    // Pricing row 4 of the original is row 5 of the revised, below the inserted row.
    expect(mappedRow(RESULT, "original", "Pricing", 4)).toBe(5);
    expect(mappedRow(RESULT, "revised", "Pricing", 5)).toBe(4);
  });
});

describe("overview and details", () => {
  it("summarise only the groups that have changes", () => {
    expect(headline(RESULT.changes.length)).toBe("11 changes found");
    expect(headline(1)).toBe("1 change found");
    expect(headline(0)).toBe("No changes found");
    expect(NO_CHANGES_NOTE).toBe("No differences were detected under DiffNexa's supported comparison rules.");
    expect(overview(RESULT)).toEqual([
      { label: "value changes", count: 4 },
      { label: "formula changes", count: 3 },
      { label: "structural changes", count: 3 },
      { label: "link change", count: 1 },
    ]);
  });

  it("count each kind of change from the changes themselves", () => {
    const counts = Object.fromEntries(detailCounts(RESULT).map((item) => [item.label, item.count]));
    expect(counts["Formula changes"]).toBe(3);
    expect(counts["Added rows"]).toBe(1);
    expect(counts["Removed rows"]).toBe(1);
    expect(counts["Date changes"]).toBe(1);
    expect(counts["Link changes"]).toBe(1);
  });
});

describe("the first check in the browser", () => {
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  it("accepts a ZIP container and refuses the rest with the shared codes", () => {
    expect(checkXlsxBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toEqual({ ok: true });
    expect(checkXlsxBytes(new Uint8Array(0))).toEqual({ ok: false, code: "excel_empty_file" });
    expect(checkXlsxBytes(new TextEncoder().encode("Plan,Price\n"))).toEqual({ ok: false, code: "excel_not_xlsx" });
    expect(checkXlsxBytes(new Uint8Array([...ole, 0]))).toEqual({ ok: false, code: "excel_legacy_xls" });
    expect(checkXlsxBytes(new Uint8Array(8), 21 * 1024 * 1024)).toEqual({ ok: false, code: "excel_too_large" });
  });

  it("tells a password-protected workbook from an old .xls, as the engine does", () => {
    const name = Array.from("EncryptedPackage").flatMap((char) => [char.charCodeAt(0), 0]);
    expect(checkXlsxBytes(new Uint8Array([...ole, 0, ...name]))).toEqual({ ok: false, code: "excel_encrypted" });
  });
});
