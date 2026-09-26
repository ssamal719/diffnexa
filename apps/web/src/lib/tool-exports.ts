/**
 * Exports for PDF Compare, Excel Compare and the web monitoring tools: the
 * result on screen as a CSV table, a printable HTML report or plain text.
 *
 * Every value is the comparison's own — the change, where it is, the values
 * before and after, and the words quoted from each version. AI explanations
 * are never included. Differences a tool sets aside as minor are left out and
 * counted in a note, as they are on screen until asked for.
 */

import type { ComparisonResponse } from "@/lib/comparison";
import { headlineFor as excelHeadline, locationFor, type ExcelComparison } from "@/lib/excel-report";
import { exportFormats, type ExportFormat, type ExportReport, type ExportRow } from "@/lib/export";
import { CATEGORIES, categoryOf, headlineFor as pdfHeadline } from "@/lib/report";
import {
  WEB_CATEGORIES,
  categoryOf as webCategoryOf,
  headlineFor as webHeadline,
  locationOf,
  type WebChange,
} from "@/lib/web-report";

type Named = { name: string };

function unique(values: (string | null | undefined)[], separator: string): string {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].join(separator);
}

function pages(list: number[]): string {
  return list.length === 0 ? "" : list.length === 1 ? `Page ${list[0]}` : `Pages ${list.join(", ")}`;
}

function minorNote(count: number, words: string): string[] {
  return count > 0
    ? [`${count} ${words}${count === 1 ? " was" : "s were"} set aside and ${count === 1 ? "is" : "are"} not listed.`]
    : [];
}

// ---------------------------------------------------------------- PDF

export function pdfExportReport(
  result: ComparisonResponse,
  original: Named,
  revised: Named,
  generatedAt: Date = new Date(),
): ExportReport {
  const listed = [...result.changes].filter((change) => !change.isNoise).sort((a, b) => a.seq - b.seq);
  const label = (id: string) => CATEGORIES.find((item) => item.id === id)?.label ?? "Content";
  const rows: ExportRow[] = listed.map((change, index) => {
    const quoted = (side: "old" | "new") =>
      unique(change.evidence.filter((item) => item.side === side).map((item) => item.excerpt), " … ");
    return {
      number: index + 1,
      change: pdfHeadline(change),
      group: label(categoryOf(change)),
      originalWhere: pages(change.oldPages),
      revisedWhere: pages(change.newPages),
      before: change.oldValue ?? "",
      after: change.newValue ?? "",
      difference: change.delta ?? "",
      originalEvidence: quoted("old"),
      revisedEvidence: quoted("new"),
    };
  });
  const options = result.options;
  return {
    tool: "DiffNexa PDF Compare",
    title: `Comparison: ${original.name} → ${revised.name}`,
    generatedAt,
    facts: [
      { label: "Original", value: `${original.name} · ${result.documents.previous.pageCount} pages` },
      { label: "Revised", value: `${revised.name} · ${result.documents.revised.pageCount} pages` },
      { label: "Changes", value: String(rows.length) },
      ...(options
        ? [
            {
              label: "Matching",
              value: [
                options.ignoreCase ? "capitalisation ignored" : "capitalisation compared",
                options.ignorePunctuation ? "punctuation-only changes ignored" : "punctuation compared",
              ].join(" · "),
            },
          ]
        : []),
    ],
    notes: minorNote(result.changes.length - listed.length, "minor difference (such as a page header, footer or number)"),
    rows,
  };
}

export function pdfExportFormats(result: ComparisonResponse, original: Named, revised: Named): ExportFormat[] {
  return exportFormats(() => pdfExportReport(result, original, revised), [original.name, revised.name]);
}

// ---------------------------------------------------------------- Excel

const EXCEL_GROUPS: Record<string, string> = {
  values: "Values",
  formulas: "Formulas",
  structure: "Rows, columns and sheets",
  links: "Links",
};

export function excelExportReport(
  result: ExcelComparison,
  original: Named,
  revised: Named,
  generatedAt: Date = new Date(),
): ExportReport {
  const rows: ExportRow[] = result.changes.map((change, index) => {
    const where = (place: ExcelComparison["changes"][number]["original"]) =>
      place ? (place.ref ? `${place.sheet} · ${place.ref}` : place.sheet) : "";
    const quoted = (side: "old" | "new") =>
      unique(change.evidence.filter((item) => item.side === side).map((item) => item.excerpt), " … ");
    return {
      number: index + 1,
      change: `${excelHeadline(change)} — ${locationFor(change)}`,
      group: EXCEL_GROUPS[change.group] ?? "Other",
      originalWhere: where(change.original),
      revisedWhere: where(change.revised),
      before: change.oldValue ?? "",
      after: change.newValue ?? "",
      difference: change.delta ?? "",
      originalEvidence: quoted("old"),
      revisedEvidence: quoted("new"),
    };
  });
  const options = result.options;
  return {
    tool: "DiffNexa Excel Compare",
    title: `Comparison: ${original.name} → ${revised.name}`,
    generatedAt,
    facts: [
      { label: "Original", value: original.name },
      { label: "Revised", value: revised.name },
      { label: "Changes", value: String(rows.length) },
      ...(options
        ? [
            {
              label: "Matching",
              value: [
                options.ignoreCase ? "capitalisation ignored" : "capitalisation compared",
                options.ignoreWhitespace ? "extra spaces ignored" : "spaces compared",
              ].join(" · "),
            },
          ]
        : []),
    ],
    notes: [],
    rows,
  };
}

export function excelExportFormats(result: ExcelComparison, original: Named, revised: Named): ExportFormat[] {
  return exportFormats(() => excelExportReport(result, original, revised), [original.name, revised.name]);
}

// ---------------------------------------------------------------- web monitoring

type WebResult = { changes: WebChange[] };

/**
 * A web monitoring comparison. `labelFor` adds the tool's own classification
 * (a policy topic, a competitor signal, a pricing category) to each change.
 */
export function webExportReport(
  tool: string,
  result: WebResult,
  page: { url: string; baseline: string | null },
  labelFor: (change: WebChange) => string | null = () => null,
  generatedAt: Date = new Date(),
): ExportReport {
  const listed = result.changes.filter((change) => !change.isNoise).sort((a, b) => a.seq - b.seq);
  const kind = (change: WebChange) =>
    WEB_CATEGORIES.find((item) => item.id === webCategoryOf(change))?.label ?? "Wording";
  const rows: ExportRow[] = listed.map((change, index) => {
    const quoted = (side: "old" | "new") =>
      unique(change.evidence.filter((item) => item.side === side).map((item) => item.excerpt), " … ");
    const where = locationOf(change) ?? "";
    const extra = labelFor(change);
    return {
      number: index + 1,
      change: webHeadline(change),
      group: extra ? `${kind(change)} · ${extra}` : kind(change),
      originalWhere: change.kind === "added" ? "" : where,
      revisedWhere: change.kind === "removed" ? "" : where,
      before: change.oldValue ?? "",
      after: change.newValue ?? "",
      difference: change.delta ?? "",
      originalEvidence: quoted("old"),
      revisedEvidence: quoted("new"),
    };
  });
  return {
    tool: `DiffNexa ${tool}`,
    title: `${tool}: ${page.url}`,
    generatedAt,
    facts: [
      { label: "Page", value: page.url },
      ...(page.baseline ? [{ label: "Baseline", value: page.baseline }] : []),
      { label: "Changes", value: String(rows.length) },
    ],
    notes: minorNote(result.changes.length - listed.length, "unimportant difference (such as a timestamp)"),
    rows,
  };
}

export function webExportFormats(
  tool: string,
  result: WebResult,
  page: { url: string; baseline: string | null },
  labelFor?: (change: WebChange) => string | null,
): ExportFormat[] {
  return exportFormats(() => webExportReport(tool, result, page, labelFor), [tool, page.url.replace(/^https?:\/\//, "")]);
}
