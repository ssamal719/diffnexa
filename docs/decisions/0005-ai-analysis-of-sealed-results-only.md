# 0005 — AI Change Analyst explains sealed comparison results, checked by a deterministic validator

**Decided:** September 2026, with Tool #8.

## Decision

1. AI Change Analyst is a separate, optional step that reads the comparison
   result each tool already publishes. It never receives documents and never
   compares anything.
2. The website seals every comparison result it returns (an HMAC keyed from
   `ENGINE_SHARED_SECRET`) and forwards a request for analysis only when the
   seal matches. Nothing is stored.
3. Every AI statement must cite change IDs from its own request and evidence
   references from those changes, and passes a deterministic validator before
   it can be shown. A reply that cites a change that does not exist is refused
   whole. A statement with an unverifiable number or quotation, or a verdict of
   its own, is withheld and counted.
4. The provider is behind a small interface. Gemini is the default; any
   OpenAI-compatible service also works. Both use the standard library only.

## Why

- **The engine stays the source of truth.** The analyst only ever sees what the
  engine produced, and the website only ever shows what the validator accepted.
- **Sealing, rather than re-running the comparison or storing results.**
  Re-running would mean uploading the files again (or refetching a page that
  may have changed since). Storing needs a database, which V1 does not have. A
  seal needs neither, and it stops the endpoint being used as a free AI service.
- **A validator, rather than trusting the prompt.** Instructions reduce
  mistakes; only a check made without AI can guarantee that an invented change,
  figure or legal verdict never reaches the reader, including when a document
  contains instructions aimed at the model.
- **The Stage 1 `AIAnnotation` is not reused.** It carries a confidence number
  (a model's self-assessment is not evidence) and belongs to the PDF result
  only. The analyst covers all seven tools and keys everything to the IDs each
  tool already publishes.

## Rejected

- *Sending the documents and asking the model to find differences*: this is
  the architecture DiffNexa exists to avoid.
- *Running AI automatically after every comparison*: it adds cost, it sends
  data nobody asked to send, and it slows every comparison down.
- *Provider-specific JSON schema features*: formats differ between providers
  and change over time. One schema, enforced by DiffNexa's own validator, works
  the same everywhere.
- *A chat box*: out of scope for V1. An open question has no deterministic
  change to be grounded in.
