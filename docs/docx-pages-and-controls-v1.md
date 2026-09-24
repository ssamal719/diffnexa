# DOCX Page Locations and Comparison Controls V1

## What was built

### Page numbers for Word changes

Before this stage, DOCX Compare located a change as "Paragraph 105", because a
Word file has no pages of its own. Now a change is located on the page where
Microsoft Word showed it, when the file records that. The page appears in the
navigator (changes are grouped by page), on each change card, in the evidence
panel for each version, and in the side-by-side view as page dividers. A page
that begins part-way through a paragraph is marked where it begins. The
paragraph or table position is still shown next to the page.

How the pages are found is in decision
[0007](decisions/0007-docx-pages-from-words-recorded-layout.md). In short: Word
records where each page began when it saves a file. DiffNexa reads those
markers and checks them against the page and word counts Word also stores. If
they do not check out, or the file was saved by another program, no page
numbers are shown and the report says why. DiffNexa never estimates a page.

### Comparison controls (DOCX Compare)

- **Try example.** Loads two short, fictional versions of a services agreement
  into the upload slots, labelled "Example file", and compares them through the
  normal upload path. No account is needed. Either file can be replaced.
  The files are in `apps/web/public/examples/`, built by
  `apps/engine/tests/fixtures/docx_pages/build_example.py`.
- **Ignore options.** These are real engine options:
  - *Ignore capitalisation*, on by default;
  - *Ignore punctuation-only changes*, off by default. Punctuation inside
    numbers such as 2,500 is always compared.

  Applying them compares the documents again. The panel also lists what is
  always ignored (extra spaces and line breaks, where lines wrap and where pages
  break) and what DOCX Compare does not compare at all (formatting,
  headers/footers/footnotes/comments, images). The report shows which options
  the comparison on screen used.
- **Reverse.** Swaps the two files and compares again. The upload slots, the
  report header, the counts and the evidence all follow. Any AI analysis from
  before is discarded, because the result is new.
- **Export.**
  - Formats: a CSV changes table, a printable HTML report, and a plain-text
    report.
  - They are built in the browser from the result on screen: every change,
    where it is (with pages), before and after values, and the quoted evidence.
  - AI explanations are never included.
  - Spreadsheet formulas are neutralised in the CSV.
- **Linked scrolling.**
  - Available in the side-by-side view; on by default, with an On/Off switch.
  - Scrolling one version moves the other to the matching paragraph.
  - Paragraphs are matched from the comparison's own data: paragraphs a change
    cites on both sides, and unchanged paragraphs that appear exactly once in
    each version. The match is by paragraph, not pixel-perfect.

The other tools are unchanged. The controls appear only where a tool passes
real behaviour for them. Today that is DOCX Compare.

## Files

Engine:

- `docx/layout.py` (new) — page tracking and the check against Word's statistics.
- `docx/extract.py`, `docx/package.py`, `docx/model.py` — reading the markers.
- `docx/api.py` — pages on evidence, the `layout` summary, pages in the view,
  the `options` echo.
- `compare/normalize.py`, `compare/text_align.py`, `docx/compare.py` — the
  matching options.
- `service/app.py` — the `ignore_case` and `ignore_punctuation` form fields.
- `golden/docx.py` — the `old_page`/`new_page` expectations.

Engine tests:

- `test_docx_pages.py`, `test_docx_compare_options.py`,
  `test_docx_golden.py`, `test_docx_service.py`.
- The fixtures in `tests/fixtures/docx_pages/`: the 135-page documents, the
  rendered-page oracle `expected.json`, and the builders.

Golden:

- New pairs: `capitalisation-only`, `punctuation-only`, `pages-long-document`.
- `baseline.json` and `BASELINE_CHANGES.md`.

Web:

- `lib/export.ts`, `lib/docx-export.ts`, `lib/linked-scroll.ts` (new).
- `components/workspace/WorkspaceControls.tsx` (new).
- Changed:
  - `components/docx/DocxDesk.tsx`, `DocxUploadSlot.tsx`, `DocxReport.tsx`;
  - `components/workspace/ComparisonWorkspace.tsx`, `FlowView.tsx`,
    `DocumentFlowPane.tsx`;
  - `lib/docx-report.ts`, `lib/content-view.ts`,
    `app/api/docx/compare/route.ts`.

Web tests:

- `docx-pages.test.tsx`, `docx-controls.test.tsx`, `export.test.ts`,
  `linked-scroll.test.ts`.
- Updated: `docx-ui`, `docx-report`, `docx-api`, `workspace-ui`.
- The fixtures `docx-example*.json` and `docx-long-pages.json` are real engine
  output.

## How to test it

1. Open `/docx-compare` and choose **Try example**.
   - The navigator groups the changes under "Page 1" and "Page 2".
   - Each change says which page it is on.
2. Open **Ignore options**, untick *Ignore capitalisation*, then choose
   **Apply and compare again**.
   - The count goes from 7 to 8, because "Client's" → "client's" is now
     reported.
3. Tick *Ignore punctuation-only changes* and apply.
   - The comma-only change disappears.
4. Choose **Reverse**.
   - The files swap slots.
   - The added sub-processor clause becomes a removal.
   - The fee reads £2,750 → £2,500.
5. Choose **Export** and download each format. Open them.
6. Scroll one version in the side-by-side view.
   - The other version follows.
   - Turn **Linked** off and it stops following.
7. Compare a document saved by Microsoft Word with one of its revisions: pages
   appear. Compare two files made by Google Docs or LibreOffice: a note explains
   that the files do not record their pages, and no page numbers are shown.

## Known limitations

- Page numbers appear only for files last saved by Microsoft Word (desktop).
  Files from Google Docs, LibreOffice, Pages or generating software have no
  recorded layout, so they get no page numbers.
- A page is Word's page on the computer that last saved the file. Opening it
  with different fonts or printer settings can move text to another page.
- Try example, Ignore options, Reverse, Export and Linked scrolling are DOCX
  Compare only in this version.
- Export has no Word redline (tracked changes) and no image export.
- Linked scrolling aligns paragraphs, not pixels. Near the end of a document
  the two versions can be a few lines apart, because one runs out of room to
  scroll.
- The screenshots mentioned in the brief did not arrive with it, so the
  toolbar follows DiffNexa's existing workspace design.
