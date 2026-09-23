# DOCX Compare — V1

Tool #6, at `/docx-compare`. Upload an original and a revised Word document,
and see every change in text, headings, lists, tables, numbers, dates and links,
with evidence pointing to where each one is in both documents.

No AI is involved. No account. Nothing is stored.

---

## The workflow

```
Original document (.docx) + Revised document (.docx)
  → Compare documents
  → browser → POST /api/docx/compare (this site)
            → POST /v1/docx/compare (engine, with the shared secret)
  → report: "N changes found", grouped, with evidence
```

The browser never calls the engine. The engine's address and
`ENGINE_SHARED_SECRET` stay on the website's server (`src/lib/engine-config.ts`,
no `NEXT_PUBLIC_` variable). The person's own filenames are not forwarded: the
website sends the files as `original.docx` and `revised.docx`.

## What is compared

| Content | How |
|---|---|
| Paragraphs | Added, removed, or reworded word by word. |
| Headings | Level preserved (Title = level 1, Heading 1–6, outline levels). Added, removed, renamed. A heading reworded in several places is reported whole. A heading whose words are the same but whose level changed is a **Structure** change. |
| Lists | Bulleted and numbered items, with their level. Word numbers lists itself and the number is not part of the text, so inserting an item does not make later items look changed. A paragraph that became a list item (same words) is a **Structure** change. |
| Tables | Paired by shared cell content, not by position. Rows aligned like paragraphs; columns matched by their header. Table / row / cell added or removed; cell value changed. Merged cells keep their grid column. A nested table is read as part of its cell. |
| Numbers and dates | Typed, with the difference: `627 → 654 (+27)`, `30 September 2026 → 15 October 2026 (15 days later)`. Several values in one paragraph are each reported once. |
| Links | External `http`, `https` and `mailto` links, compared exactly. Tracking parameters are **not** stripped: in a document, the address written is the address meant. |
| Moved content | A paragraph or table that moved is reported as moved. |
| Document properties | Title and subject only, as **Other** changes, kept apart from the body. Author, company, dates and other properties are never read. |

Content controls, smart tags and simple fields are read in place. Hidden text
and field codes are not read; a field's displayed result is.

## What is not compared (and the page says so)

- Visual formatting: fonts, colours, bold, spacing, layout, pagination.
- Images, charts, shapes and text boxes. They are counted and the report says
  "Contains N images or other embedded objects. Their content is not compared."
- Headers, footers, footnotes, endnotes and comments. The report says when a
  document has them. Comment text is never read.
- Imported content (`altChunk`). Reported, not compared.
- **Tracked changes.** V1 takes option B: a document with pending insertions,
  deletions or moves is refused with `docx_tracked_changes` ("Accept or reject
  them in Word, save, then compare again"). Formatting-only revisions do not
  block reading. V1 does not claim to compare tracked changes.
- Legacy `.doc`, macro-enabled `.docm`, templates and password-protected files
  are refused with their own message.

## Groups

Every change is in exactly one group, chosen by a fixed order (containers
before value types):

1. metadata / link / identifier → **Other**
2. layout or moved → **Structure**
3. table or table cell → **Tables**
4. heading → **Headings**
5. list item → **Lists**
6. date → **Dates**
7. number → **Numbers**
8. text → **Text changes**

A changed amount in a table cell is therefore under Tables, still shown with its
before, after and difference. Groups describe what kind of content changed.
Nothing is labelled important, minor, major, better, worse, risky, favorable or
unfavorable, and nothing is hidden as noise (`counts.noise` is always 0).

## Evidence

Every change carries evidence the engine checks before returning it
(`contracts/docx_traceability.py`):

- **Body changes** cite a node: `snapshot_sha256` (the document's content
  fingerprint), `node_id`, the structural `node_path` (`body/p[7]`,
  `body/tbl[2]/tr[3]/tc[2]`, `body/p[15]/hyperlink[1]`), the headings above it,
  the cited word IDs and an exact excerpt. The checker confirms the node exists
  in that document with that path, the word IDs belong to it, and the excerpt is
  its words.
- **Property changes** cite document scope with the field name and value, and
  the checker confirms the value is that document's property.
- Anything that fails the check is dropped and counted in
  `diagnostics.droppedUntraceable` (0 across all tests and golden pairs).

The API adds a reader's `location` to each piece of evidence: "Heading 2,
paragraph 3", "Numbered list item (level 1), paragraph 8",
"Table 2, row 3, column 2", "Link in paragraph 6", "Document properties".
Paragraph numbers count body paragraphs in order, including headings and list
items; tables are not paragraphs.

## Security

Uploaded files are untrusted. Everything is decided from the bytes
(`docx/package.py`):

- Read entirely **in memory**; nothing is written to disk and nothing extracted.
- File ceiling 20 MB (`DIFFNEXA_DOCX_MAX_FILE_MB`), checked on the website and
  again in the engine (read with a hard `max + 1` ceiling).
- Container: OLE files are identified as legacy `.doc` or, if they hold an
  `EncryptedPackage` stream, password protected. Anything else that is not a ZIP
  is refused.
- ZIP: at most 5,000 entries; every member name checked (no absolute paths,
  `..`, backslashes, drive letters, NUL); duplicate names refused; encrypted
  members refused; each part read with its own ceiling (document 40 MB, other
  parts 8 MB) and a 64 MB total, counted on the decompressed bytes as they are
  read — so a ZIP bomb stops at the ceiling.
- Content types: the main part must be exactly the `.docx` document type.
  Macro-enabled types and any `vbaProject.bin` are refused. Macros are never
  run; nothing in the document is executed.
- XML: a hardened parser (no entity resolution, no network, no DTD loading, no
  huge trees), and any `DOCTYPE` or `ENTITY` declaration is refused before
  parsing — no external entities, no entity expansion.
- Relationships are resolved inside the package only. External targets are
  recorded as text (links) and **never fetched**; tests run a local server and
  assert it receives no request.
- At most 20,000 content nodes per document.
- No document text is logged; error details name the problem, never the content.
  Error responses carry only messages from `packages/contracts/errors.json`
  (`docx_messages`) and which document they are about (`original`/`revised`).
- The endpoint requires `ENGINE_SHARED_SECRET` like every `/v1/*` route;
  interactive API docs stay disabled.
- Website: rate limit bucket `docx-compare` (10/minute, 60/hour per client, the
  PDF limits).

## Determinism

The same two documents always give the same response, apart from
`processingMs`. The content fingerprint is computed from the extracted content,
not the file bytes, so the same document saved twice (different ZIP bytes)
compares as identical. Changes are listed in reading order: properties first,
then by position in the revised document (or the original, for removals).

## API

`POST /v1/docx/compare` — multipart, fields `original` and `revised`.

Success (200) — real output for the `table-cell-number` golden pair:

```json
{
  "engineVersion": "0.1.0",
  "processingMs": 38,
  "documents": { "previous": {"sha256": "5a37…", "nodeCount": 36}, "revised": {"sha256": "d8e9…", "nodeCount": 36} },
  "counts": { "total": 1, "meaningful": 1, "noise": 0 },
  "changes": [{
    "id": "c0", "seq": 0, "type": "NUMBER_CHANGED", "kind": "modified", "category": "number",
    "subtype": "table_cell", "label": "Junior Assistant · Vacancies",
    "oldValue": "627", "newValue": "654", "delta": "+27 (+4.31%)", "confidence": 1.0,
    "isNoise": false, "noiseReason": null, "sections": ["Vacancies"],
    "group": "tables", "withinBlock": false,
    "evidence": [{ "side": "old", "scope": "node", "nodeId": "n7", "path": "body/tbl[1]/tr[2]/tc[2]",
                   "sectionPath": ["Vacancies"], "field": null,
                   "excerpt": "627", "location": "Table 1, row 2, column 2" }, "…new side…"]
  }],
  "groups": [{ "id": "text", "label": "Text changes", "changeCount": 0, "changeIds": [] }, "…"],
  "diagnostics": { "notes": [], "previousWarnings": [], "revisedWarnings": [], "droppedUntraceable": 0 }
}
```

`withinBlock` is true when words were added to or removed from a paragraph,
heading or list item that is still there (so the card says "Words added to a
heading", not "Heading added").

Errors: `{"error": {"code", "message", "side"}}` — 400 for an unusable file,
413 when too large, 401/403 without valid credentials. Codes: `docx_not_docx`,
`docx_legacy_doc`, `docx_macro_enabled`, `docx_encrypted`, `docx_unreadable`,
`docx_too_large`, `docx_too_complex`, `docx_tracked_changes`, `docx_empty_file`.

The website route `POST /api/docx/compare` takes the same fields and returns the
same body, or an error with the same shape.

## Code map

```
apps/engine/diffnexa_engine/docx/
  errors.py      error codes and shared messages
  package.py     safe ZIP + XML reading, limits
  model.py       DocxNode (a ContentNode with list kind/level), DocxDocument
  extract.py     styles, numbering, paragraphs, lists, tables, links → nodes
  compare.py     properties, headings, prose, links, tables; reading order
  api.py         groups, locations, withinBlock, response shape
apps/engine/diffnexa_engine/contracts/docx_traceability.py
apps/engine/diffnexa_engine/golden/docx.py
apps/web/src/app/docx-compare/page.tsx
apps/web/src/app/api/docx/compare/route.ts
apps/web/src/components/docx/   DocxDesk, DocxUploadSlot, DocxReport, DocxChangeCard
apps/web/src/lib/docx-report.ts
golden/docx-pairs/               27 pairs + _build/build_pairs.py
```

Headings, paragraphs and list items are compared by Website Change Detector's
own layers (block alignment, rename pairing, word-level diff, typed values),
reused unchanged; a Word node has the same shape as a webpage node.

## A shared fix made in this stage

Building the golden pairs exposed a bug in the date helper shared by the PDF
and webpage engines: it accepted any run of words that *contained* a date, so in
"Maximum age: 30 years. Deadline: 30 September 2026. Vacancies: 627." the age
was swallowed into the date, the date was reported twice and the vacancy change
was lost. The helper now accepts only a run that is the date itself
(`compare/values.py: parse_whole_date`). Effect on the existing 137 golden
pairs: no change added, lost or altered in value; in 8 pairs the date evidence
now cites only the date's words instead of up to six words before it. No score
changed. Covered by `tests/test_date_span.py` for PDFs, webpages and Word.

## Testing

```
cd apps/engine
pytest -q tests/test_docx_extract.py tests/test_docx_security.py \
          tests/test_docx_compare.py tests/test_docx_service.py \
          tests/test_docx_golden.py tests/test_date_span.py
diffnexa golden run          # includes 27 docx: pairs
cd ../web && npm run check   # includes docx-api, docx-report, docx-ui tests
```

Fixtures are real `.docx` files built with python-docx (dev dependency) or
assembled by hand for hostile cases. `tests/fixtures/docx-comparison.json` in the
website tests is real engine output.

## Known limitations

- Word-level changes inside a paragraph quote only the changed words; the
  evidence location says where the paragraph is.
- Paragraph numbers in locations count body paragraphs; they are not Word's page
  or line numbers.
- A table whose content changed almost entirely is reported as one table
  removed and one added.
- Only the main document body is compared.
- Links inside fields (`HYPERLINK` field codes) are read as text, not as links.
