"use client";

import { useMemo, useState } from "react";

import { SheetGrid, type GridTarget } from "@/components/excel/SheetGrid";
import { Alert } from "@/components/ui/Alert";
import { ComparisonWorkspace, type WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import {
  NO_CHANGES_NOTE,
  activeArea,
  counterpartSheet,
  detailCounts,
  headline,
  headlineFor,
  highlightMaps,
  locationFor,
  mappedRow,
  overview,
  parseRange,
  toWorkspaceChanges,
  type ExcelChange,
  type ExcelComparison,
  type ExcelPlace,
  type GridSheet,
  type Side,
} from "@/lib/excel-report";
import { formatFileSize } from "@/lib/validation";

type FileSummary = { name: string; sizeBytes: number };

const MODES = [
  { id: "grid", label: "Grid" },
  { id: "diff", label: "Diff" },
  { id: "details", label: "Details" },
];

/**
 * Excel Compare in the shared Comparison Workspace.
 *
 * Grid shows both workbooks as spreadsheets, side by side, and moves both to
 * the active change; Diff lists every change with its values before and after
 * for quick scanning; Details lists the facts about the two workbooks and the
 * counts of each kind of change. Every mode shows data from the comparison;
 * none is decorative.
 */
export function ExcelWorkspace({
  result,
  original,
  revised,
}: {
  result: ExcelComparison;
  original: FileSummary;
  revised: FileSummary;
}) {
  const changes = useMemo(() => toWorkspaceChanges(result), [result]);
  const byId = useMemo(() => new Map(result.changes.map((change) => [change.id, change])), [result]);
  const total = result.changes.length;
  const warnings = [
    ...result.workbooks.original.warnings.map((text) => ({ title: "About the original workbook", text })),
    ...result.workbooks.revised.warnings.map((text) => ({ title: "About the revised workbook", text })),
    ...result.diagnostics.notes.map((text) => ({ title: "Worth knowing", text })),
  ];

  return (
    <ComparisonWorkspace
      title="Excel Compare"
      headline={headline(total)}
      summary={overview(result)}
      emptyNote={NO_CHANGES_NOTE}
      files={{ original: original.name, revised: revised.name }}
      changes={changes}
      modes={MODES}
      initialMode="grid"
      notes={
        warnings.length > 0 ? (
          <div className="space-y-1 border-b border-rule px-3 py-2">
            {warnings.map((warning) => (
              <Alert key={`${warning.title}-${warning.text}`} tone="note" title={warning.title}>
                {warning.text}
              </Alert>
            ))}
          </div>
        ) : null
      }
      renderMain={(context) =>
        context.mode === "diff" ? (
          <DiffView context={context} byId={byId} />
        ) : context.mode === "details" ? (
          <DetailsView result={result} original={original} revised={revised} />
        ) : (
          <GridView result={result} context={context} byId={byId} original={original} revised={revised} />
        )
      }
      renderDetails={(context) =>
        total > 0 ? (
          <ChangeDetails
            key={context.active?.id ?? "none"}
            change={context.active ? (byId.get(context.active.id) ?? null) : null}
            context={context}
            total={total}
          />
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------- Grid

function firstSheet(sheets: GridSheet[]): string | null {
  return sheets.find((sheet) => sheet.kind === "worksheet")?.name ?? sheets[0]?.name ?? null;
}

function GridView({
  result,
  context,
  byId,
  original,
  revised,
}: {
  result: ExcelComparison;
  context: WorkspaceContext;
  byId: Map<string, ExcelChange>;
  original: FileSummary;
  revised: FileSummary;
}) {
  const highlights = useMemo(() => highlightMaps(result), [result]);
  const change = context.active ? byId.get(context.active.id) ?? null : null;
  const [sheets, setSheets] = useState<Record<Side, string | null>>(() => sheetsFor(result, change));
  const [targets, setTargets] = useState<Record<Side, GridTarget>>({ original: null, revised: null });
  const [follow, setFollow] = useState<Record<Side, { row: number; token: number } | null>>({
    original: null,
    revised: null,
  });
  const [together, setTogether] = useState(true);
  const [mobileSide, setMobileSide] = useState<Side>("revised");
  const [followCount, setFollowCount] = useState(0);
  const [handled, setHandled] = useState<number | null>(null);

  // Every time a change is chosen, both workbooks go to it. This is worked out
  // while rendering (not in an effect), so both views move in the same render.
  if (change && handled !== context.activation) {
    setHandled(context.activation);
    setSheets(sheetsFor(result, change));
    setTargets({
      original: targetFor(change.original, context.activation),
      revised: targetFor(change.revised, context.activation),
    });
    if (change.kind === "removed") setMobileSide("original");
    else if (change.kind === "added") setMobileSide("revised");
  }

  function chooseSheet(side: Side, name: string) {
    const other: Side = side === "original" ? "revised" : "original";
    const counterpart = counterpartSheet(result, side, name);
    setSheets((current) => ({ ...current, [side]: name, [other]: counterpart ?? current[other] }));
  }

  function scrolled(side: Side, row: number) {
    if (!together) return;
    const sheet = sheets[side];
    const other: Side = side === "original" ? "revised" : "original";
    if (!sheet || !sheets[other] || counterpartSheet(result, side, sheet) !== sheets[other]) return;
    const next = followCount + 1;
    setFollowCount(next);
    setFollow((current) => ({ ...current, [other]: { row: mappedRow(result, side, sheet, row), token: next } }));
  }

  const grids = result.grids;
  const panes: { side: Side; label: string; file: FileSummary; sheetList: GridSheet[] }[] = [
    { side: "original", label: "Original", file: original, sheetList: grids.original },
    { side: "revised", label: "Revised", file: revised, sheetList: grids.revised },
  ];

  return (
    <div className="border-b border-rule">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-surface px-3 py-1.5 text-[0.82rem]">
        <div role="group" aria-label="Show on small screens" className="flex rounded-[3px] border border-rule-strong md:hidden">
          {(["original", "revised"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={mobileSide === side}
              onClick={() => {
                setMobileSide(side);
                // A hidden workbook cannot scroll, so it goes to the active change as it is shown.
                setTargets((current) => ({ ...current, [side]: current[side] ? { ...current[side] } : null }));
              }}
              className={[
                "px-3 py-1 font-medium capitalize",
                mobileSide === side ? "bg-signal text-white" : "bg-paper text-ink",
              ].join(" ")}
            >
              {side}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={together} onChange={(event) => setTogether(event.target.checked)} />
          Scroll both workbooks together
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {panes.map((pane) => {
          const sheetName = sheets[pane.side];
          const sheet = pane.sheetList.find((item) => item.name === sheetName) ?? null;
          const place = change?.[pane.side] ?? null;
          const area = place && place.sheet === sheetName && place.exact ? activeArea(place) : null;
          const nearest = place && place.sheet === sheetName && !place.exact ? activeArea(place) : null;
          return (
            <section
              key={pane.side}
              aria-label={`${pane.label} spreadsheet`}
              className={[
                "min-w-0 md:border-r md:last:border-r-0 md:border-rule",
                mobileSide === pane.side ? "block" : "hidden md:block",
              ].join(" ")}
            >
              <header className="flex items-baseline gap-2 px-3 pt-2">
                <h3 className="text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">{pane.label}</h3>
                <p className="min-w-0 truncate text-[0.8rem]" title={pane.file.name}>
                  {pane.file.name}
                </p>
              </header>
              <SheetTabs
                sheets={pane.sheetList}
                active={sheetName}
                side={pane.side}
                result={result}
                onChoose={(name) => chooseSheet(pane.side, name)}
              />
              <div className="px-2 pb-2">
                <SheetGrid
                  sheet={sheetName === null ? null : sheet}
                  label={`${pane.label} workbook, sheet ${sheetName ?? "not present"}`}
                  highlights={sheetName ? highlights[pane.side].get(sheetName) : undefined}
                  active={area ?? nearest}
                  target={sheetName && place?.sheet === sheetName ? targets[pane.side] : null}
                  onScrollRow={(row) => scrolled(pane.side, row)}
                  scrollToRow={follow[pane.side]}
                  height={420}
                />
                {place && place.sheet === sheetName && place.note && (
                  <p className="mt-1 text-[0.78rem] text-ink-soft">
                    <span className="font-medium">{place.exact ? "Note:" : "Nearest place:"}</span> {place.note}
                  </p>
                )}
                {change && !place && (
                  <p className="mt-1 text-[0.78rem] text-ink-soft">
                    This change has no place in the {pane.side} workbook.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function sheetsFor(result: ExcelComparison, change: ExcelChange | null): Record<Side, string | null> {
  const fallback = {
    original: firstSheet(result.grids.original),
    revised: firstSheet(result.grids.revised),
  };
  if (!change) return fallback;
  const original = change.original?.sheet ?? null;
  const revised = change.revised?.sheet ?? null;
  return {
    original: original ?? (revised ? counterpartSheet(result, "revised", revised) : null),
    revised: revised ?? (original ? counterpartSheet(result, "original", original) : null),
  };
}

function targetFor(place: ExcelPlace | null, token: number): GridTarget {
  if (!place?.ref) return place ? { row: 1, col: 1, token } : null;
  const range = parseRange(place.ref);
  return range ? { row: range.start.row, col: range.start.col, token } : null;
}

function SheetTabs({
  sheets,
  active,
  side,
  result,
  onChoose,
}: {
  sheets: GridSheet[];
  active: string | null;
  side: Side;
  result: ExcelComparison;
  onChoose: (name: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const change of result.changes) {
    const place = change[side];
    if (place) counts.set(place.sheet, (counts.get(place.sheet) ?? 0) + 1);
  }
  return (
    <div role="group" aria-label="Sheets" className="relative flex gap-1 overflow-x-auto px-2 pt-1.5 pb-1">
      {sheets.map((sheet) => {
        const pairing = result.sheets.find((item) => item[side] === sheet.name);
        const status =
          pairing?.status === "added"
            ? "new"
            : pairing?.status === "removed"
              ? "removed"
              : pairing?.status === "renamed"
                ? "renamed"
                : null;
        const count = counts.get(sheet.name) ?? 0;
        const current = sheet.name === active;
        return (
          <button
            key={sheet.name}
            type="button"
            aria-pressed={current}
            onClick={() => onChoose(sheet.name)}
            className={[
              "shrink-0 rounded-t-[3px] border border-b-0 px-2.5 py-1 text-[0.8rem]",
              current ? "border-signal bg-signal-soft font-semibold text-signal" : "border-rule bg-paper text-ink hover:bg-surface",
            ].join(" ")}
          >
            {sheet.name}
            {sheet.state !== "visible" && <span className="ml-1 text-[0.7rem] text-ink-soft">(hidden)</span>}
            {status && <span className="ml-1 text-[0.7rem] text-caution">({status})</span>}
            {count > 0 && (
              <span className="tabular ml-1.5 rounded-full bg-ink/10 px-1.5 text-[0.7rem]">
                {count}
                <span className="sr-only"> change{count === 1 ? "" : "s"}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Diff

function DiffView({ context, byId }: { context: WorkspaceContext; byId: Map<string, ExcelChange> }) {
  return (
    <div className="border-b border-rule">
      <table className="w-full table-fixed border-collapse text-[0.84rem]">
        <caption className="sr-only">Every change, with its value before and after</caption>
        <thead className="bg-surface text-left text-[0.75rem] text-ink-soft">
          <tr>
            <th scope="col" className="w-10 px-2 py-1.5 font-semibold">#</th>
            <th scope="col" className="w-[32%] px-2 py-1.5 font-semibold">Where and what</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">Original</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">Revised</th>
          </tr>
        </thead>
        <tbody>
          {context.visible.map((item) => {
            const change = byId.get(item.id);
            if (!change) return null;
            const current = context.active?.id === item.id;
            const before = diffSide(change, "original");
            const after = diffSide(change, "revised");
            return (
              <tr key={item.id} className={["border-t border-rule align-top", current ? "bg-signal-soft" : ""].join(" ")}>
                <td className="tabular px-2 py-2 text-ink-soft">{item.number}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => context.activate(item.id)}
                    className="text-left font-semibold text-signal hover:underline"
                  >
                    {locationFor(change)}
                  </button>
                  <p className="text-[0.8rem] text-ink-soft">{headlineFor(change)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      context.activate(item.id);
                      context.setMode("grid");
                    }}
                    className="mt-1 text-[0.78rem] font-medium text-signal hover:underline"
                  >
                    Show in grid
                  </button>
                </td>
                <td className="px-2 py-2 break-words">
                  {before ? <span className="rounded-[2px] bg-[#fbe9ea] px-1">{before}</span> : <span className="text-ink-soft">—</span>}
                </td>
                <td className="px-2 py-2 break-words">
                  {after ? <span className="rounded-[2px] bg-[#e6f3ea] px-1">{after}</span> : <span className="text-ink-soft">—</span>}
                  {change.delta && <p className="tabular mt-1 text-[0.78rem] text-ink-soft">{change.delta}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function diffSide(change: ExcelChange, side: Side): string | null {
  const value = side === "original" ? change.oldValue : change.newValue;
  if (change.category === "formula") {
    const cell = change[side]?.cell;
    if (cell?.formula && cell.display) return `${cell.formula}  (${cell.display})`;
  }
  return value;
}

// ---------------------------------------------------------------- Details

function DetailsView({
  result,
  original,
  revised,
}: {
  result: ExcelComparison;
  original: FileSummary;
  revised: FileSummary;
}) {
  const counts = detailCounts(result);
  const renamed = result.sheets.filter((item) => item.status === "renamed");
  return (
    <div className="grid gap-4 border-b border-rule p-3 md:grid-cols-2">
      {(["original", "revised"] as const).map((side) => {
        const file = side === "original" ? original : revised;
        const book = result.workbooks[side];
        return (
          <section key={side} aria-labelledby={`details-${side}`}>
            <h3 id={`details-${side}`} className="text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
              {side === "original" ? "Original workbook" : "Revised workbook"}
            </h3>
            <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-y-0.5 text-[0.84rem]">
              <dt className="text-ink-soft">File</dt>
              <dd className="break-words">{file.name}</dd>
              <dt className="text-ink-soft">Size</dt>
              <dd>{formatFileSize(file.sizeBytes)}</dd>
              <dt className="text-ink-soft">Sheets</dt>
              <dd className="tabular">{book.sheetCount}</dd>
              <dt className="text-ink-soft">Cells with content</dt>
              <dd className="tabular">{book.cellCount.toLocaleString("en")}</dd>
              <dt className="text-ink-soft">Date system</dt>
              <dd>{book.date1904 ? "1904 (Mac)" : "1900 (standard)"}</dd>
            </dl>
            <ul className="mt-2 text-[0.82rem]">
              {result.grids[side].map((sheet) => (
                <li key={sheet.name} className="flex justify-between gap-2 border-t border-rule py-0.5">
                  <span className="truncate">
                    {sheet.name}
                    {sheet.kind !== "worksheet" && " (chart sheet)"}
                    {sheet.state !== "visible" && " (hidden)"}
                  </span>
                  <span className="tabular text-ink-soft">
                    {sheet.cells.length.toLocaleString("en")} cells{sheet.rows ? ` · to ${sheet.rows} rows` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="details-counts" className="md:col-span-2">
        <h3 id="details-counts" className="text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
          What changed, counted
        </h3>
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[0.84rem] sm:grid-cols-3">
          {counts.map((item) => (
            <div key={item.label} className="flex justify-between gap-2 border-t border-rule py-0.5">
              <dt className="text-ink-soft">{item.label}</dt>
              <dd className="tabular font-medium">{item.count}</dd>
            </div>
          ))}
        </dl>
        {renamed.length > 0 && (
          <p className="mt-2 text-[0.82rem] text-ink-soft">
            Sheets matched by their content:{" "}
            {renamed.map((item) => `${item.original} → ${item.revised}`).join(", ")}.
          </p>
        )}
        <p className="mt-2 text-[0.78rem] text-ink-soft">
          Compared: cell values, dates, text, formulas (as written, never calculated), hyperlinks, and the rows,
          columns and sheets that hold them. Not compared: formatting, charts, images, comments, and pivot tables.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- the active change

function ChangeDetails({
  change,
  context,
  total,
}: {
  change: ExcelChange | null;
  context: WorkspaceContext;
  total: number;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  if (!change) {
    return <p className="p-3 text-[0.85rem] text-ink-soft">Choose a change to see its details.</p>;
  }
  return (
    <section aria-labelledby="change-details" className="p-3" aria-live="polite">
      <p className="tabular text-[0.75rem] text-ink-soft">
        Change {change.number} of {total}
      </p>
      <h3 id="change-details" className="text-[1rem] font-semibold">
        {headlineFor(change)} <span className="font-normal text-ink-soft">· {locationFor(change)}</span>
      </h3>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <PlaceCard title="Original" place={change.original} value={change.oldValue} tone="removed" />
        <PlaceCard title="Revised" place={change.revised} value={change.newValue} tone="added" />
      </div>
      {change.delta && (
        <p className="tabular mt-2 text-[0.88rem]">
          <span className="text-ink-soft">Difference: </span>
          <span className="font-semibold">{change.delta}</span>
        </p>
      )}
      <div className="mt-2">
        <button
          type="button"
          aria-expanded={showEvidence}
          onClick={() => setShowEvidence((open) => !open)}
          className="text-[0.84rem] font-medium text-signal hover:underline"
        >
          {showEvidence ? "Hide evidence" : "View evidence"}
        </button>
        {showEvidence && (
          <ul className="mt-1 space-y-0.5 text-[0.82rem]">
            {change.evidence.map((item, index) => (
              <li key={`${item.side}-${item.cell}-${index}`}>
                <span className="text-ink-soft">
                  {item.side === "old" ? "Original" : "Revised"} · {item.sheet}
                  {item.cell ? ` · ${item.cell}` : " (sheet)"}:{" "}
                </span>
                <q>{item.excerpt}</q>
              </li>
            ))}
            <li className="text-[0.75rem] text-ink-soft">
              Read directly from each workbook; every cell listed was checked against the file before this result was
              shown.
            </li>
          </ul>
        )}
      </div>
      {context.mode !== "grid" && (
        <button
          type="button"
          onClick={() => {
            context.setMode("grid");
            context.activate(change.id);
          }}
          className="mt-2 text-[0.84rem] font-medium text-signal hover:underline"
        >
          Show this change in the grid
        </button>
      )}
    </section>
  );
}

function PlaceCard({
  title,
  place,
  value,
  tone,
}: {
  title: string;
  place: ExcelPlace | null;
  value: string | null;
  tone: "added" | "removed";
}) {
  const border = tone === "added" ? "border-added/40" : "border-removed/40";
  return (
    <div className={`rounded-[3px] border ${border} p-2`}>
      <p className="text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">{title}</p>
      {!place ? (
        <p className="text-[0.85rem] text-ink-soft">Not in this workbook.</p>
      ) : (
        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-0.5 text-[0.85rem]">
          <dt className="text-ink-soft">Sheet</dt>
          <dd className="break-words">{place.sheet}</dd>
          {place.ref && (
            <>
              <dt className="text-ink-soft">{place.ref.includes(":") ? "Range" : "Cell"}</dt>
              <dd className="tabular">
                {place.ref}
                {!place.exact && <span className="text-ink-soft"> (nearest)</span>}
              </dd>
            </>
          )}
          {place.cell ? (
            <>
              <dt className="text-ink-soft">Value</dt>
              <dd className="break-words font-medium">{place.cell.display || "(no stored result)"}</dd>
              {place.cell.value && place.cell.value !== place.cell.display && (
                <>
                  <dt className="text-ink-soft">Stored as</dt>
                  <dd className="tabular break-words">{place.cell.value}</dd>
                </>
              )}
              {place.cell.formula && (
                <>
                  <dt className="text-ink-soft">Formula</dt>
                  <dd className="font-mono text-[0.8rem] break-words">{place.cell.formula}</dd>
                </>
              )}
              {place.cell.link && (
                <>
                  <dt className="text-ink-soft">Link</dt>
                  <dd className="break-all">{place.cell.link}</dd>
                </>
              )}
            </>
          ) : (
            value && (
              <>
                <dt className="text-ink-soft">Content</dt>
                <dd className="break-words">{value}</dd>
              </>
            )
          )}
          {place.note && (
            <>
              <dt className="text-ink-soft">Note</dt>
              <dd className="text-[0.8rem] text-ink-soft">{place.note}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
