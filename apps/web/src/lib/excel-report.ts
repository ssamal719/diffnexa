/**
 * Turning an Excel comparison into what the workspace shows.
 *
 * Presentation only. Every sheet name, cell address, value, formula,
 * difference and piece of evidence comes from the engine's response. The
 * reader's location is always a sheet and a cell ("Pricing · F22") — never an
 * internal identifier.
 */

import type { EditKind, WorkspaceChange } from "@/lib/workspace";

// ---------------------------------------------------------------- the API shape

export type ExcelCellSnapshot = {
  value: string;
  display: string;
  kind: string;
  formula: string | null;
  link: string | null;
};

export type ExcelPlace = {
  sheet: string;
  ref: string | null;
  exact: boolean;
  note: string | null;
  cell: ExcelCellSnapshot | null;
  cells: string[];
};

export type ExcelChange = {
  id: string;
  number: number;
  seq: number;
  type: string;
  kind: "added" | "removed" | "modified" | "moved";
  category: string;
  subtype: string | null;
  group: "values" | "formulas" | "structure" | "links";
  sheet: string;
  ref: string | null;
  label: string | null;
  oldValue: string | null;
  newValue: string | null;
  delta: string | null;
  confidence: number;
  original: ExcelPlace | null;
  revised: ExcelPlace | null;
  evidence: { side: "old" | "new"; sheet: string; cell: string | null; excerpt: string | null }[];
};

/** [row, col, shown text, kind code, formula?, link?] — kind: n number, d date, s text, b bool, e error, x no stored result. */
export type GridCell = [number, number, string, string, (string | null)?, string?];

export type GridSheet = {
  name: string;
  index: number;
  kind: string;
  state: string;
  rows: number;
  cols: number;
  merges: string[];
  cells: GridCell[];
};

export type SheetPairing = {
  original: string | null;
  revised: string | null;
  status: "same" | "renamed" | "added" | "removed";
  rows: [number, number][];
  columns: [number, number][];
};

export type WorkbookSummary = {
  sha256: string;
  sheetCount: number;
  cellCount: number;
  date1904: boolean;
  warnings: string[];
};

export type ExcelComparison = {
  engineVersion: string;
  processingMs: number;
  workbooks: { original: WorkbookSummary; revised: WorkbookSummary };
  counts: { total: number };
  groups: { id: string; label: string; changeCount: number; changeIds: string[] }[];
  changes: ExcelChange[];
  sheets: SheetPairing[];
  grids: { original: GridSheet[]; revised: GridSheet[] };
  diagnostics: { notes: string[]; droppedUntraceable: number };
};

export type ExcelFailure = { code: string; message: string; side?: "original" | "revised" | null };

export type Side = "original" | "revised";

// ---------------------------------------------------------------- cells

export function columnLetters(column: number): string {
  let letters = "";
  let n = column;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export type CellPosition = { row: number; col: number };

export function parseRef(ref: string): CellPosition | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  if (!match) return null;
  return { row: Number(match[2]), col: columnNumber(match[1]) };
}

/** Every cell a range covers, with its corners: "A5:F5" → A5…F5. */
export function parseRange(ref: string): { start: CellPosition; end: CellPosition } | null {
  const [first, second] = ref.split(":");
  const start = parseRef(first);
  const end = second ? parseRef(second) : start;
  if (!start || !end) return null;
  return {
    start: { row: Math.min(start.row, end.row), col: Math.min(start.col, end.col) },
    end: { row: Math.max(start.row, end.row), col: Math.max(start.col, end.col) },
  };
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

// ---------------------------------------------------------------- wording

export function editKindOf(change: ExcelChange): EditKind {
  return change.kind === "modified" ? "changed" : change.kind;
}

/** What changed, in a few plain words. */
export function headlineFor(change: ExcelChange): string {
  const kind = editKindOf(change);
  switch (change.subtype) {
    case "sheet":
      return kind === "added" ? "Sheet added" : "Sheet removed";
    case "sheet_rename":
      return "Sheet renamed";
    case "sheet_order":
      return "Sheet moved";
    case "row":
      return { added: "Row added", removed: "Row removed", moved: "Row moved", changed: "Row changed" }[kind];
    case "column":
      return kind === "added" ? "Column added" : "Column removed";
    case "hyperlink":
      return { added: "Link added", removed: "Link removed", changed: "Link changed", moved: "Link moved" }[kind];
    case "calculated":
      return "Formula result changed";
  }
  if (change.category === "formula") {
    if (kind === "added") return "Formula added";
    if (kind === "removed") return "Formula removed";
    return "Formula changed";
  }
  if (kind === "added") return "Cell filled in";
  if (kind === "removed") return "Cell cleared";
  if (change.category === "number") return "Number changed";
  if (change.category === "date") return "Date changed";
  return "Text changed";
}

/** The short kind shown in the navigator. */
export function categoryFor(change: ExcelChange): string {
  switch (change.subtype) {
    case "sheet":
    case "sheet_rename":
    case "sheet_order":
      return "Sheet";
    case "row":
      return "Row";
    case "column":
      return "Column";
    case "hyperlink":
      return "Link";
    case "calculated":
      return "Result";
  }
  if (change.category === "formula") return "Formula";
  if (change.category === "number") return "Number";
  if (change.category === "date") return "Date";
  return "Text";
}

/** Where the change is, in the reader's terms: "F22", "Row 4 · A4:F4", "Whole sheet". */
export function placeFor(change: ExcelChange): string {
  if (change.subtype === "row" && change.ref) {
    const range = parseRange(change.ref);
    return range ? `Row ${range.start.row}` : change.ref;
  }
  if (change.subtype === "column" && change.ref) {
    const range = parseRange(change.ref);
    return range ? `Column ${columnLetters(range.start.col)}` : change.ref;
  }
  if (!change.ref) return "Whole sheet";
  return change.ref;
}

/** "Pricing · F22", adding the original address when a row or column moved it. */
export function locationFor(change: ExcelChange): string {
  const original = change.original;
  const revised = change.revised;
  const here = change.ref ? `${change.sheet} · ${change.ref}` : change.sheet;
  if (original?.exact && revised?.exact && original.ref && revised.ref && original.ref !== revised.ref) {
    return `${here} (was ${original.ref})`;
  }
  if (original && revised && original.sheet !== revised.sheet && change.subtype !== "sheet_rename") {
    return `${here} (was ${original.sheet})`;
  }
  return here;
}

export function toWorkspaceChanges(result: ExcelComparison): WorkspaceChange[] {
  return result.changes.map((change) => {
    const title = headlineFor(change);
    const where = locationFor(change);
    const before = change.oldValue;
    const after = change.newValue;
    const values = [before && `from ${before}`, after && `to ${after}`].filter(Boolean).join(" ");
    return {
      id: change.id,
      number: change.number,
      group: change.sheet,
      groupLabel: `Sheet: ${change.sheet}`,
      title,
      place: placeFor(change),
      category: categoryFor(change),
      tags: { sheet: [change.sheet], category: [categoryFor(change)] },
      kind: editKindOf(change),
      before,
      after,
      description: `Change ${change.number}: ${title}, ${where}${values ? `, ${values}` : ""}.`,
      searchText: [
        title,
        where,
        change.sheet,
        change.ref,
        change.original?.ref,
        change.original?.sheet,
        before,
        after,
        change.delta,
        change.original?.cell?.formula,
        change.revised?.cell?.formula,
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

// ---------------------------------------------------------------- highlighting

export type Highlight = { changeId: string; kind: EditKind };

/**
 * For each side and sheet, which cells belong to which change. A row, column
 * or sheet change highlights every cell it covers; a cell change its own cell.
 */
export function highlightMaps(result: ExcelComparison): Record<Side, Map<string, Map<string, Highlight>>> {
  const maps: Record<Side, Map<string, Map<string, Highlight>>> = { original: new Map(), revised: new Map() };
  for (const change of result.changes) {
    const kind = editKindOf(change);
    for (const side of ["original", "revised"] as const) {
      const place = change[side];
      if (!place) continue;
      const refs = place.cells.length > 0 ? place.cells : place.exact && place.ref && place.cell ? [place.ref] : [];
      if (refs.length === 0) continue;
      let sheet = maps[side].get(place.sheet);
      if (!sheet) {
        sheet = new Map();
        maps[side].set(place.sheet, sheet);
      }
      for (const ref of refs) {
        const position = parseRef(ref);
        if (!position) continue;
        const key = cellKey(position.row, position.col);
        if (!sheet.has(key)) sheet.set(key, { changeId: change.id, kind });
      }
    }
  }
  return maps;
}

/** The rectangle a change covers on one side, for the active outline. */
export function activeArea(place: ExcelPlace | null): { start: CellPosition; end: CellPosition } | null {
  if (!place?.ref) return null;
  return parseRange(place.ref);
}

/** The sheet on the other side that a sheet is paired with, if any. */
export function counterpartSheet(result: ExcelComparison, side: Side, name: string): string | null {
  const pairing = result.sheets.find((item) => item[side] === name);
  if (!pairing) return null;
  return side === "original" ? pairing.revised : pairing.original;
}

/** The row on the other side that shows the same content, or the nearest one. */
export function mappedRow(result: ExcelComparison, side: Side, sheet: string, row: number): number {
  const pairing = result.sheets.find((item) => item[side] === sheet);
  if (!pairing || pairing.rows.length === 0) return row;
  const [from, to] = side === "original" ? [0, 1] : [1, 0];
  let best = pairing.rows[0];
  for (const pair of pairing.rows) {
    if (pair[from] <= row) best = pair;
    else break;
  }
  return Math.max(1, best[to] + (row - best[from]));
}

// ---------------------------------------------------------------- details

export type DetailCounts = { label: string; count: number }[];

/** Counts for the Details view — each derived directly from the changes returned. */
export function detailCounts(result: ExcelComparison): DetailCounts {
  const changes = result.changes;
  const count = (predicate: (change: ExcelChange) => boolean) => changes.filter(predicate).length;
  const rows: DetailCounts = [
    { label: "Changed cells", count: count((c) => c.subtype === "cell" || c.subtype === "calculated" || c.category === "formula") },
    { label: "Numeric changes", count: count((c) => c.category === "number") },
    { label: "Date changes", count: count((c) => c.category === "date") },
    { label: "Text changes", count: count((c) => c.category === "text") },
    { label: "Formula changes", count: count((c) => c.category === "formula") },
    { label: "Formula results changed", count: count((c) => c.subtype === "calculated") },
    { label: "Added rows", count: count((c) => c.subtype === "row" && c.kind === "added") },
    { label: "Removed rows", count: count((c) => c.subtype === "row" && c.kind === "removed") },
    { label: "Moved rows", count: count((c) => c.subtype === "row" && c.kind === "moved") },
    { label: "Added columns", count: count((c) => c.subtype === "column" && c.kind === "added") },
    { label: "Removed columns", count: count((c) => c.subtype === "column" && c.kind === "removed") },
    { label: "Sheets added, removed, renamed or moved", count: count((c) => (c.subtype ?? "").startsWith("sheet")) },
    { label: "Link changes", count: count((c) => c.group === "links") },
  ];
  return rows;
}

/** The overview line: "4 values · 2 formulas · 1 structure", only for groups that have changes. */
export function overview(result: ExcelComparison): { label: string; count: number }[] {
  const names: Record<string, [string, string]> = {
    values: ["value change", "value changes"],
    formulas: ["formula change", "formula changes"],
    structure: ["structural change", "structural changes"],
    links: ["link change", "link changes"],
  };
  return result.groups
    .filter((group) => group.changeCount > 0)
    .map((group) => ({
      label: (names[group.id] ?? [group.label, group.label])[group.changeCount === 1 ? 0 : 1],
      count: group.changeCount,
    }));
}

export function headline(total: number): string {
  if (total === 0) return "No changes found";
  return `${total} change${total === 1 ? "" : "s"} found`;
}

export const NO_CHANGES_NOTE = "No differences were detected under DiffNexa's supported comparison rules.";
