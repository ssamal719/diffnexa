# Golden test suite

The golden suite is the accuracy referee for DiffNexa. Every pair of PDFs comes
with a written statement of the truth, and every engine change is scored against it.

- `pairs/` — real PDF pairs you add (see `pairs/README.md`).
- `.generated/synthetic/` — generated pairs with exactly known edits. Created
  automatically on every run; not committed.
- `baseline.json` — last accepted scores. Any regression fails the build.
- `BASELINE_CHANGES.md` — the written reason for every baseline change.

Run it from the repository root: `diffnexa golden run`. Reports are written to
`reports/golden/` (open `index.html`).
