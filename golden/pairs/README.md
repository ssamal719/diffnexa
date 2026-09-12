# Real golden pairs

Each folder here is one real test case: `old.pdf`, `new.pdf` and `expected.yaml`
describing what truly changed. Start by copying `_template/`.

Rules:

1. Only add documents that are public (e.g. official recruitment notices and
   their corrigenda) or that you have explicit permission to store. This
   repository is private, but test files should still never be confidential.
2. Write down every real change, and nothing that isn't a change.
3. Keep `max_unexpected_changes: 0` unless there is a written reason.
4. After adding a pair, record it in the baseline:
   `diffnexa golden run --update-baseline --reason "Added <pair name>: <why>"`

If editing YAML is inconvenient, send the two PDFs with a plain-language note
of what changed and the expected.yaml can be written for you.
