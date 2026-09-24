# Fix: long URLs pushed the comparison workspace sideways

## What was wrong

On Excel Compare, a long FindsBeacon URL in a cell made the Evidence panel
scroll sideways. On a tablet or phone, the whole page scrolled sideways.

The cause was CSS, not the comparison:

- Evidence values sat in grid columns sized `1fr`. A `1fr` column can never be
  narrower than the longest unbreakable word inside it, and a URL is one
  unbreakable word.
- The values used `break-words` (`overflow-wrap: break-word`). That wraps a
  long word only once the column already has its width. It does not stop the
  word from setting the column's minimum width, so the URL widened the column
  and the column widened the panel.
- The same pattern existed elsewhere in the shared workspace. It only showed
  up when a string had no hyphens to break at:
  - the change cards of the List view (PDF, DOCX, Website, Policy, Competitor,
    Price);
  - link text in the side-by-side panes of the web tools;
  - AI Change Analyst's explanations.

## The fix

- **The workspace container** (`ComparisonWorkspace.tsx`) now has
  `wrap-anywhere` (`overflow-wrap: anywhere`). Every tool's content inherits
  it: evidence, the change list, both versions and AI Change Analyst. A long
  string now breaks to fit its box, and it no longer sets the minimum width of
  the column it sits in. The Evidence panel repeats the rule and also has
  `min-w-0` and `max-w-full`.
- **Value columns** are `minmax(0,1fr)` instead of `1fr`: Excel evidence
  cards, Excel details, and AI Change Analyst's values.
- **Grids and flex items** that hold evidence or values have `min-w-0`, so they
  are allowed to shrink.
- **`break-words` and `break-all`** are replaced by `wrap-anywhere` in the
  workspace components and the three List-view cards.

Nothing is truncated, hidden or clipped. Text that is meant to stay on one line
is unaffected: spreadsheet cells and the one-line summaries in the change
navigator use `whitespace-nowrap`/`truncate`, which override wrapping. The
spreadsheet grids still scroll sideways on purpose, as spreadsheets do.

No comparison logic, detected changes, evidence, API contracts, the site
shell or SEO changed.

## How it was checked

- **Automated tests:** `tests/evidence-wrapping.test.tsx`, 19 tests. They check
  the Excel workspace with long FindsBeacon URLs, the shared evidence pieces,
  and a scan that keeps bare `1fr` value columns and `break-words` out of the
  workspace components. Nine of them fail without the fix.
- **Real browser, production build, all seven tools at 1440, 1024 and 375px:**
  - The test data had long FindsBeacon URLs and IDs both with and without
    hyphens, as Excel cells, hyperlinks, document text and web links.
  - Every change was opened, before and after running AI Change Analyst, and
    every view tab was checked.

| | Before | After |
|---|---|---|
| Evidence panel scrolling sideways (Excel) | up to 824px | 0 |
| Page scrolling sideways, Excel, 375px | 794px | 0 |
| Page scrolling sideways, PDF/DOCX List view, 375px | 373px | 0 |
| Page scrolling sideways, web tools, 1440px / 375px | 172px / 583px | 0 / 0 |

## Found while testing, not changed here

1. **Engine: a web link whose visible text is longer than 200 characters makes
   the web comparison fail.** The link's text becomes the change `label`, which
   the contract limits to 200 characters (`web/compare.py`, `_compare_links`).
   The person sees "DiffNexa can't check pages right now". This is comparison
   logic, so it was left for a separate fix: shorten the label before building
   the change.
2. **DOCX accessibility:** after a comparison, the upload areas and the
   side-by-side panes are both named "Original document" and "Revised
   document". axe reports `landmark-unique` (a best-practice rule, not WCAG
   A/AA). This problem existed before this fix.
