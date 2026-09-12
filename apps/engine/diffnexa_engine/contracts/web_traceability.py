"""Checking that webpage evidence really points into the snapshots it cites.

The PDF side has `verify_traceability`, which refuses any change whose evidence
cannot be found in the documents it claims to come from. That check has already
earned its place twice: it caught evidence quoting more than it cited, and it
caught whole added pages being described with text that was not there.

This is the same guarantee for webpages, and it is deliberately a separate
function rather than a widened version of the existing one. A page number and a
bounding box are not a node path and a token; conflating them would weaken both.

Every rule below refuses rather than repairs. A change that fails is dropped and
counted, never shown with a caveat.
"""

from __future__ import annotations

from collections.abc import Iterable

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, Side
from diffnexa_engine.contracts.traceability import TraceIssue
from diffnexa_engine.web.snapshot import Snapshot


def verify_web_traceability(
    changes: Iterable[Change], old_snapshot: Snapshot, new_snapshot: Snapshot
) -> list[TraceIssue]:
    """Return every reason a change's webpage evidence cannot be trusted.

    An empty list means every cited node, token and quotation was found in the
    snapshot it was attributed to.
    """
    snapshots = {Side.OLD: old_snapshot, Side.NEW: new_snapshot}
    indexes = {side: snapshot.node_index() for side, snapshot in snapshots.items()}
    issues: list[TraceIssue] = []

    for change in changes:
        for evidence in change.evidence:
            if evidence.scope != "node":
                # Page and document evidence belong to the PDF checker. Seeing it
                # here means a change was built against the wrong source.
                issues.append(
                    TraceIssue(
                        change.id,
                        f"{evidence.scope}-scope evidence cannot describe a webpage",
                    )
                )
                continue

            snapshot = snapshots[evidence.side]

            # 1. The evidence must belong to the snapshot it is being checked against.
            if evidence.snapshot_sha256 != snapshot.content_sha256:
                issues.append(
                    TraceIssue(
                        change.id,
                        f"evidence cites a different {evidence.side.value} snapshot",
                    )
                )
                continue

            # 2 and 3. The node must exist in that snapshot.
            node = indexes[evidence.side].get(evidence.node_id or "")
            if node is None:
                issues.append(
                    TraceIssue(
                        change.id,
                        f"node {evidence.node_id!r} is not in the {evidence.side.value} snapshot",
                    )
                )
                continue

            # The path is part of the evidence a reader is shown, so it must be
            # the node's real path and not a plausible-looking one.
            if evidence.node_path is not None and evidence.node_path != node.path:
                issues.append(TraceIssue(change.id, f"node {node.id} is not at the cited path"))

            if evidence.section_path and tuple(evidence.section_path) != node.section_path:
                issues.append(TraceIssue(change.id, f"node {node.id} is not under the cited headings"))

            # 4. Every cited token must exist on that node.
            tokens = {token.id: token.text for token in node.tokens}
            cited_words: list[str] = []
            missing = False
            for token_id in evidence.token_ids:
                text = tokens.get(token_id)
                if text is None:
                    issues.append(TraceIssue(change.id, f"token {token_id} is not on node {node.id}"))
                    missing = True
                else:
                    cited_words.append(text)
            if missing:
                continue

            # A text range must fall inside the node's text.
            if evidence.text_range is not None:
                start, end = evidence.text_range
                if end > len(node.text):
                    issues.append(TraceIssue(change.id, f"text range runs past the end of node {node.id}"))
                    continue
                if not cited_words:
                    cited_words = [node.text[start:end]]

            # 5. The quotation must be what was cited, not something adjacent.
            if evidence.excerpt:
                cited = normalize(" ".join(cited_words)) if cited_words else ""
                excerpt = normalize(evidence.excerpt)
                if cited and not (cited in excerpt or excerpt in cited):
                    issues.append(TraceIssue(change.id, "excerpt does not match the cited words"))
                elif not cited and excerpt not in normalize(node.text):
                    issues.append(TraceIssue(change.id, "excerpt is not present in the cited node"))

    return issues


def verify_no_web_evidence(changes: Iterable[Change]) -> list[TraceIssue]:
    """Guard for the PDF path: refuse webpage evidence on a document comparison."""
    return [
        TraceIssue(change.id, "webpage evidence cannot describe a document")
        for change in changes
        if any(evidence.scope == "node" for evidence in change.evidence)
    ]
