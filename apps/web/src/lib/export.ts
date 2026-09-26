/**
 * Turning a finished comparison into files a person can keep: a CSV table,
 * a printable HTML report and a plain-text report.
 *
 * Everything is built in the browser from the result already on screen —
 * nothing is sent anywhere to make them — and every value comes from the
 * comparison: the changes, where they are and the evidence quoted from each
 * version. AI explanations are never included, because an export is a record
 * of what the comparison found.
 */

export type ExportRow = {
  number: number;
  change: string;
  group: string;
  originalWhere: string;
  revisedWhere: string;
  before: string;
  after: string;
  difference: string;
  originalEvidence: string;
  revisedEvidence: string;
};

/** One way to export a result, building its file only when chosen. */
export type ExportFormat = {
  id: string;
  label: string;
  detail: string;
  download: () => void;
};

export type ExportReport = {
  tool: string;
  title: string;
  generatedAt: Date;
  facts: { label: string; value: string }[];
  notes: string[];
  rows: ExportRow[];
};

const COLUMNS: { key: keyof ExportRow; label: string }[] = [
  { key: "number", label: "#" },
  { key: "change", label: "Change" },
  { key: "group", label: "Kind" },
  { key: "originalWhere", label: "Where (original)" },
  { key: "revisedWhere", label: "Where (revised)" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
  { key: "difference", label: "Difference" },
  { key: "originalEvidence", label: "Evidence (original)" },
  { key: "revisedEvidence", label: "Evidence (revised)" },
];

// ---------------------------------------------------------------- CSV

function csvCell(value: string | number): string {
  const text = String(value);
  // A cell a spreadsheet would run as a formula is written as text instead.
  // A signed number such as "+27" or "-3.5%" is left as it is: it is only a number.
  const formula = /^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d.,]/.test(text));
  const safe = formula ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(report: ExportReport): string {
  const lines = [COLUMNS.map((column) => csvCell(column.label)).join(",")];
  for (const row of report.rows) lines.push(COLUMNS.map((column) => csvCell(row[column.key])).join(","));
  // A byte-order mark so spreadsheet programs read the text as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- HTML

function escape(text: string | number): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toHtml(report: ExportReport): string {
  const facts = report.facts
    .map((fact) => `<tr><th scope="row">${escape(fact.label)}</th><td>${escape(fact.value)}</td></tr>`)
    .join("");
  const notes = report.notes.map((note) => `<p class="note">${escape(note)}</p>`).join("");
  const rows = report.rows
    .map(
      (row) => `<section class="change">
<h3>${escape(row.number)}. ${escape(row.change)} <span class="kind">${escape(row.group)}</span></h3>
<dl>
${row.originalWhere ? `<dt>Where (original)</dt><dd>${escape(row.originalWhere)}</dd>` : ""}
${row.revisedWhere ? `<dt>Where (revised)</dt><dd>${escape(row.revisedWhere)}</dd>` : ""}
${row.before ? `<dt>Before</dt><dd><del>${escape(row.before)}</del></dd>` : ""}
${row.after ? `<dt>After</dt><dd><ins>${escape(row.after)}</ins></dd>` : ""}
${row.difference ? `<dt>Difference</dt><dd>${escape(row.difference)}</dd>` : ""}
${row.originalEvidence ? `<dt>Evidence (original)</dt><dd><q>${escape(row.originalEvidence)}</q></dd>` : ""}
${row.revisedEvidence ? `<dt>Evidence (revised)</dt><dd><q>${escape(row.revisedEvidence)}</q></dd>` : ""}
</dl>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(report.title)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#14202c;max-width:52rem;margin:2rem auto;padding:0 1rem;overflow-wrap:anywhere}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:2rem 0 .5rem}h3{font-size:1rem;margin:0 0 .4rem}
table{border-collapse:collapse}th,td{text-align:left;padding:.2rem .8rem .2rem 0;vertical-align:top}th{color:#50606e;font-weight:500}
.note{background:#f4f6f8;border-left:3px solid #9aa7b3;padding:.4rem .6rem;margin:.5rem 0}
.change{border:1px solid #d9dee3;border-radius:6px;padding:.7rem .9rem;margin:.6rem 0;break-inside:avoid}
.kind{font-weight:400;color:#50606e;font-size:.85rem}
dl{display:grid;grid-template-columns:10rem minmax(0,1fr);gap:.15rem .75rem;margin:0}dt{color:#50606e}dd{margin:0}
del{background:#fdf0f0;text-decoration-color:#b3261e}ins{background:#eef7f1;text-decoration:none;font-weight:600}
footer{margin-top:2rem;color:#50606e;font-size:.85rem}
@media (max-width:40rem){dl{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>${escape(report.title)}</h1>
<p>${escape(report.tool)} · generated ${escape(report.generatedAt.toLocaleString("en-GB"))}</p>
<table>${facts}</table>
${notes}
<h2>${report.rows.length} change${report.rows.length === 1 ? "" : "s"}</h2>
${rows || "<p>No changes were found.</p>"}
<footer>Every change was found by DiffNexa's deterministic comparison and is shown with the words quoted from each version. AI explanations are not included in this report.</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------- plain text

export function toText(report: ExportReport): string {
  const lines = [report.title, `${report.tool} · generated ${report.generatedAt.toLocaleString("en-GB")}`, ""];
  for (const fact of report.facts) lines.push(`${fact.label}: ${fact.value}`);
  for (const note of report.notes) lines.push("", note);
  lines.push("", `${report.rows.length} change${report.rows.length === 1 ? "" : "s"}`, "");
  for (const row of report.rows) {
    lines.push(`${row.number}. ${row.change} (${row.group})`);
    if (row.originalWhere) lines.push(`   Where (original): ${row.originalWhere}`);
    if (row.revisedWhere) lines.push(`   Where (revised): ${row.revisedWhere}`);
    if (row.before) lines.push(`   Before: ${row.before}`);
    if (row.after) lines.push(`   After: ${row.after}`);
    if (row.difference) lines.push(`   Difference: ${row.difference}`);
    if (row.originalEvidence) lines.push(`   Evidence (original): "${row.originalEvidence}"`);
    if (row.revisedEvidence) lines.push(`   Evidence (revised): "${row.revisedEvidence}"`);
    lines.push("");
  }
  lines.push("Found by DiffNexa's deterministic comparison. AI explanations are not included.");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- saving

/** A file name made of the comparison's own words, safe on every system. */
export function exportName(parts: string[], extension: string, date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const base = parts
    .map((part) => part.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N} ._()-]+/gu, " ").trim())
    .filter(Boolean)
    .join(" vs ")
    .slice(0, 120);
  return `DiffNexa - ${base || "comparison"} - ${stamp}.${extension}`;
}

/**
 * The three formats every tool can export reliably, each building its file
 * only when chosen. `parts` names the file (usually the two versions' names).
 */
export function exportFormats(build: () => ExportReport, parts: string[]): ExportFormat[] {
  const name = (extension: string) => exportName(parts, extension);
  return [
    {
      id: "csv",
      label: "Changes table (CSV)",
      detail: "One row per change, for Excel or Google Sheets.",
      download: () => saveFile(name("csv"), "text/csv;charset=utf-8", toCsv(build())),
    },
    {
      id: "html",
      label: "Report (HTML)",
      detail: "A page to read, share or print to PDF from your browser.",
      download: () => saveFile(name("html"), "text/html;charset=utf-8", toHtml(build())),
    },
    {
      id: "text",
      label: "Report (plain text)",
      detail: "The same report as simple text.",
      download: () => saveFile(name("txt"), "text/plain;charset=utf-8", toText(build())),
    },
  ];
}

/** Hands a file to the browser to save. */
export function saveFile(name: string, type: string, content: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
