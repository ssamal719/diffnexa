# Golden baseline changes

Every change to golden/baseline.json, with its reason.

## 2026-09-11

Initial Stage 1 baseline: 10 synthetic pairs, extraction checks only (no comparison engine yet).

## 2026-09-12

Stage 2: the deterministic comparison engine now scores the golden suite. Adds five pairs (text-added, text-removed, page-removed, formatting-only, multiple-changes) and records comparison metrics, which were null while no comparator existed. The inserted-page and page-removed expectations were completed to include the text introduced or lost with those pages: the engine reports it with valid evidence, and it is information a reader needs.
