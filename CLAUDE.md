# Working on DiffNexa

Read this before changing anything. It holds for every stage.

DiffNexa compares two versions of a document and explains what changed. Its
value is accuracy and evidence, not features. The founder is not a developer, so
explanations go in plain language and technical decisions are made for them, with
the reasoning stated.

## Rules that are not negotiable

1. **Every change carries evidence.** A detected change must point to a page and
   a location (word IDs and/or a bounding box) in the source PDFs. The contract
   in `apps/engine/diffnexa_engine/contracts/changes.py` enforces this; do not
   weaken it. Metadata changes are the only ones allowed document-level evidence.
2. **AI never invents a change.** The deterministic engine produces every change.
   AI may only attach an `AIAnnotation` to a change that already exists. Code in
   `diffnexa_engine/ai/` must never import or construct `Change` or `Evidence` —
   a test enforces this by scanning the package.
3. **The product works with AI switched off.** AI adds explanations and summaries.
   If it is off, over budget, or failing, comparison still runs and the interface
   says so plainly.
4. **Accuracy before features.** False positives are as serious as missed changes.
   A page-break, line-wrap or page-number difference is noise, not a change.
5. **No fake functionality.** No button that does nothing, no placeholder result
   presented as real, no invented AI output. Unbuilt things are labelled
   "Planned" in the interface.
6. **Never show raw technical errors to users.** Every user-facing message comes
   from `packages/contracts/errors.json`, which the engine and the website are
   both tested against.
7. **No secrets in code.** Configuration comes from environment variables. API
   keys stay server-side and never reach the browser.
8. **Uploaded PDFs are untrusted.** Decide everything from the bytes, never the
   filename or declared type. Apply size, page, time and memory limits.

## Before declaring anything done

- `cd apps/engine && pytest -q` — all tests pass.
- `ruff check . && ruff format --check .` — clean.
- `diffnexa golden run` — no failures and no accuracy regressions.
- `cd apps/web && npm run check` — lint, types, tests and build all pass.
- New comparison behaviour ships with new tests **and** a golden pair.

## The accuracy ratchet

`golden/baseline.json` holds the last accepted score for every pair. A change
that lowers recall or evidence completeness, or raises false positives or noise
leakage, fails the build. Never edit the baseline by hand. To move it:

```
diffnexa golden run --update-baseline --reason "why this is a genuine improvement"
```

The reason is appended to `golden/BASELINE_CHANGES.md`. If you cannot write an
honest reason, the change is a regression, not an improvement.

## Where things live

```
apps/engine/    Python: validation, extraction, contracts, golden suite, CLI
apps/web/       Next.js site: /pdf-compare tool page, design system
packages/       Shared contracts (error messages, JSON schemas)
golden/         Golden pairs, baseline, and the record of baseline changes
docs/           Architecture, testing guide, stage reports
```

## Stage discipline

Build one stage at a time. After each stage, report: what was built, the file
list, what the founder must do, how to test it, test results, known limitations,
and what comes next. Then stop. Do not start the next stage unprompted.

Do not change the approved architecture without explaining the reason and
getting agreement first. Record decisions in `docs/decisions/`.

## Current state

Stage 1 is complete: foundation, evidence contract, OCR-ready document model,
PDF validation and extraction, the golden-test system, the upload interface, and
automated tests. There is no comparison engine yet — that is Stage 3, and the
golden suite honestly reports comparison as "not run yet" until it exists.
