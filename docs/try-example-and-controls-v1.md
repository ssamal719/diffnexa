# Try Example, Comparison Controls and the Monitoring Desks V1

## What was built

### "Try example" in every tool

Every tool now has a **Try example** button. It needs no account and no files
or addresses of your own. It runs a genuine comparison of two example versions,
then shows a short **How this tool works** guide above the result:

- the steps the tool took;
- what was changed between the two versions;
- how to use it on your own work.

| Tool | Example | What happens |
|---|---|---|
| PDF Compare | A fictional recruitment notice and its corrigendum | Both PDFs are loaded into the slots (marked "Example file") and compared normally |
| Word (DOCX) Compare | A fictional services agreement | Same |
| Excel Compare | A fictional company workbook | Same |
| Website Change Detector | A fictional service agreement page | The engine compares two saved versions; nothing is fetched |
| Policy & Terms Monitor | Fictional terms of service (new golden pair) | Same |
| Competitor Monitor | A fictional competitor's pricing page | Same |
| Price Monitor | A fictional product's pricing page | Same |

Every example is a golden pair, so its changes are verified by the golden
suite. The reasons are in
[decision 0008](decisions/0008-examples-are-golden-pairs.md).

### Ignore options, Export, Reverse and Linked

The toolbar has the same controls in every file comparison tool (PDF, Word,
Excel):

- **Ignore options** — only rules the engine really applies. Applying them
  compares the files again.
  - PDF: *Ignore capitalisation* (on by default) and *Ignore punctuation-only
    changes*.
  - Word: the same two, unchanged.
  - Excel: *Ignore capitalisation* and *Ignore extra spaces* in text cells. Both
    are off by default, so text is compared exactly, as before.

  The panel also lists what is always ignored and what the tool never compares.
- **Export** — a CSV changes table, a printable HTML report or plain text. Each
  is built from the result on screen, with no AI text.
- **Reverse** — swaps the two files in their slots and compares them again.
- **Linked** (on by default) — keeps both versions in step.
  - PDF: turning a page or zooming one version moves the other to the matching
    page, using the page pairs the engine found. Scrolling within the page
    follows too.
  - Excel: replaces the old "Scroll both workbooks together" checkbox with the
    same switch.
  - Word: paragraphs, as before.

The four web monitoring tools get **Export** and **Linked** too. They do not
get Ignore options or Reverse, because both would mean reading the live page
again.

### Web monitoring desks

The four web monitoring tools now use the same two-panel layout as the file
tools:

- **1 · Baseline — the page as it was.**
  - Drop or choose the baseline file you saved. The address and labels fill in
    from it.
  - Or **Capture baseline** from the address in step 2. The captured baseline
    appears in the panel with **Download baseline** and a reminder to keep the
    file.
- **2 · The page to check — read live when you check.** The address, and each
  tool's own labels (policy type, competitor, product, page type).
- **Check for changes** compares them. **Try example** sits beside it.

The old "Capture / Check for changes" tabs are gone. Both halves are visible
at once, so a first-time visitor and a returning one use the same screen.

## Engine changes

- `diffnexa_engine/examples/`: the web example pages, embedded from their golden
  pairs, and `example_comparison(tool)`. The four web compare endpoints accept
  `{"example": true}`.
- PDF comparison: the `ignore_case` and `ignore_punctuation` form fields, echoed
  as `options`. `pageLinks` lists the page pairs.
- Excel comparison: the `ignore_case` and `ignore_whitespace` form fields
  (`ExcelOptions`), echoed as `options`. They apply to text cells, and to the
  row and column matching that uses them.
- New golden pair `policy-pairs/terms-revision`, with the baseline updated and
  its reason recorded.

## How to test it

1. On each tool page, choose **Try example**. The guide appears above the
   result, and the result lists the changes the guide describes.
2. In PDF, Word or Excel:
   - open **Ignore options**, change one and choose **Apply and compare
     again**;
   - choose **Reverse**: the files swap slots and the changes run the other
     way;
   - choose **Export** and open each file;
   - in the PDF Pages view, turn a page in one version: the other follows until
     Linked is off.
3. In a web monitoring tool:
   - enter an address and choose **Capture baseline**, then **Download
     baseline**;
   - later, drop that file on the Baseline panel and choose **Check for
     changes**.

## Known limitations

- Try example needs the comparison service, like any comparison. If it is
  down, the example says so.
- Web monitoring examples compare saved pages. The live-page part of a real
  check is shown by capturing and checking a real address.
- Ignore options for the web tools, and a Word redline export, are not built.
- Linked for PDF moves by page and by position within the page, not by line.
- The comparison rate limit (10 a minute per tool) counts every Apply and
  Reverse as a comparison.
