# 0008 — Every "Try example" is a golden pair, compared the ordinary way

**Decided:** September 2026, with Try Example and Comparison Controls for every tool.

## Decision

1. **Every tool has a built-in example**, and every example is a golden pair
   whose changes are written down and checked by the golden suite:

   | Tool | Example |
   |---|---|
   | PDF | Synthetic pair `multiple-changes` (a recruitment notice) |
   | Word | `apps/engine/tests/fixtures/docx_pages/build_example.py` (a services agreement) |
   | Excel | `excel-pairs/multiple-changes` (a company workbook) |
   | Website | `web-pairs/combined-update` |
   | Policy | `policy-pairs/terms-revision` (new) |
   | Competitor | `competitor-pairs/mixed-release` |
   | Price | `price-pairs/mixed-release` |

2. **File tools.** The two example files are served from
   `apps/web/public/examples/`. They are loaded into the upload slots, marked
   "Example file", and compared by the same request an upload makes.
3. **Web monitoring tools.** The example cannot depend on a live page.
   - The four compare endpoints accept `{"example": true}`. The engine then
     compares its own two saved pages, embedded in
     `diffnexa_engine/examples/pages.py`, with the same extraction and
     comparison as a real check.
   - Nothing is fetched, and any address or baseline sent with the request is
     ignored.
4. **The guide shown with each example** ("How this tool works") says what was
   changed.
   - A web test (`tests/examples-lib.test.ts`) checks every figure the guide
     mentions against the engine's real output for that example.
   - Engine tests check that each example page is byte-for-byte its golden
     pair.

## Why

- **An example must be the product, not a demo.** A canned result would show
  what we wish the comparison found. A golden pair run through the real
  comparison shows what it does find, and the suite fails if that changes.
- **No outside dependency.** Fetching a live page for the example would make it
  break whenever that site changed or was unreachable.
- **Embedded, not data files.** The example pages are Python strings, so they
  are part of the engine however it is installed. A packaging mistake cannot
  lose them.

## Also decided with this

- **Ignore options** are offered only where the engine applies them:
  - PDF: capitalisation (on by default) and punctuation-only changes (off). This
    is the same matching the Word tool uses.
  - Excel: capitalisation and extra spaces in text cells, both off by default,
    so text is compared exactly as it always was.

  A comparison that sends no options gets exactly the result it got before;
  the golden suite runs with the defaults.
- **Reverse** reruns the comparison with the files swapped. It is not a
  relabelling of the old result, and AI analysis is never carried over.
- **Linked** keeps the two versions in step:
  - PDF: page turning and zoom, using the page pairs the engine now returns
    (`pageLinks`), plus scroll position within the page.
  - Excel: rows.
  - Word and web: paragraphs.
- **Export**
  - Formats: CSV, printable HTML and plain text.
  - Built in the browser from the result on screen. AI text is never included.
- The web monitoring tools offer **Export** and **Linked**, but not Ignore
  options or Reverse: both would mean reading the live page again.
