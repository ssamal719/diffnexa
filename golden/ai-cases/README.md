# AI Change Analyst golden cases

Each folder is one case: a deterministic comparison result, a scripted model,
and what DiffNexa must then show. The model is scripted on purpose. What these
cases test is DiffNexa, not a model:

- grounded explanations are shown, tied to the right change IDs and evidence;
- a statement with an invented number, an invented quotation, a legal or
  shopping verdict, a recommendation or an internal ID is **withheld**;
- a reply that explains a change the comparison never found is **refused
  whole**;
- malformed replies, failures, timeouts and cut-off output show an error and
  nothing else, while the comparison stays exactly as it was;
- empty comparisons, and changes the comparison classed as noise, never reach
  the model at all.

## Files

`case.yaml`:

| Field | Meaning |
|---|---|
| `tool` | Which tool's published result is analysed. |
| `source.pair` | A golden pair of that tool. The result is produced live by the deterministic engine, so the case always uses the exact JSON the website receives. |
| `source.crafted` | A result no golden pair has (a prompt injection in the document text, 180 changes), built in `diffnexa_engine/golden/ai_cases.py` in the tool's published shape. |
| `provider.replies` | The model's reply, read from a file in the folder. |
| `provider.raw` | A literal reply (for replies that are not JSON at all). |
| `provider.error` | The call fails: `timeout`, `failure`, `truncated` or `refused`. |
| `provider.echo` | The model faithfully explains exactly what it was sent. |
| `expect` | The outcome, the changes whose explanation must be shown (`explained`) or must not be (`not_shown`), counts, and text that must never be shown (`must_not_display`). |

## Scoring

The same four metrics as every golden pair, so the accuracy ratchet in
`golden/baseline.json` protects these cases too:

- **recall**: the expected outcome, and the expected explanations shown;
- **false positives**: explanations shown that must have been withheld;
- **noise leakage**: forbidden text shown anyway;
- **evidence completeness**: shown statements whose change IDs and evidence
  references resolve in the comparison, re-checked independently of the
  validator.

Run them with everything else: `diffnexa golden run`.
