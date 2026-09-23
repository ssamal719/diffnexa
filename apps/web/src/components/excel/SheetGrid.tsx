"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  cellKey,
  columnLetters,
  type CellPosition,
  type GridSheet,
  type Highlight,
} from "@/lib/excel-report";

export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 24;
const MIN_COLUMN = 64;
const MAX_COLUMN = 300;
const EMPTY_COLUMN = 88;
export const ROW_HEADER_WIDTH = 48;
const OVERSCAN = 4;

const TINT = {
  added: "bg-[#e6f3ea]",
  removed: "bg-[#fbe9ea]",
  changed: "bg-[#fdf3d6]",
  moved: "bg-[#eef1f5]",
} as const;

const MARK = { added: "+", removed: "−", changed: "±", moved: "→" } as const;

export type GridTarget = { row: number; col: number; token: number } | null;

/**
 * One worksheet, drawn as a spreadsheet: column letters, row numbers and a cell
 * grid that scrolls in both directions.
 *
 * Only the cells in view (plus a small margin) are in the page at any moment,
 * so a sheet of tens of thousands of cells scrolls as smoothly as a small one.
 * The headers are drawn outside the scrolling area and moved with it, so they
 * stay in place.
 *
 * Changed cells are tinted and carry a corner mark (+, −, ±, →) so the meaning
 * does not rest on colour; the active change is outlined in the signal colour.
 * When `target` changes, the grid scrolls so that cell is in the middle of the
 * view — the real scroll position, which the reader can then move freely.
 */
export function SheetGrid({
  sheet,
  label,
  highlights,
  active,
  target,
  onScrollRow,
  scrollToRow,
  height = 460,
}: {
  sheet: GridSheet | null;
  label: string;
  highlights: Map<string, Highlight> | undefined;
  active: { start: CellPosition; end: CellPosition } | null;
  target: GridTarget;
  /** Called with the first row in view when the reader scrolls, for scrolling the other side along. */
  onScrollRow?: (row: number) => void;
  /** Scroll so this row is at the top, without reporting back (the other side scrolled). */
  scrollToRow?: { row: number; token: number } | null;
  height?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const quiet = useRef(false);
  const [view, setView] = useState({ top: 0, left: 0, width: 600, height });

  const cells = useMemo(() => {
    const map = new Map<string, { text: string; kind: string; formula: string | null; link: string | null }>();
    for (const [row, col, text, kind, formula, link] of sheet?.cells ?? []) {
      map.set(cellKey(row, col), { text, kind, formula: formula ?? null, link: link ?? null });
    }
    return map;
  }, [sheet]);

  const rowCount = Math.max((sheet?.rows ?? 0) + 5, 30);
  const colCount = Math.max((sheet?.cols ?? 0) + 2, 8);
  // Each column is as wide as its longest value needs, within limits, the way a
  // reader would widen it in Excel. Offsets[c] is where column c starts.
  const offsets = useMemo(() => {
    const longest = new Map<number, number>();
    for (const [, col, text, , formula] of sheet?.cells ?? []) {
      const length = (text || formula || "").length;
      if (length > (longest.get(col) ?? 0)) longest.set(col, length);
    }
    const starts = [0, 0];
    for (let col = 1; col <= colCount; col += 1) {
      const chars = longest.get(col);
      const width =
        chars === undefined ? EMPTY_COLUMN : Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.round(chars * 7.4 + 36)));
      starts.push(starts[col] + width);
    }
    return starts;
  }, [sheet, colCount]);
  const colLeft = (col: number) => offsets[col];
  const colWidth = (col: number) => offsets[col + 1] - offsets[col];
  const contentWidth = offsets[colCount + 1];
  const contentHeight = rowCount * ROW_HEIGHT;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setView((current) => ({ ...current, width: element.clientWidth || 600, height: element.clientHeight || height }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  // Move to the chosen cell: centre its row, and bring its column into view.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !target) return;
    const top = Math.max(0, (target.row - 1) * ROW_HEIGHT - element.clientHeight / 2 + ROW_HEIGHT);
    const cellLeft = offsets[target.col] ?? 0;
    const cellRight = offsets[target.col + 1] ?? cellLeft;
    // Keep the first columns (usually the row labels) in view whenever the cell fits beside them.
    const left =
      cellRight <= element.clientWidth
        ? 0
        : cellLeft < element.scrollLeft || cellRight > element.scrollLeft + element.clientWidth
          ? // Show the cell whole, with as much of what is to its left as fits.
            Math.max(0, Math.min(cellLeft, cellRight - element.clientWidth + 12))
          : element.scrollLeft;
    quiet.current = element.scrollTop !== top || element.scrollLeft !== left;
    element.scrollTop = top;
    element.scrollLeft = left;
    setView((current) => ({ ...current, top, left }));
    // Offsets are read at the moment of the jump; later width changes do not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !scrollToRow) return;
    const top = Math.max(0, (scrollToRow.row - 1) * ROW_HEIGHT);
    quiet.current = element.scrollTop !== top;
    element.scrollTop = top;
    setView((current) => ({ ...current, top }));
  }, [scrollToRow]);

  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    setView((current) => ({ ...current, top: element.scrollTop, left: element.scrollLeft }));
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    onScrollRow?.(Math.floor(element.scrollTop / ROW_HEIGHT) + 1);
  }

  const firstRow = Math.max(1, Math.floor(view.top / ROW_HEIGHT) + 1 - OVERSCAN);
  const lastRow = Math.min(rowCount, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);
  const columnAt = (x: number) => {
    let low = 1;
    let high = colCount;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (offsets[middle] <= x) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const firstCol = Math.max(1, columnAt(view.left) - OVERSCAN);
  const lastCol = Math.min(colCount, columnAt(view.left + view.width) + OVERSCAN);

  const rows: number[] = [];
  for (let r = firstRow; r <= lastRow; r += 1) rows.push(r);
  const cols: number[] = [];
  for (let c = firstCol; c <= lastCol; c += 1) cols.push(c);

  const isActiveRow = (row: number) => active !== null && row >= active.start.row && row <= active.end.row;
  const isActiveCol = (col: number) => active !== null && col >= active.start.col && col <= active.end.col;

  if (!sheet) {
    return (
      <div
        role="region"
        aria-label={label}
        className="flex items-center justify-center border border-rule bg-surface text-[0.88rem] text-ink-soft"
        style={{ height }}
      >
        This sheet is not in this workbook.
      </div>
    );
  }

  if (sheet.kind !== "worksheet") {
    return (
      <div
        role="region"
        aria-label={label}
        className="flex items-center justify-center border border-rule bg-surface text-[0.88rem] text-ink-soft"
        style={{ height }}
      >
        This is a chart sheet. Charts are not compared.
      </div>
    );
  }

  return (
    <div
      className="relative grid overflow-hidden border border-rule bg-paper text-[0.8rem]"
      style={{
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px minmax(0, 1fr)`,
        gridTemplateRows: `${HEADER_HEIGHT}px ${height}px`,
      }}
    >
      <div className="border-r border-b border-rule bg-surface" aria-hidden="true" />
      {/* Column letters, moved with the grid's horizontal scroll */}
      <div className="relative overflow-hidden border-b border-rule bg-surface" aria-hidden="true">
        <div style={{ width: contentWidth, transform: `translateX(${-view.left}px)` }} className="relative h-full">
          {cols.map((col) => (
            <div
              key={col}
              className={[
                "absolute top-0 flex h-full items-center justify-center border-r border-rule text-[0.75rem]",
                isActiveCol(col) ? "bg-signal-soft font-semibold text-signal" : "text-ink-soft",
              ].join(" ")}
              style={{ left: colLeft(col), width: colWidth(col) }}
            >
              {columnLetters(col)}
            </div>
          ))}
        </div>
      </div>
      {/* Row numbers, moved with the grid's vertical scroll */}
      <div className="relative overflow-hidden border-r border-rule bg-surface" aria-hidden="true">
        <div style={{ height: contentHeight, transform: `translateY(${-view.top}px)` }} className="relative w-full">
          {rows.map((row) => (
            <div
              key={row}
              className={[
                "tabular absolute left-0 flex w-full items-center justify-end border-b border-rule pr-1.5 text-[0.75rem]",
                isActiveRow(row) ? "bg-signal-soft font-semibold text-signal" : "text-ink-soft",
              ].join(" ")}
              style={{ top: (row - 1) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              {row}
            </div>
          ))}
        </div>
      </div>
      {/* The cells */}
      <div
        ref={scroller}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        className="relative overflow-auto"
        data-testid="sheet-scroller"
      >
        <div style={{ width: contentWidth, height: contentHeight }} className="relative">
          {rows.map((row) =>
            cols.map((col) => {
              const key = cellKey(row, col);
              const cell = cells.get(key);
              const mark = highlights?.get(key);
              const inActive = isActiveRow(row) && isActiveCol(col);
              if (!cell && !mark && !inActive) return null;
              const numeric = cell && (cell.kind === "n" || cell.kind === "d");
              return (
                <div
                  key={key}
                  data-cell={`${columnLetters(col)}${row}`}
                  data-change={mark?.changeId}
                  title={cell?.formula ? `${cell.formula}` : undefined}
                  className={[
                    "absolute overflow-hidden border-r border-b border-rule px-1.5 leading-[25px] whitespace-nowrap text-ellipsis",
                    mark ? `${TINT[mark.kind]} pr-4` : "",
                    numeric ? "text-right tabular" : "",
                    cell?.kind === "x" ? "text-ink-soft italic" : "",
                    cell?.link ? "text-signal underline" : "",
                  ].join(" ")}
                  style={{
                    top: (row - 1) * ROW_HEIGHT,
                    left: colLeft(col),
                    width: colWidth(col),
                    height: ROW_HEIGHT,
                  }}
                >
                  {cell ? cell.text || cell.formula : ""}
                  {mark && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 right-0 bg-ink/70 px-[3px] text-[0.6rem] leading-[12px] font-bold text-white"
                    >
                      {MARK[mark.kind]}
                    </span>
                  )}
                </div>
              );
            }),
          )}
          {active && (
            <div
              aria-hidden="true"
              data-testid="active-outline"
              className="pointer-events-none absolute z-10 border-[2.5px] border-signal shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
              style={{
                top: (active.start.row - 1) * ROW_HEIGHT - 1,
                left: colLeft(active.start.col) - 1,
                width: offsets[Math.min(active.end.col, colCount) + 1] - colLeft(active.start.col) + 1,
                height: (active.end.row - active.start.row + 1) * ROW_HEIGHT + 1,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
