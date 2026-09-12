"""Check that every piece of evidence really points into the source documents.

The contract in `changes.py` guarantees evidence has the right *shape*. This
module checks it against the actual extracted documents:

* the page exists in that document,
* every cited word ID exists on that page,
* the bounding box lies inside the page,
* the excerpt agrees with the cited words (when both are given),
* the result refers to these exact documents (matching SHA-256 fingerprints).

Any issue means the evidence can't be traced, so the golden suite fails.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from diffnexa_engine.contracts.changes import ComparisonResult, Side
from diffnexa_engine.model.document import Document


@dataclass(frozen=True)
class TraceIssue:
    change_id: str
    message: str


def normalize_text(value: str) -> str:
    """Normalise for comparison only: Unicode compatibility form + single spaces."""
    return " ".join(unicodedata.normalize("NFKC", value).split())


def verify_traceability(result: ComparisonResult, old_doc: Document, new_doc: Document) -> list[TraceIssue]:
    issues: list[TraceIssue] = []
    docs = {Side.OLD: old_doc, Side.NEW: new_doc}
    refs = {Side.OLD: result.old_document, Side.NEW: result.new_document}

    for side, doc in docs.items():
        if refs[side].sha256 != doc.source.sha256:
            issues.append(TraceIssue("*", f"result does not refer to this {side.value} PDF"))

    indexes = {side: doc.word_index() for side, doc in docs.items()}

    for change in result.changes:
        for ev in change.evidence:
            if ev.scope == "document":
                continue
            doc = docs[ev.side]
            assert ev.page is not None  # guaranteed by the contract
            if ev.page > doc.page_count:
                issues.append(TraceIssue(change.id, f"page {ev.page} missing from {ev.side.value} PDF"))
                continue
            page = doc.page(ev.page)
            words = []
            for word_id in ev.word_ids:
                word = indexes[ev.side].get(word_id)
                if word is None or not word_id.startswith(f"p{ev.page}-"):
                    issues.append(
                        TraceIssue(
                            change.id,
                            f"word {word_id} not found on page {ev.page} of {ev.side.value} PDF",
                        )
                    )
                else:
                    words.append(word)
            if ev.bbox is not None and not ev.bbox.within(page.width, page.height):
                issues.append(
                    TraceIssue(change.id, f"bbox lies outside page {ev.page} of {ev.side.value} PDF")
                )
            if ev.excerpt and words:
                cited = normalize_text(" ".join(w.text for w in words))
                excerpt = normalize_text(ev.excerpt)
                if cited not in excerpt and excerpt not in cited:
                    issues.append(TraceIssue(change.id, "excerpt does not match the cited words"))
    return issues
