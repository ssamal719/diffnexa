# How DiffNexa compares two PDFs

Written for someone who is not a developer, then progressively more technical.

## In one paragraph

DiffNexa reads both PDFs into the same neutral form — every word with its page,
position and font. It matches the pages of one version to the other, then
matches paragraphs across the whole document, then looks inside the paragraphs
that changed to find the exact words. Where a changed run of words is a number
or a date on both sides, it reports one typed change with the difference worked
out. Every change it reports carries the page and the words it came from, and a
final check throws away anything that cannot be traced back to the documents.

No AI is involved. The same two PDFs always produce the same result.

## The five layers

| Layer | What it does |
|---|---|
| Pages | Matches old pages to new pages by content, in document order. Reports pages added, removed and (rarely) reordered. |
| Structure | Builds lines and paragraphs in reading order, detects headings, and marks repeated headers, footers and page numbers as furniture. |
| Text | Aligns paragraphs across the whole document; finds added, removed, reworded and moved text. |
| Values | Inside changed text, recognises numbers, money, percentages and dates, and calculates the difference. |
| Evidence | Verifies every change against the real documents before returning it. |

## Why compare the whole document rather than page by page

If one page is inserted, page-by-page comparison reports every later page as
completely rewritten. DiffNexa compares the document's reading order instead and
keeps each paragraph's page for evidence, so an inserted page is reported once
and the text that merely shifted is not reported at all.

## Text alignment in detail

1. **Anchor on identical paragraphs.** Paragraphs identical after normalisation
   are matched first. Normalisation ignores only presentation: line wrapping,
   repeated spaces, curly versus straight quotes, dash styles, and words
   hyphenated across a line break. Normalised text is never shown to the user.
2. **Pair edited paragraphs.** In the gaps between anchors, every old paragraph
   is scored against every new one by string similarity. Pairs are taken
   best-first above a similarity of 0.55.
3. **Detect moves.** Text that disappears in one place and reappears word for
   word elsewhere is one move, not a deletion plus an insertion. At least five
   words are required, so short repeated phrases are not mistaken for movement.
4. **Word-level diff.** Inside a paired paragraph, the exact differing runs of
   words are found. This is what allows "627 → 654" instead of "this sentence
   was rewritten".

## Numbers and dates

A changed run of words is typed only when both sides parse as the same kind of
value. Recognised: plain numbers, Indian digit grouping (1,23,45,678),
international grouping (1,234,567), decimals, currency (₹ $ € £ ¥ Rs. INR USD…),
percentages, years, and reference numbers.

Dates are read in the common forms: 30 September 2026, 30th Sept 2026,
September 30 2026, 2026-09-30, and numeric forms where one part is above 12.

Deliberate restraint, because a confident wrong answer is worse than none:

* **Ambiguous dates are not compared as dates.** `03/04/2026` could be March or
  April, so it is compared as text and no day difference is claimed.
* **Misleading percentages are not calculated.** Years (2026 → 2027 is not a
  0.05% rise), percentages themselves (percentage points), and anything starting
  from zero get an absolute difference only.
* **Different currencies are not subtracted.** ₹500 → $500 is a change, not a
  difference of zero.
* **Reference numbers get no arithmetic.**

## Noise

Some differences are real but not meaningful. Repeated headers and footers,
page numbering ("Page 2 of 3" becoming "Page 2 of 4" when a page is inserted),
and text that only moved are marked as noise. They are *not* deleted: they are
reported with a reason and hidden behind a toggle, so nothing is silently
withheld.

## Evidence

Every change names the page and the words it came from in each document, and
quotes the surrounding line. Before the result is returned, each piece of
evidence is checked against the actual extracted documents: do those words
exist on that page, does the highlighted area lie within the page, does the
quoted text match the words cited, and do the fingerprints match these two
files. Anything failing is discarded and counted. This is enforced in code, so
the engine cannot return a change the documents do not support.

## Known limitations

* **Tables are read as ordinary text.** Rows and columns are not reconstructed,
  so a change is reported as a text or number change rather than "row 3,
  column 2". Values inside tables are still found. Real table structure is a
  later stage.
* **Scanned pages cannot be compared as text.** They are detected and reported
  honestly; OCR is planned.
* **Heavily rewritten paragraphs** are reported as a removal plus an addition
  rather than a modification. Past a certain point the text really is new.
* **Complex layouts.** Two columns are handled; three or more columns, sidebars
  and text wrapping around images may be read in the wrong order.
* **Right-to-left scripts** are not handled.
* **Reordered pages** are only detected when the page content is nearly
  identical (80% or more).

Each limitation has a test, so if one is ever fixed the test records it.
