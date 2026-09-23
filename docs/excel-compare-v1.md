# Excel Compare — V1, and the Comparison Workspace V2

Tool #7, at `/excel-compare`. Upload an original and a revised Excel workbook
and see them side by side as spreadsheets. Every changed cell, formula, row,
column, sheet and link is listed, and choosing one moves **both** workbooks to
that sheet and cell, with the cell outlined.

No AI is involved. No account. Nothing is stored. No formula is calculated and
no macro is run.

This stage also introduces the **Comparison Workspace V2**, a reusable screen
for comparing two versions of anything. Excel Compare is its first user. The
six earlier tools are unchanged and do not use it yet.

*Update:* since the Unified Comparison Workspace V2, every tool uses this
screen — see [unified-workspace-v2.md](unified-workspace-v2.md).

---

## The workflow

```
Original workbook (.xlsx) + Revised workbook (.xlsx)
  → Compare workbooks
  → browser → POST /api/excel/compare (this site)
            → POST /v1/excel/compare (engine, with the shared secret)
  → workspace: "N changes found", navigator, both workbooks as grids
```

The browser never calls the engine. The engine's address and
`ENGINE_SHARED_SECRET` stay on the website's server (`src/lib/engine-config.ts`,
no `NEXT_PUBLIC_` variable). The person's filenames are not forwarded: the
website sends the files as `original.xlsx` and `revised.xlsx`.

## Formats

| File | Result |
|---|---|
| `.xlsx` (Excel workbook, Transitional OOXML) | Compared |
| `.xls` (Excel 97–2003) | Refused: `excel_legacy_xls` |
| `.xlsm`, or any workbook containing a VBA project or macro sheet | Refused: `excel_macro_enabled` |
| `.xlsb`, `.xltx`/`.xltm` templates, Strict OOXML | Refused: `excel_unsupported` |
| Password-protected workbook | Refused: `excel_encrypted` |
| Anything else (CSV, PDF, a renamed file) | Refused: `excel_not_xlsx` |
| Damaged package or XML | Refused: `excel_unreadable` |
| No worksheets | Refused: `excel_no_sheets` |

The kind of file is decided from its bytes, never its name. The browser does the
same first check (`checkXlsxBytes`) so an obviously wrong file is refused before
it is sent. The engine repeats every check. All wording comes from the shared
contract (`packages/contracts/errors.json`, `excel_messages`) and names the
workbook concerned ("This is about your revised workbook.").

## What is compared

| Content | How |
|---|---|
| Cell values | Text, numbers, dates, true/false and error values. Added (a cell filled in), removed (cleared) and modified. Numbers show the difference: `$299.00 → $349.00`, difference `+50 (+16.72%)`. Percentages show the difference in percentage points. |
| Dates | A number counts as a date **only** when its cell is formatted as a date, so `46310` in a General cell stays a number. Both the 1900 and 1904 date systems are handled, including Excel's 1900 leap-year quirk. Text that reads as a whole date (for example "15 October 2026") is compared as a date, with the difference in days. |
| Formulas | Compared as written, never calculated. A changed formula is **one** change showing the formula and its stored result on both sides; the result is not reported again separately. A formula that is unchanged but whose stored result changed (because a cell it uses changed) is reported as "Formula result changed". Shared formulas are expanded the way Excel does, so each cell has its own formula. |
| Rows and columns | Matched by content, not position. An inserted row is one change, and the rows after it are compared with their true counterparts: a price that moved from F21 to F22 is compared with itself and shown as "F22 (was F21)". Added, removed and moved rows; added and removed columns. |
| Sheets | Paired by name. Added and removed sheets; a renamed sheet (same content under a new name); a change in sheet order. Hidden sheets are compared and marked "(hidden)". |
| Links | A hyperlink whose cell text is unchanged but which now points elsewhere. Links are read as text and never opened. |

### Groups

Every change is in exactly one group: **Values**, **Formulas**, **Structure**
(rows, columns, sheets) or **Links**. The overview shows only the groups that
have changes, for example "4 value changes · 3 formula changes · 3 structural
changes · 1 link change".

### How matching works (for maintainers)

- **Columns** are aligned by the similarity of their contents (threshold 0.34),
  with a bonus when the heading at the top is the same.
- **Rows** are aligned in two passes: exact-content anchors first, then the
  best in-order pairing of the rows between anchors (threshold 0.5, capped at
  40,000 comparisons per gap so a pathological sheet cannot run away). Equal
  numbers of unmatched rows between two anchors are paired by position.
- **Moved rows** are rows with identical content found at a different position.
- A formula whose only difference is that its row moved (`=B4*C4` becoming
  `=B5*C5` one row down) is not a change.
- Changes are ordered by sheet, then by position, and numbered.

Code: `apps/engine/diffnexa_engine/xlsx/` (`extract.py`, `numfmt.py`,
`formula.py`, `align.py`, `compare.py`, `api.py`).

## What is not compared (and the page says so)

- Formatting: fonts, colours, borders, column widths, merged cells, conditional
  formatting and number formats. A value shown as `25%` instead of `0.25` is the
  same value and is not reported.
- Charts, chart sheets, images, shapes, comments and pivot tables. The result
  says when a workbook has them.
- What a formula would calculate to. The results shown are the ones Excel saved
  in the file. If a formula has no stored result, the result says so and only
  the formula text is compared.
- External workbooks and data connections. Never opened; the result says when a
  workbook refers to them.
- Pixel-level or visual comparison of any kind.

## Evidence

Every change carries **cell evidence** (`Evidence.scope = "cell"`, added to the
shared contract in `contracts/changes.py`): which workbook (by a SHA-256 of its
content, not of the file's bytes), which sheet, which cell, and the value as
read. A change about a whole sheet has sheet
evidence with no cell. A change cannot mix cell evidence with page or webpage
evidence; the contract refuses it.

Before a result leaves the engine, `contracts/xlsx_traceability.py` re-reads
every cited cell from the extracted workbooks and checks the excerpt matches.
Any change that fails is dropped and counted in `diagnostics.droppedUntraceable`
(zero on the whole golden corpus).

In the workspace, **View evidence** lists each cited cell as
"Original · Pricing · F4: 15 Oct 2026". The details panel shows, for each side,
the sheet, the cell or range, the value as displayed, the value as stored, the
formula and the link.

The cell fields appear only on cell evidence, so the output of the PDF, website,
policy, competitor, price and DOCX tools is byte-for-byte what it was before.

## The Comparison Workspace V2

`src/components/workspace/ComparisonWorkspace.tsx` and `src/lib/workspace.ts`.

```
┌ Overview: Comparison complete · N changes found · counts per group · files ┐
├ Toolbar:  [Grid|Diff|Details]  [Search changes]   Change 8 of 11  ← →      ┤
├ DIFFERENCES navigator │ the tool's main view (e.g. ORIGINAL │ REVISED)     ┤
│ grouped, searchable   │ the active change's details                        │
└───────────────────────┴────────────────────────────────────────────────────┘
```

The workspace knows nothing about workbooks. A tool supplies:

- its changes in the shared `WorkspaceChange` shape: number, group (for Excel,
  the sheet), place ("F5", "Row 4", "Whole sheet"), category, kind, before,
  after, a description for screen readers and the text to search;
- the modes it really has (the workspace draws only those tabs);
- `renderMain(context)` and `renderDetails(context)`.

The workspace owns the active change, search, the Previous/Next buttons, the
counter ("Change 8 of 11", or "Change 2 of 3 shown · 11 in total" while
searching), and arrow-key movement in the navigator. Choosing a change from any
of these increases an `activation` counter; the tool's view moves to the change
whenever that counter changes, so choosing the same change again still moves
back to it.

### Excel's three modes

- **Grid**: both workbooks as spreadsheets side by side, with column letters,
  row numbers and sheet tabs (added, removed and renamed sheets are marked, and
  each tab shows how many changes it holds). Choosing a change opens its sheet
  on both sides, scrolls both to its cell and outlines it. Changed cells are
  tinted **and** carry a corner mark (+ added, − removed, ± changed, → moved) so
  meaning never rests on colour alone. When a row was inserted, the other side
  shows where the row would be and says so ("Nearest place: …"). "Scroll both
  workbooks together" keeps the matched rows of both sides aligned while
  scrolling. Choosing a sheet tab opens the matching sheet on the other side.
- **Diff**: every change in a table: where and what, the original value and the
  revised value (formulas with their stored result), and the difference. "Show
  in grid" jumps to it.
- **Details**: facts only: each file's name, size, sheet count, cells with
  content, date system, its sheets, and the count of each kind of change.

### Virtualization

`SheetGrid` draws only the rows and columns in view plus a small margin. On the
3,000-row golden workbook it had 208 cell elements in the page while showing
row 2,802. Column widths fit their content (within limits), and the headers sit
outside the scrolling area and move with it.

### Small screens

Below the `md` breakpoint the layout stacks: overview, toolbar, navigator (its
own scroll area), an **Original / Revised** switcher, one spreadsheet, then the
details. Choosing a removed row switches to the original; an added one to the
revised. A workbook hidden behind the switcher is moved to the active change as
it is shown. The page has no horizontal overflow at 375 px.

## Security

- The browser talks only to this site (`/api/excel/compare`); the site adds the
  shared secret on the server. Tested: the secret is not in any page, and the
  browser made no request to the engine.
- Files are held in memory for the request and never written to disk or stored.
  Neither the site's route nor the Excel code in the engine writes anything
  about the workbooks to a log (tested for the site's route).
- The package is read from memory through the shared hardened OOXML reader
  (`diffnexa_engine/ooxml/safety.py`, now also used by DOCX Compare):
  - every member name is checked, so `../` and absolute paths are refused;
  - every read is bounded: at most 5,000 entries; 64 MB per worksheet, 32 MB
    for any other part and 160 MB in total once decompressed, so a zip bomb is
    refused rather than inflated;
  - XML with a DOCTYPE or entity declaration is refused, and the parser never
    resolves entities or loads anything from the network.
- Limits: 20 MB per file (`DIFFNEXA_EXCEL_MAX_FILE_MB`), 60 sheets, 150,000
  cells with content (`DIFFNEXA_EXCEL_MAX_CELLS`). Each is a refusal, never a
  silent truncation.
- Macros: macro-enabled content is refused, not skipped. Formulas are text.
  Links and external references are never followed.
- Rate limit: its own `excel-compare` bucket with the PDF comparison limits
  (10 a minute, 60 an hour per visitor).
- The golden corpus includes path-traversal, external-entity and zip-bomb
  workbooks, each refused with the right code.

## Testing

- Engine: `tests/test_xlsx_extract.py`, `test_xlsx_security.py`,
  `test_xlsx_compare.py`, `test_xlsx_service.py`, `test_xlsx_golden.py`
  (evidence completeness and determinism included).
- Golden: `golden/excel-pairs/`, 33 pairs (27 comparisons with 59 hand-written
  expected changes, and 6 that must be refused). Workbooks that need stored
  formula results are saved by LibreOffice (`_build/build_pairs.py`) so they
  are real application output.
- Website: `tests/excel-report.test.ts`, `excel-api.test.ts`,
  `excel-ui.test.tsx`, `workspace.test.ts`.
- Real browser (production build, real engine), 1440 px and 375 px: upload →
  compare → navigator → click "Pricing · F5 (was F4)" → both workbooks on
  Pricing, F4 outlined in the original and F5 in the revised, both inside the
  visible area → details updated. axe (WCAG 2.1 A/AA): no violations.

## Known limitations

- Formatting, charts, images, comments and pivot tables are not compared.
- Formula results are the ones saved in the file. A workbook saved without
  results (some generators do this) can only have its formula text compared.
- Row matching is by content. When many rows are nearly identical, a row can
  be paired with a similar neighbour; the change is still real and evidenced,
  but may be reported as a modification of a neighbouring row rather than an
  insertion. The golden corpus includes inserted blank rows and moved rows.
- Whole-row and whole-column changes are reported once, as a row or column; the
  cells inside them are highlighted but not listed separately.
- Very wide or tall workbooks up to 150,000 cells are supported; larger ones
  are refused rather than slowed down.
- Strict OOXML and binary `.xlsb` are not read.

## Future migration to the workspace

The earlier tools keep their own report screens in this stage. Each can move
later, one at a time, without engine changes:

1. Map its changes to `WorkspaceChange` (group = page, section or table; place
   = the reader's location, never an internal ID).
2. Offer only the modes it truly has. DOCX could have Diff (the current cards)
   and Details. PDF could add a page view when the viewer is ready.
3. Render its existing view through `renderMain`, then retire the old screen
   once its tests pass against the workspace.
