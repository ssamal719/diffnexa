/**
 * DOCX Compare's exports: the result on screen as a CSV table, a printable
 * HTML report or plain text. Every value is the engine's — the change, where
 * it is (its page when the file records pages), the values and the quoted
 * evidence. AI explanations are not included.
 */

import { exportFormats, type ExportFormat, type ExportReport, type ExportRow } from "@/lib/export";
import {
  DEFAULT_DOCX_OPTIONS,
  headlineFor,
  layoutNote,
  whereOf,
  type DocxComparison,
} from "@/lib/docx-report";

type FileSummary = { name: string };

export function optionsSentence(result: DocxComparison): string {
  const options = result.options ?? DEFAULT_DOCX_OPTIONS;
  return [
    options.ignoreCase ? "capitalisation ignored" : "capitalisation compared",
    options.ignorePunctuation ? "punctuation-only changes ignored" : "punctuation compared",
  ].join(" · ");
}

export function docxExportReport(
  result: DocxComparison,
  original: FileSummary,
  revised: FileSummary,
  generatedAt: Date = new Date(),
): ExportReport {
  const groups = new Map(result.groups.map((group) => [group.id, group.label]));
  const rows: ExportRow[] = [...result.changes]
    .sort((a, b) => a.seq - b.seq)
    .map((change, index) => {
      const side = (which: "old" | "new") => change.evidence.filter((item) => item.side === which);
      const where = (which: "old" | "new") => [...new Set(side(which).map(whereOf))].join("; ");
      const quoted = (which: "old" | "new") =>
        [...new Set(side(which).map((item) => item.excerpt).filter(Boolean))].join(" … ");
      return {
        number: index + 1,
        change: headlineFor(change),
        group: groups.get(change.group) ?? "Other",
        originalWhere: where("old"),
        revisedWhere: where("new"),
        before: change.oldValue ?? "",
        after: change.newValue ?? "",
        difference: change.delta ?? "",
        originalEvidence: quoted("old"),
        revisedEvidence: quoted("new"),
      };
    });
  const pages = (summary?: { status: string; pages: number | null }) =>
    summary?.status === "recorded" && summary.pages ? ` · ${summary.pages} pages` : "";
  const note = layoutNote(result);
  return {
    tool: "DiffNexa DOCX Compare",
    title: `Comparison: ${original.name} → ${revised.name}`,
    generatedAt,
    facts: [
      { label: "Original", value: `${original.name}${pages(result.layout?.previous)}` },
      { label: "Revised", value: `${revised.name}${pages(result.layout?.revised)}` },
      { label: "Changes", value: String(result.changes.length) },
      { label: "Matching", value: optionsSentence(result) },
    ],
    notes: note ? [`${note.title}: ${note.text}`] : [],
    rows,
  };
}

/** The export formats DOCX Compare can produce reliably, each building its file on demand. */
export function docxExportFormats(result: DocxComparison, original: FileSummary, revised: FileSummary): ExportFormat[] {
  return exportFormats(() => docxExportReport(result, original, revised), [original.name, revised.name]);
}
