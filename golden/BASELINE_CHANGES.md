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
