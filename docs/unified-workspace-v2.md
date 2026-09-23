# Unified Comparison Workspace V2

Every DiffNexa tool now shows its finished comparison in one shared screen:
PDF Compare, DOCX Compare, Excel Compare, Website Change Detector, Policy and
Terms Monitor, Competitor Monitor and Price Monitor, with AI Change Analyst as
an optional second step. The comparison engines are unchanged, no tool was
rebuilt, and no new tool was added.

In plain words: whichever tool you use, you now see the same thing. Changes
are listed on the left, the two versions sit side by side in the middle, and
the evidence for the chosen change is on the right. Choosing a change anywhere
moves everything to it.

---

## The screen

```
┌ Comparison complete · <tool>          Original / Revised / Address …   [AI Analysis · optional] ┐
│ N changes found                                                                                  │
│ 3 Values · 2 Dates · …                                                                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Summary (the tool's own: page map, section map, policy topics, competitor signals, price kinds) │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Side by side | List]  [Search]  [Filters]  [Clear filters]     Change 3 of 12  [← Previous][Next →]│
├──────────────┬─────────────────────────────────────────────────┬─────────────────────────────────┤
│ CHANGES      │ ORIGINAL                │ REVISED               │ Change 3 of 12                  │
│ Page 2       │                         │                       │ Value changed                   │
│ #1 Value …   │  (the tool's viewer —   │                       │ Page 2 · Values                 │
│ #2 Date …    │   PDF pages, Word text, │                       │ ┌ COMPARISON EVIDENCE ────────┐ │
│ #3 …         │   webpage text, or      │                       │ │ Original 627 · Revised 654  │ │
│              │   Excel grids)          │                       │ │ quoted from each version    │ │
│              │                         │                       │ └─────────────────────────────┘ │
│              │                         │                       │ ┌ AI EXPLANATION · optional ──┐ │
│              │                         │                       │ └─────────────────────────────┘ │
├──────────────┴─────────────────────────────────────────────────┴─────────────────────────────────┤
│ How the result was produced (no AI was used in the comparison)                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ OPTIONAL · SECOND STEP — AI Change Analyst                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Desktop (1280px and wider):** three panes — changes, both versions,
  evidence.
- **Laptop (1024–1279px):** changes beside the versions; evidence under them.
- **Tablet and phone:** stacked in this order — changes, the versions, the
  evidence, then AI Change Analyst. On a phone one version is shown at a time
  with an **Original / Revised** switch; when a change exists in only one
  version (added or removed), that version is shown automatically. The
  toolbar only stays pinned to the top of the screen on tablets and larger,
  and the tool's summary starts folded on a phone.

Nothing scrolls sideways at any width; wide tables and spreadsheets scroll
inside their own pane.

## Each navigator entry

`#3 ± Value changed · [Values]` — the number, the kind of change, and an
optional category — then **where it is**, then a short **context**: the value
before and after, or a few words of the text.

Where a change is uses the most reliable place each tool genuinely has:

| Tool | Place shown | Never shown |
|---|---|---|
| PDF | The page the engine recorded ("Page 2", "Page 2 → 3", "Page 4 (previous version)"). | An estimated page. A change with no recorded page says "Location not recorded". |
| DOCX | The headings above the change ("Supplier Agreement › Payment Terms"); a changed heading is named by what it says. Word's own position ("Paragraph 18", "Table 1, row 2, column 2") is a labelled secondary detail: *"Paragraphs are counted from the start of the document; Word files have no fixed page numbers."* | Page numbers. A Word file has no fixed pages. |
| Excel | Sheet and cell ("Pricing · F5 (was F4)"), row or column. | — |
| Website, Policy, Competitor, Price | The page's own headings ("Pricing › Enterprise"), "Whole page" for the title and other page details, or "Before the first heading". | Page numbers. A webpage has none. |

## Choosing a change

A change becomes active when it is chosen in the navigator, with
**Previous/Next**, with the **↑/↓ arrow keys** inside the navigator, from a
card in the List view, or from AI Change Analyst's **View change**. Then:

- the navigator highlights it and keeps it in view (inside its own pane — the
  page itself does not jump);
- both versions move to it:
  - **PDF** turns each document to the page its evidence is on and outlines
    the words where the engine found them, numbered;
  - **DOCX and webpages** scroll each version's text to the marked words;
  - **Excel** opens the sheet on both sides and outlines the cell;
- the evidence panel shows what proves it.

A change that exists in only one version says so in the other ("Not in the
original: this was added in the revised version") and that side stays where
it is — it is never moved to a guessed place.

## Evidence first, AI second

The evidence panel has two labelled sections, always in this order:

1. **Comparison evidence** — what DiffNexa detected (the value before and
   after, and the difference it calculated) and each version's words, quoted,
   with where they are. *"Detected by DiffNexa's comparison and read directly
   from both versions. No AI was used."*
2. **AI explanation · Optional · second step** — nothing until the person
   asks for AI analysis. Then, for the active change, the checked explanation
   and why it may matter, with *"Written by … and checked by DiffNexa against
   the comparison evidence. The evidence above remains the source of truth."*
   If AI did not explain that change, it says so.

AI Change Analyst itself sits under the workspace, reached from the header's
**AI Analysis · optional** link. It behaves exactly as before: it checks
availability first, sends only the sealed comparison result (never files,
never the document text), and nothing it says changes the comparison.

## Filters and search

**Filters** offers only what the tool supports *and* what it found: the kind
of change (added, removed, changed, moved) and what changed (the tool's own
categories — PDF's Content/Values/Dates/Pages, the website categories, DOCX's
groups, Excel's cell kinds and sheets). Each tool's summary is also a filter:
the PDF page map, the website section map, the 14 policy topics, the
competitor signals and the price categories. Choosing within one group means
"any of these"; choosing in two groups means "both".

Filters only narrow the list. The counter says so ("Change 2 of 4 shown · 12
in total"), **Clear filters** and **Show all changes** bring everything back,
and a change asked for from AI Change Analyst clears any filter hiding it.
Minor differences (a page number, a visitor counter) are set aside, counted,
and shown with **Include N minor differences**.

## Views

| Tool | Views |
|---|---|
| PDF | **Pages** (both PDFs drawn from the person's own files, in their browser, with PDF.js) · **List** |
| DOCX | **Side by side** (both documents' text as compared, with changes marked) · **List** |
| Excel | **Grid** · **Diff** · **Details** (unchanged) |
| Website, Policy, Competitor, Price | **Side by side** (the baseline and the page now as compared, with changes marked) · **List** |

The List view is each tool's existing change cards, including the policy
topic tags, competitor signal reasons and price category reasons.

A view is only offered when it can be drawn: PDF pages need the two files,
which stay in the browser tab; if they are gone, only the List view is
offered. Side by side for Word and webpages needs the new `view` part of the
result (below); a result without it shows the List view.

## What changed underneath

### Engine (additive only)

DOCX and every webpage result now carry a read-only `view`: each version's
content in reading order — headings, paragraphs, list items, table cells —
exactly as the comparison extracted it, plus every piece of evidence as a
character span within it ("marks"). See `diffnexa_engine/web/view.py` and
[decision 0006](decisions/0006-document-view-for-the-workspace.md).

```json
"view": {
  "original": { "nodes": [{ "id": "n29", "role": "paragraph", "text": "…the State of Delaware.", "section": ["Terms", "Governing law"] }], "fields": { "metadata.title": "Terms" } },
  "revised":  { "nodes": [ … ], "fields": { … } },
  "marks": [{ "change": "c3", "side": "revised", "node": "n29", "start": 55, "end": 64 }]
}
```

Nothing else in any response changed: a regression run of all 197 golden
outputs (PDF, DOCX, Excel, website, policy, competitor, price) against the
previous commit is byte-identical once `view` is set aside. The `view` is not
part of what AI analysis receives or what the seal covers.

### Website

| File | Role |
|---|---|
| `src/components/workspace/ComparisonWorkspace.tsx` | The shared screen: header, summary, toolbar, filters, navigator, evidence panel, AI slot |
| `src/components/workspace/AIExplanation.tsx` | The optional, labelled AI section of the evidence panel |
| `src/components/workspace/SideBySide.tsx` | Two versions side by side; Original/Revised switch on phones |
| `src/components/workspace/PdfPagePane.tsx` | A PDF page drawn from the person's file, with evidence outlines, page and zoom controls |
| `src/components/workspace/DocumentFlowPane.tsx` | Word/webpage text as compared, with changes marked |
| `src/components/workspace/FlowView.tsx`, `EvidenceBits.tsx`, `ChangeList.tsx` | Shared pieces: side-by-side text, evidence quotations, the List view |
| `src/components/website/WebWorkspace.tsx` | The workspace for the four webpage tools |
| `src/lib/workspace.ts` | Shared state logic: search, filters, grouping, stepping |
| `src/lib/content-view.ts` | Reading the engine's `view`: marks, tables, block text |
| `src/lib/pdf-view.ts`, `src/lib/scroll.ts` | Opening a PDF for drawing; scrolling a pane without moving the page |
| `report.ts`, `docx-report.ts`, `web-report.ts`, `excel-report.ts` | Each tool's adapter to the shared change shape |

Each tool's existing report component (`ComparisonReport`, `DocxReport`,
`WebReport`, `PolicyReport`, `CompetitorReport`, `PriceReport`,
`ExcelWorkspace`) is now a thin adapter over the workspace, so the pages and
desks that use them changed only to pass the files and the AI analysis
through. The tool pages give the workspace the full width of the screen (up
to 92rem); their text stays at reading width. Titles, descriptions and
canonical addresses are unchanged.

## Privacy and security

- PDFs are drawn from the file the person chose, inside their browser. Nothing
  is uploaded again to draw a page; PDF.js runs in its worker with scripting
  and XFA forms off.
- The Word and webpage text in `view` is returned only to the browser that
  asked for the comparison, is not stored, and is not logged.
- AI requests still go browser → this site → engine → AI provider, carrying
  only the sealed comparison parts; the document text never goes.

## Known limitations

- PDF pages are drawn at "fit width"; on a phone that is small. Zoom is
  available, and the evidence panel always quotes the exact words.
- The PDF outline is the position the engine recorded for the cited words; a
  change without recorded positions (a whole page added, for example) turns
  to its page without an outline.
- Word and webpage "Side by side" shows the text as compared, not a
  reproduction of the original layout; the pane says so. Formatting, images
  and page layout are not shown because they are not compared.
- Scrolling of the two versions is synchronised by change (both move to the
  active change), not line by line. Excel keeps its own row-by-row
  "Scroll both workbooks together".
- AI Change Analyst's own wording for a Word location still reads "Paragraph
  3, under “Payment Terms”" — that text comes from the AI layer's facts,
  which were deliberately not changed in this stage.
