# AI Change Analyst — V1

Tool #8. After any DiffNexa comparison, the person can click **Analyze Changes
with AI** to get a plain-language explanation of the changes the comparison
found.

**AI Change Analyst explains deterministic DiffNexa changes. It does not
independently perform document comparison.**

```
FIND THE CHANGE     deterministic engine (unchanged)
PROVE THE CHANGE    evidence on every change (unchanged)
EXPLAIN THE CHANGE  AI Change Analyst — only what was found and proved
```

There is no chat, no free-text question, no database, no account, no history
and no automatic AI call. Nothing is sent to an AI service until the person
clicks the button, and the comparison on screen is never changed by it.

---

## Architecture

```
Browser                         Website server (Next.js)             Engine (Python)                AI service
───────                         ────────────────────────             ───────────────                ──────────
Compare ─────────────────────▶  /api/<tool>/compare  ──────────────▶ /v1/<tool>/compare
        ◀── result + seal ────  adds x-diffnexa-analysis-seal         (deterministic, unchanged)

"Analyze Changes with AI"
  { tool, seal, result } ────▶  /api/ai/analyze
                                  rate limit (3/min, 20/h)
                                  seal check  ── refuses anything
                                                 else, engine never
                                                 called
                                  ────────────────────────────────▶ /v1/ai/analyze
                                                                      shared secret, size cap,
                                                                      busy guard, daily ceiling
                                                                      adapters → facts
                                                                      select + batch
                                                                      prompt ─────────────────────▶ model
                                                                      validator ◀── JSON reply ─────
        ◀── analysis ─────────  ◀─────────────────────────────────── grounded analysis
View change → the report's own navigation (no second viewer)
```

Code:

| Place | What |
|---|---|
| `apps/engine/diffnexa_engine/ai/facts.py` | Input contract: deterministic facts only |
| `ai/adapters.py` | Each tool's published result → facts; refuses unreadable evidence |
| `ai/prompt.py` | Instructions, facts and untrusted document text, kept apart |
| `ai/providers.py` | `AIAnalysisProvider` interface; Gemini and OpenAI-compatible |
| `ai/validate.py` | The deterministic check every AI statement must pass |
| `ai/analyst.py` | Selection, batching, grounded analysis, daily ceiling |
| `ai/config.py`, `ai/errors.py` | Settings and user-facing errors |
| `service/app.py` | `POST /v1/ai/analyze`, `/healthz` reports `ai.available` |
| `apps/web/src/lib/analysis.ts` | Browser-safe: payload, types, wording |
| `apps/web/src/lib/analysis-seal.ts` | Server-only: seals results, checks seals |
| `apps/web/src/app/api/ai/analyze`, `/api/ai/status` | The proxy and the availability check |
| `apps/web/src/components/analysis/` | The panel, and the per-result wrapper |
| `apps/web/src/lib/use-change-focus.ts` | The "View change" request type; since the Unified Comparison Workspace V2 the workspace itself handles it (see unified-workspace-v2.md) |

The existing rule still holds and is still enforced by
`tests/test_ai_boundary.py`: nothing in `diffnexa_engine/ai/` imports or builds a
`Change` or `Evidence`. The analyst reads the results tools already publish and
returns text keyed by their change IDs; it cannot add, alter or remove a change.

The Stage 1 `AIAnnotation` type (PDF `ComparisonResult` only, with a confidence
number) is left as it was. The analyst does not use it: it covers every tool,
and it deliberately has no confidence score, because a model's self-reported
confidence is not evidence.

## Supported tools

All seven. Each tool already publishes every change with its ID, its values
and its evidence, and an adapter restates them as facts:

| Tool | Location given to the reader and the model | Deterministic classification passed on |
|---|---|---|
| PDF Compare | Page numbers ("Page 2", "Original page 1 · revised page 2") | — |
| Website Change Detector | Section headings, or the page title/description | — |
| Policy & Terms Monitor | Section headings | Policy topic (keyword/heading rules) |
| Competitor Monitor | Section headings | Competitor signal and its reason |
| Price Monitor | Section headings | Price category and its reason |
| DOCX Compare | Paragraph and table-cell positions as DOCX Compare reports them (never page numbers) | Group |
| Excel Compare | Sheet and cell ("Pricing · F5 (was F4)") | Group; formulas with their stored results |

Changes the comparison classed as noise (a visitor counter, a timestamp) are
never sent, and the analysis says how many were left out.

If a result cannot be read with its evidence intact — a change with no
evidence, evidence with no location, an unknown side — the whole request is
refused (`ai_bad_request`). No adapter guesses a location.

## Sealing: only DiffNexa's own results reach the AI

When the website's server passes a comparison result from the engine to the
browser, it adds a seal (response header `x-diffnexa-analysis-seal`): an
HMAC-SHA256 of the parts of the result analysis uses, keyed by a value derived
from `ENGINE_SHARED_SECRET`. When analysis is requested, the server recomputes
it and refuses anything that does not match.

So a changed value, an invented change, a result from another tool, or any
other text is refused before the engine is even called, and the AI endpoint
cannot be used as a general-purpose AI service. Nothing is stored: the seal
travels with the result. Result bodies are not changed by sealing.

Only these parts are sealed and sent (`analysisPayload`): the changes, the
counts, the engine version, and where a tool needs them its groups (DOCX,
Excel), sheet pairings (Excel) or policy topics (Policy). Excel's cell grids,
file fingerprints and timings are never sent.

## Input contract (to the model)

Built by `prompt.py` from the facts. For each change in a batch:

```json
{
  "change_id": "c2",
  "change_type": "Number changed",
  "where": "Table 1, row 2, column 2, under “Vacancies”",
  "original": "627",
  "revised": "654",
  "difference": "+27 (+4.31%)",
  "classifications": ["Group: Tables"],
  "details": ["Original formula: =SUM(...) (stored result: $31,127.80)"],
  "evidence": [{ "ref": "c2.e1", "side": "original", "where": "...", "excerpt": "627" }]
}
```

Evidence references are `<change id>.e<n>`: the n-th evidence item the
comparison recorded for that change. No new evidence system: they point at the
existing evidence. Long values and excerpts are clipped in the prompt (600
characters, marked `[…]`); the facts keep the full text.

The prompt has three separate parts:

1. **Instructions**: fixed text, sent as the system instruction. No document
   text ever goes in it.
2. **Deterministic facts**: the changes above.
3. **Untrusted document text**: values and excerpts, JSON-encoded inside a
   data block whose boundary carries a random marker made fresh for every
   request, so text in a document cannot close the block. The model is told
   the block is data, never instructions.

## Output contract (from the model)

One JSON object, validated before anything is shown:

```json
{
  "summary": [{ "text": "…", "change_ids": ["c2", "c3"] }],
  "changes": [{
    "change_id": "c2",
    "significance": "important | notable | minor | unclear",
    "explanation": "…",
    "why_it_may_matter": "…",
    "evidence_refs": ["c2.e1", "c2.e2"]
  }]
}
```

Significance is practical relevance, never a risk score: important (amounts,
dates, deadlines, quantities, conditions, obligations, rights, substantial
additions or removals), notable, minor, or unclear. When the documents don't
show why a change matters, the model must say "Impact could not be determined
from the documents."

## What the website receives

`POST /v1/ai/analyze` returns:

| Field | Meaning |
|---|---|
| `status` | `complete`, `partial` (some changes unexplained), `nothing_to_explain` (no changes, or only noise; no AI call made) |
| `coverage` | total, noise excluded, eligible, analysed, the IDs not analysed, whether a priority selection was needed |
| `summary` | validated sentences, each with the change IDs it is based on |
| `changes[]` | per change: `comparison` (the deterministic facts: type, location, original, revised, difference, classifications, evidence) and `analysis` (the validated AI text and its evidence references), side by side |
| `references` | the type and location of every change cited, for "View change" links |
| `unchanged` | deterministic statements of what did not change (below) |
| `withheld` | how many AI statements failed validation, by reason |
| `limitations` | always includes the fixed limitation sentence |
| `usage` | provider calls, tokens, milliseconds |

"What did not change" is written only where the deterministic result supports
it: Excel (sheets present in both workbooks with no change), DOCX (groups with
no change) and Policy (topics present on the page that no change touches). For
PDF and webpages the section is left out, because page and section numbering
can shift and a safe statement cannot be made.

## Grounding validation

`validate.py` decides what may be shown, without AI.

**The whole reply is refused** (`ai_invalid`) when it is not one JSON object
of the agreed shape, or when **any** statement cites a change ID that was not
sent in that request. A reply that invents a change has told us not to trust
the rest of it.

**A single statement is withheld** (not shown, and counted) when:

| Reason | Rule |
|---|---|
| `missing_evidence_reference` | an explanation cites no evidence |
| `invalid_evidence_reference` | it cites evidence that does not exist or belongs to another change |
| `unverified_number` | it states a number that is not in the cited facts, and is not the plain difference between an original and a revised number of the same change |
| `unverified_quotation` | it quotes words that are not in the cited facts |
| `unsupported_judgement` | it gives a verdict of its own: legal (illegal, violates, unenforceable, unfair, legal risk), safety (dangerous, fraud), shopping (better/worse deal, best price, buy), recommendation ("you should", "we recommend"), motive ("the company wants to"), ranking ("outperforms"), risk scores ("87/100"), or predicted business effects ("will increase revenue"). Such words may appear only inside a quotation of the documents, verified word for word; a document cannot license them, not even by containing an instruction to say them |
| `shows_internal_id` | it shows an internal change ID or evidence reference to the reader |
| `duplicate_explanation` | a second explanation for the same change |

If every statement is withheld, the analysis is refused (`ai_invalid`). Unknown
extra fields in a reply are ignored and never shown.

The website shows an AI statement only if it came back through this check. An
independent re-check of every shown statement's grounding runs in the golden
suite.

## Limits and cost

| Setting (engine) | Default | Purpose |
|---|---|---|
| `DIFFNEXA_AI_MAX_CHANGES` | 100 | most changes explained in one analysis |
| `DIFFNEXA_AI_BATCH_SIZE` | 25 | changes per AI call (so 4 calls at most by default, 3 at a time) |
| `DIFFNEXA_AI_MAX_OUTPUT_TOKENS` | 8192 | per call |
| `DIFFNEXA_AI_TIMEOUT_SECONDS` | 45 | per call |
| `DIFFNEXA_AI_DAILY_LIMIT` | 200 | analyses per day for the whole engine, all visitors together |

Website: `ai-analyze` rate limit **3 a minute and 20 an hour** per visitor,
stricter than every comparison bucket. A double click never sends twice (the
button is disabled, the site refuses a second identical request while one is
running with `ai_busy`, and so does the engine). An analysis is kept on the page
once done; it is not requested again.

With more changes than the limit, the choice is deterministic and stated:
changes with a classification, and changes to numbers, dates, identifiers,
prices, formulas, links, tables, pages and structure, come first; then the
rest, in reading order. The page always says "AI analysis covered X of Y
detected changes." A comparison with no changes, or only noise, is answered
without calling any AI service.

Each analysis writes one line to the engine's log, for following usage and
cost: tool, number of changes, calls, input and output tokens, time. It never
contains a prompt, a reply, a value or an excerpt.

## Privacy

- Nothing is sent to an AI service unless the person clicks **Analyze Changes
  with AI**. The panel says, before the click, exactly what will be sent.
- What is sent is the comparison's changes and the short evidence excerpts
  behind them. The person's complete files are never sent, and Excel's cell
  grids are never sent.
- Nothing is stored. There is no database, and no analysis history.
- No prompt, reply or document text is logged by the website or the engine.
  Tests check the website route, the engine endpoint and their error paths.
- **Choosing the provider account matters.** Google's Gemini API terms say that
  on its free (unpaid) tier, prompts and responses are used to improve Google's
  products and may be read by human reviewers, and that sensitive, confidential
  or personal information must not be submitted. On the paid tier they are not
  used to improve products. Because DiffNexa's users may upload confidential
  documents, **only switch AI on for real users with a billing-enabled (paid)
  Gemini project**, or another provider whose terms you have checked. The free
  tier is suitable only for your own testing with non-confidential documents.

## Security

- The AI key exists only in the engine's environment. It is never in the
  browser, a `NEXT_PUBLIC_` variable, a response, an error message or a log.
  Providers send it only as a request header, over HTTPS, and never follow
  redirects (so it cannot be replayed to another host).
- `/v1/ai/analyze` is behind `ENGINE_SHARED_SECRET` like every `/v1` route
  (401 without it, 403 with a wrong one).
- The browser only ever calls this website. Tested in a real browser: no
  request went to the engine or the AI service directly.
- Size caps: 3 MB at the website, 4 MB at the engine, 5,000 changes per result,
  4,000 characters per field.
- Prompt injection: document text is data inside a marked block; the fixed
  instructions say so; and whatever the model does, the validator refuses
  invented changes and withholds verdicts, invented figures and invented
  quotations. Golden cases cover a document that tells the model to add a
  change, to call a clause illegal and to give a risk score.

## Failure handling

AI failure is an enhancement failure, never a comparison failure. Every code
comes from `packages/contracts/errors.json` (`ai_messages`), and the panel adds
"The comparison above is complete and has not changed."

| Code | When | Try again offered |
|---|---|---|
| `ai_unavailable` | AI is not configured, or the engine is unreachable | yes |
| `ai_timeout` | the AI service did not answer in time | yes |
| `ai_failed` | the AI service failed, refused, or hit its output limit | yes |
| `ai_invalid` | the reply could not be validated against the evidence | yes |
| `ai_busy` | the same analysis is already running | yes |
| `ai_limit_reached` | the engine's daily ceiling is reached | no |
| `ai_unverified` | the result's seal does not match | no: run the comparison again |
| `ai_bad_request`, `ai_unsupported`, `ai_too_large` | not an analysable result | no |

When some batches succeed and others fail, the successful explanations are
shown, the analysis is marked partial, and the unexplained changes are counted.

When AI is not configured, the panel says "AI analysis isn't available on this
site right now" and offers no button. Every comparison works as before.

## Determinism

The comparison engines are untouched. Tested:

- all 197 deterministic outputs of all seven tools' golden pairs are
  byte-identical to the baseline commit;
- the PDF, DOCX and Excel compare endpoints return identical results with AI
  off, on, failing, and after an analysis has run;
- the comparison result object is never modified by the analyst, whatever the
  model does (valid, failing, malformed, hallucinating), for every tool.

## Setting it up (what you need to do)

1. Create a Gemini API key in Google AI Studio, in a Google Cloud project with
   **billing enabled** (see Privacy above).
2. On the engine host (Render), add:
   - `DIFFNEXA_AI_PROVIDER` = `gemini`
   - `DIFFNEXA_AI_API_KEY` = your key
   - optional: `DIFFNEXA_AI_MODEL` (default `gemini-3.5-flash-lite`, described by
     Google as its fastest, most cost-effective current model), and the limits
     in the table above.
3. On the website host (Hostinger), nothing new is required.
   `ENGINE_SHARED_SECRET` must already be set; it also keys the seals.
   Optional: `ENGINE_AI_TIMEOUT_MS` (default 150000).
4. Check `GET /healthz` on the engine shows `"ai": {"available": true}`, then run
   a comparison and click **Analyze Changes with AI**.

To use another provider with an OpenAI-compatible API instead:
`DIFFNEXA_AI_PROVIDER=openai_compatible`, `DIFFNEXA_AI_API_KEY`,
`DIFFNEXA_AI_MODEL`, and `DIFFNEXA_AI_BASE_URL` (HTTPS, for example
`https://api.openai.com/v1`).

If anything is missing or unsafe (unknown provider, no key, a non-HTTPS
address), AI stays off and the engine says why at startup, without printing the
key.

## Testing

- Engine: `tests/test_ai_grounding.py` (adapters, prompt separation, validator,
  analyst, non-mutation for all tools), `test_ai_providers.py` (both providers
  against a fake transport; the real transport against a local server for
  timeouts, refused redirects and refused connections; configuration),
  `test_ai_service.py` (auth, payloads, sizes, busy, daily ceiling, logs,
  injection, determinism), `test_ai_golden.py`.
- Golden: `golden/ai-cases/`, 33 cases across all seven tools, scored by
  `diffnexa golden run` with the same four metrics and baseline ratchet as every
  other golden pair. See its README.
- Website: `tests/ai-api.test.ts` (sealing, the proxy, the status route) and
  `tests/analyst-ui.test.tsx` (the panel, and "View change" in the DOCX report
  and the Excel workspace).
- Real browser, production build, real engine, and a local stand-in for an
  OpenAI-compatible AI service, at 1440 px and 375 px, for Excel, DOCX and PDF.
  Checked: analysis, coverage, the withheld statement, "View change" (including
  clearing a filter that hid the change), no overflow, no accessibility
  violations (axe, WCAG 2.1 A/AA), no secret in the page, no direct calls to the
  engine or AI service, one request per click, and the AI service being down.

## Known limitations

- **No real AI service was called during development.** Both providers are
  built to the providers' current documented request and response formats and
  tested against stand-ins; the first live call will be the first real test of
  the network path and of the model's reply quality. Check a few real analyses
  before relying on it.
- The validator catches invented changes, figures, quotations and verdicts. It
  cannot prove that an explanation's wording is a fair description of a change.
  That is why every explanation is shown beside the comparison's own values and
  links to the change.
- The judgement rules are cautious by design. An accurate statement that uses
  a listed word outside a quotation (for example describing a policy that
  mentions "violations") is withheld and counted, never shown.
- Website Change Detector, Policy, Competitor and Price were tested with real
  engine output and golden cases, but not in the browser, because their live
  page capture cannot reach the internet from the development environment.
- The busy guard, the rate limit and the daily ceiling are held in memory, so
  they reset on restart and apply per process.
- Hosting timeouts: an analysis of 100 changes can take up to about a minute and
  a half in the worst case. If Hostinger or Render cut requests off sooner, lower
  `DIFFNEXA_AI_MAX_CHANGES` or `DIFFNEXA_AI_TIMEOUT_SECONDS`.
- One analysis per result per page visit; there is no saved history, by design.

## Future possibilities (not built)

- Show the analysis inside the Excel workspace's details panel next to the
  active change.
- Per-plan AI limits once accounts exist.
- Explanations in other languages.
- A follow-up question about one specific change, still grounded in that
  change's evidence. Not a general chat.
