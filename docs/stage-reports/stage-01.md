# Stage 1 report — Foundation

**Completed:** 11 September 2026 · **Status:** Ready for review

## What this stage delivers

The parts every later stage depends on: the rule that a change must carry
evidence, the document model comparison will read, safe PDF validation and
extraction, the accuracy test system, and the upload interface.

There is no comparison engine yet. That is Stage 3, and the test system reports
comparison as "not run yet" rather than pretending otherwise.

## Results

| Check | Result |
|---|---|
| Engine tests | 123 passed |
| Website tests | 29 passed |
| Code style and formatting | Clean (ruff, ESLint) |
| Type checking | Clean |
| Production build | Succeeds |
| Golden suite | 10 of 10 pairs pass extraction; 0 regressions |

## Proof the tests work

Six deliberate faults were introduced and every one was caught:

| Fault introduced | Caught by |
|---|---|
| Stop correcting rotated pages | 7 tests, including the rotated-page golden pair |
| Ignore cropped (hidden) page areas | 2 tests |
| Disable the evidence checker | 6 tests |
| Change a user-facing message in the shared contract | Both the engine and website contract tests |

## Accuracy problems found and fixed during the stage

1. **Rotated pages were unreadable.** Text on a 90°-rotated page extracted as
   single letters ("S", "e", "c", "ond"). Pages are now read upright and the
   coordinates converted back, so words stay whole.
2. **Hidden text was being read.** Text outside a page's visible (cropped) area
   is invisible in every PDF viewer but was still extracted, which would have
   produced changes nobody could see. It is now excluded and counted in warnings.
3. **PDF.js would have excluded older browsers.** See decision 0001.

## Known limitations

- Reading order, headings, paragraphs and tables come in Stage 2.
- Legacy non-Unicode Indian fonts that decode to plausible-but-wrong Latin text
  are not yet detected; only fully undecodable text is caught.
- No per-file processing time limit yet; it arrives with the server in Stage 2.
- All ten test pairs are generated. Real document pairs are still needed.
- The interface was verified by automated tests and by serving the built site,
  but not by a scripted click-through in a real browser.
