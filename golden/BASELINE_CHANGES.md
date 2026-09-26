# Golden baseline changes

Every change to golden/baseline.json, with its reason.

## 2026-09-11

Initial Stage 1 baseline: 10 synthetic pairs, extraction checks only (no comparison engine yet).

## 2026-09-12

Stage 2: the deterministic comparison engine now scores the golden suite. Adds five pairs (text-added, text-removed, page-removed, formatting-only, multiple-changes) and records comparison metrics, which were null while no comparator existed. The inserted-page and page-removed expectations were completed to include the text introduced or lost with those pages: the engine reports it with valid evidence, and it is information a reader needs.

## 2026-09-12

Adds the dense-added-page pair: a text-dense inserted page whose evidence cited more words than the excerpt could quote. The page-level change was being discarded as untraceable, so whole added pages vanished from results on content-heavy documents. Recording the pair now that page and block evidence quote exactly what they cite.

## 2026-09-12

W6: adds the webpage golden suite to the shared accuracy ratchet, recording the floor for all 42 web pairs alongside the 16 PDF pairs. Web pairs are prefixed 'web:' and scored on the same four metrics, so a future change cannot silently reduce recall, raise false positives, raise noise leakage or reduce evidence completeness on either tool.

## 2026-09-13

P3: adds the policy golden suite to the shared accuracy ratchet. 29 policy pairs covering all 14 clause topics plus negative and structural cases, scored on the same four metrics as the PDF and webpage suites, so recall cannot fall and false positives, noise leakage or untraceable evidence cannot rise on any of the three tools without failing the build.

## 2026-09-14

Adds link-cloudflare-email-token: Cloudflare re-encrypts email links on every render, so the fragment after /cdn-cgi/l/email-protection# differed between two captures of an unedited page and was reported as a link change. Found on a live page. The pair proves the volatile fragment is normalised away while the link itself stays comparable.

## 2026-09-22

Tool 4 Competitor Monitor: add 21 competitor golden pairs (pricing, plans, features, calls to action, messaging, metadata, links, ordinary content, no-change, uncertain and mixed cases). Every pair scores recall 100%, 0 false positives, 0 noise leakage, 100% evidence; no existing pair changed.

## 2026-09-23

Tool 5 Price Monitor: add 28 price golden pairs (prices in $, €, £, ₹ and INR code; currency, billing period, sale, original/MRP, plan, product, availability and price-table changes; negative pairs proving that user limits, trial lengths, uptime, customer counts and warranty years are never labelled as prices; no-change, Cloudflare token and mixed cases). Every pair scores recall 100%, 0 false positives, 0 noise leakage, 100% evidence; no existing pair changed.

## 2026-09-23

Tool 6 DOCX Compare: add 27 DOCX golden pairs (real Word documents: paragraphs added/removed/reworded, headings added/renamed/re-levelled, bulleted and numbered list items added/removed/edited, a numbered-list insertion Word renumbers itself, a paragraph that became a list item, tables added/removed, rows added/removed, a cell amount, a cell date, an added column, numbers, dates, three values in one paragraph, a link, the title property, a moved paragraph, formatting-only and no-change). Every pair scores recall 100%, 0 false positives, 0 noise leakage, 100% evidence, with each change in its expected group and its evidence at its expected location. No existing pair changed its score.

## 2026-09-23

Excel Compare V1: add 33 Excel golden pairs (real workbooks saved by a spreadsheet application with stored formula results: text, number, date, formula and calculated-result changes; added and removed cells, rows, columns and sheets; a sheet rename and a sheet reorder; a moved row; blank rows inserted; hyperlinks; currency, percentage and text dates; format-only; multiple sheets and a mixed revision; a 3,000-row workbook; and six files that must be refused: truncated, legacy .xls, macro-enabled .xlsm, zip bomb, path traversal and external entity). Every pair scores recall 100%, 0 false positives, 0 noise leakage, 100% evidence, each change in its expected group and at its expected sheet and cell. No existing pair changed its score.

## 2026-09-23

Add 33 AI Change Analyst golden cases: grounded explanations shown, ungrounded statements withheld, invented changes refused, failures contained (additions only; no existing pair changes)

## 2026-09-24

Add three DOCX pairs: capitalisation-only and punctuation-only pin the default matching options behind Ignore options; pages-long-document checks every change's page against a LibreOffice rendering of two 135-page documents.

## 2026-09-26

Add policy pair terms-revision: a realistic terms update (refund window, cancellation notice, governing law, new clause, freshness line) that is also Policy and Terms Monitor's built-in Try example.
