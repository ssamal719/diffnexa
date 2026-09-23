"""Checking that Word document evidence really points into the documents it cites.

The same guarantee the PDF and webpage checkers give: every change's evidence
must be found in the document it is attributed to, or the change is dropped.

A Word document's content nodes have exactly the shape of a webpage's, so their
evidence is checked by the proven webpage checker itself — the fingerprint must
match, the node must exist at the cited path and under the cited headings,
every cited word must be on that node, and the quotation must be what was
cited. What differs is document-level evidence: a Word document has a title
and subject rather than a page address and meta description, so those are read
back from the document here.

Every rule refuses rather than repairs.
"""

from __future__ import annotations

from collections.abc import Iterable

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, Side
from diffnexa_engine.contracts.traceability import TraceIssue
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.docx.model import DocxDocument

PROPERTY_SOURCES = {
    "properties.title": lambda document: document.properties.title,
    "properties.subject": lambda document: document.properties.subject,
}


def _check_property(change_id: str, evidence, document: DocxDocument) -> list[TraceIssue]:
    if evidence.snapshot_sha256 != document.content_sha256:
        return [TraceIssue(change_id, f"property evidence cites a different {evidence.side.value} document")]
    reader = PROPERTY_SOURCES.get(evidence.field or "")
    if reader is None:
        return [TraceIssue(change_id, f"unknown document property {evidence.field!r}")]
    actual = reader(document)
    if actual is None:
        return [TraceIssue(change_id, f"{evidence.field} is not set in the {evidence.side.value} document")]
    if evidence.excerpt and normalize(evidence.excerpt) not in normalize(actual):
        return [TraceIssue(change_id, f"{evidence.field} does not say what the evidence quotes")]
    return []


def verify_docx_traceability(
    changes: Iterable[Change], old_document: DocxDocument, new_document: DocxDocument
) -> list[TraceIssue]:
    """Every reason a change's evidence cannot be found in the Word documents it cites."""
    documents = {Side.OLD: old_document, Side.NEW: new_document}
    issues: list[TraceIssue] = []
    node_changes: list[Change] = []

    for change in changes:
        if any(evidence.scope == "document" for evidence in change.evidence):
            for evidence in change.evidence:
                if evidence.scope != "document":
                    issues.append(TraceIssue(change.id, "a property change cannot also cite content"))
                else:
                    issues.extend(_check_property(change.id, evidence, documents[evidence.side]))
        else:
            node_changes.append(change)

    # Node evidence: the webpage checker reads only the fingerprint, the node
    # index and each node's path, headings, words and text, which a Word
    # document provides in exactly the same form.
    issues.extend(verify_web_traceability(node_changes, old_document, new_document))  # type: ignore[arg-type]
    return issues


__all__ = ["verify_docx_traceability"]
