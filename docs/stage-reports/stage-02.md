# Stage 2 report — Deterministic comparison engine

**Completed:** 12 September 2026 · **Commit:** 5f3a54d

## Results

| Check | Result |
|---|---|
| Engine tests | 216 passed |
| Web tests | 38 passed |
| Golden suite | 15 pairs, 0 failures, 0 regressions |
| Lint, format, types, build | All clean |
| Clean-clone verification | All of the above re-run from a fresh checkout |

## Proven end to end

A real comparison through the website's own API, engine running separately:

```
counts: {'total': 4, 'meaningful': 4} | pages 3 -> 3 | 89 ms
  NUMBER_CHANGED  Total Vacancies     '627' -> '654'   +27 (+4.31%)  p2->p2
  NUMBER_CHANGED  Maximum age         '30'  -> '32'    +2 (+6.67%)   p2->p2
  DATE_CHANGED    Last date to apply  '30 September 2026' -> '15 October 2026'  15 days later
  TEXT_ADDED      (page 2)            'Reservation for reserved categories...'
```

Error paths verified through the same API: a non-PDF returns `not_pdf`, a
password-protected file returns `password_protected`, identical files return
zero changes, and scanned documents return `ocrRequired: true` with no invented
text.

## Bugs found by the tests during this stage

1. `2026` parsed as `202` — regex alternation not grouped between lookarounds.
2. Correct changes were silently dropped because evidence excerpts did not
   contain the words they cited. The traceability safety net caught it.
3. Dates split into two number changes; now resolved across the whole line.
4. A moved sentence made pages look swapped; greedy page matching replaced with
   order-preserving alignment.
5. Paragraph detection failed on sparse pages; line-spacing estimation now uses
   clustering with a font-size fallback.

## Known limitations

Documented with tests in `docs/comparison-algorithm.md`: tables are read as
ordinary text, scanned pages need OCR, heavily rewritten paragraphs are reported
as removal plus addition, complex multi-column layouts may read out of order,
right-to-left scripts are unsupported, and page reordering needs near-identical
content.

## Not built, by instruction

AI, accounts, billing, notifications, monitoring tools, admin, deployment.
