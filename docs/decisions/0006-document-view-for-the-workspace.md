# 0006 — Word and webpage results carry a read-only view of both documents

**Decided:** September 2026, with the Unified Comparison Workspace V2.

## Decision

1. The DOCX and webpage comparison responses gain one additive part, `view`:
   each version's content in reading order, exactly as the comparison
   extracted it, and every piece of evidence as a character span within it.
2. It is built from the same two documents the comparison read, after the
   comparison, by `diffnexa_engine/web/view.py`. It decides nothing: it adds,
   removes or alters no change, and no other part of the response changes.
3. It is presentation data only. It is not part of what AI analysis receives,
   and not part of what the analysis seal covers.
4. PDFs do not get a `view`: the workspace draws their pages from the
   person's own files, in the browser, using the page and position evidence
   the engine already returns.

## Why

- **Evidence in context.** Evidence cites nodes and word tokens, which proves a
  change but shows only a few words ("Delaware." → "New York."). A reader needs
  the sentence around it. Only the engine has the text it compared, so only
  the engine can mark the exact words its evidence cites.
- **Exactly the compared text.** Re-reading the document in the browser would
  produce different text and different word boundaries from the engine's, and
  the highlights would drift. Marks computed from the engine's own tokens
  cannot.
- **Additive and verifiable.** Every existing field is unchanged — a regression
  run of all golden outputs is byte-identical with `view` set aside — so
  nothing that already reads these responses can break.

## Rejected

- *Rendering Word files in the browser* (docx-to-HTML libraries): a heavy new
  dependency, a second reading of an untrusted file, and text that would not
  match the engine's evidence.
- *Estimating Word page numbers*: Word files have no fixed pages; any number
  would be invented.
- *Sending the text to AI for context*: AI analysis stays bounded by the
  evidence contract (decision 0005).
