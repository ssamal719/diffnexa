"""A read-only view of both documents, for the comparison workspace to show.

The comparison result says what changed and cites evidence: content nodes and
the exact words (tokens) within them. On its own that is enough to prove a
change, but not to show it in context — a reader wants to see the sentence
around "Delaware." → "New York.", not just the two words.

This module adds that context. It lists each document's content, in reading
order, exactly as the comparison extracted it, and turns every piece of cited
evidence into a character span within that content ("mark"). It decides
nothing: no change is added, removed or altered here, and nothing in the
`changes` list is touched. It is presentation data derived from the same two
documents the comparison read, so what is highlighted is exactly what the
evidence cites.

Used for Word documents and webpages (Word content nodes are the same kind of
node). PDFs are shown from the person's own files in the browser, and
workbooks have their own grid view.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from diffnexa_engine.contracts.changes import Change
from diffnexa_engine.web.snapshot import ContentNode


def _node_payload(node: ContentNode, place: Callable[[ContentNode], str] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": node.id, "role": node.role.value, "text": node.text}
    if node.level is not None:
        payload["level"] = node.level
    if node.section_path:
        payload["section"] = list(node.section_path)
    if node.table is not None:
        payload["table"] = [node.table.table_index, node.table.row_index, node.table.column_index]
    if node.href:
        payload["href"] = node.href
    list_kind = getattr(node, "list_kind", None)
    if list_kind:
        payload["list"] = list_kind
        payload["listLevel"] = getattr(node, "list_level", None) or 1
    if place is not None:
        payload["place"] = place(node)
    return payload


def token_spans(node: ContentNode) -> dict[str, tuple[int, int]]:
    """Where each of a node's words sits in its text, found in order.

    Tokens are the node's words in reading order, so each is looked for after
    the previous one. A token that cannot be found (which extraction does not
    produce) is simply left out; its evidence then marks the whole node.
    """
    spans: dict[str, tuple[int, int]] = {}
    cursor = 0
    for token in node.tokens:
        start = node.text.find(token.text, cursor)
        if start == -1:
            continue
        spans[token.id] = (start, start + len(token.text))
        cursor = start + len(token.text)
    return spans


def _merge(spans: list[tuple[int, int]], text: str) -> list[tuple[int, int]]:
    """Joins spans separated only by spaces or punctuation, so a phrase reads as one mark."""
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and not text[merged[-1][1] : start].strip(" \t\n,.;:·-–—()\"'“”‘’"):
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def content_view(
    previous: Sequence[ContentNode],
    current: Sequence[ContentNode],
    changes: Iterable[Change],
    *,
    fields: tuple[Mapping[str, str | None], Mapping[str, str | None]],
    place: Callable[[ContentNode], str] | None = None,
) -> dict[str, Any]:
    """Both documents' content, and every change's evidence as marks within it.

    `fields` are the document-level values evidence can cite (a page title, a
    Word document's title property), for the original and the revised side.
    """
    documents = {"old": previous, "new": current}
    indexes = {side: {node.id: node for node in nodes} for side, nodes in documents.items()}
    spans_cache: dict[tuple[str, str], dict[str, tuple[int, int]]] = {}
    marks: list[dict[str, Any]] = []

    for change in changes:
        for evidence in change.evidence:
            side = evidence.side.value
            label = "original" if side == "old" else "revised"
            if evidence.scope == "document" and evidence.field:
                marks.append({"change": change.id, "side": label, "field": evidence.field})
                continue
            node = indexes[side].get(evidence.node_id or "")
            if node is None:
                continue
            key = (side, node.id)
            if key not in spans_cache:
                spans_cache[key] = token_spans(node)
            found = [spans_cache[key][token] for token in evidence.token_ids if token in spans_cache[key]]
            if not found or len(found) != len(evidence.token_ids):
                ranges = [(0, len(node.text))]
            else:
                ranges = _merge(found, node.text)
            for start, end in ranges:
                marks.append(
                    {"change": change.id, "side": label, "node": node.id, "start": start, "end": end}
                )

    def side_payload(nodes: Sequence[ContentNode], values: Mapping[str, str | None]) -> dict[str, Any]:
        return {
            "nodes": [_node_payload(node, place) for node in nodes],
            "fields": {name: value for name, value in values.items() if value},
        }

    return {
        "original": side_payload(previous, fields[0]),
        "revised": side_payload(current, fields[1]),
        "marks": marks,
    }


__all__ = ["content_view", "token_spans"]
