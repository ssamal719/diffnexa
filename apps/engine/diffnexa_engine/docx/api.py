"""The DOCX Compare response.

The change shape is the one Website Change Detector already returns, so the
website renders Word changes with the same cards and evidence. Two things are
added, both factual:

* **A group per change** — Text, Headings, Lists, Tables, Numbers, Dates,
  Structure or Other — chosen by a fixed order, so every change is in exactly
  one group and the groups add up to the changes found. Groups describe what
  kind of content changed; they never rank or judge it.
* **Whether a change is inside a block** — words added to or removed from a
  paragraph, heading or list item that is still there — rather than the whole
  block being added or removed. Both cite the same kind of evidence, so the
  card needs to be told which it is to say "Words added to a heading" instead
  of "Heading added".
* **A location per piece of evidence**, in words a reader can find in Word:
  "Heading 2, paragraph 3", "Numbered list item (level 1), paragraph 8",
  "Table 2, row 3, column 2". It is derived from the structural path the
  evidence already cites.
* **A read-only view of both documents** (`view`): every paragraph, heading,
  list item and cell in reading order, and each piece of evidence as a
  highlighted span within it, so the workspace can show a change in its
  surrounding text. It is presentation data; see `diffnexa_engine.web.view`.
"""

from __future__ import annotations

import re
from typing import Any

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind, DocxRef
from diffnexa_engine.docx.compare import PROPERTY_FIELDS, DocxComparisonOutcome
from diffnexa_engine.docx.model import DocxDocument, DocxNode
from diffnexa_engine.web.compare import _excerpt
from diffnexa_engine.web.snapshot import NodeRole
from diffnexa_engine.web.view import content_view

GROUPS: tuple[tuple[str, str], ...] = (
    ("text", "Text changes"),
    ("headings", "Headings"),
    ("lists", "Lists"),
    ("tables", "Tables"),
    ("numbers", "Numbers"),
    ("dates", "Dates"),
    ("structure", "Structure"),
    ("other", "Other"),
)

_PARAGRAPH = re.compile(r"^body/p\[(\d+)\]")
_CELL = re.compile(r"^body/tbl\[(\d+)\]/tr\[(\d+)\]/tc\[(\d+)\]")


def describe_location(node: DocxNode) -> str:
    """Where a node is, in terms a reader can find in the document."""
    path = node.path
    cell = _CELL.match(path)
    paragraph = _PARAGRAPH.match(path)
    if cell:
        place = f"Table {cell.group(1)}, row {cell.group(2)}, column {cell.group(3)}"
    elif paragraph:
        place = f"paragraph {paragraph.group(1)}"
    else:
        place = path

    if node.role is NodeRole.LINK:
        return f"Link in {place[0].lower() + place[1:]}" if cell else f"Link in {place}"
    if node.role is NodeRole.HEADING:
        return f"Heading {node.level}, {place}"
    if node.role is NodeRole.LIST_ITEM:
        kind = {"bulleted": "Bulleted", "numbered": "Numbered"}.get(node.list_kind or "", "List")
        return f"{kind} list item (level {node.list_level or 1}), {place}"
    if node.role is NodeRole.TABLE_CELL:
        return place
    return place[0].upper() + place[1:]


def group_of(change: Change, cited: list[DocxNode]) -> str:
    """The one factual group a change belongs to, by a fixed order.

    Containers come before value types: a changed amount in a table cell is a
    table change, a date in a heading is a heading change. The card itself still
    shows the value before and after.
    """
    if change.category in (ChangeCategory.METADATA, ChangeCategory.LINK, ChangeCategory.IDENTIFIER):
        return "other"
    if change.category is ChangeCategory.LAYOUT or change.kind is ChangeKind.MOVED:
        return "structure"
    if change.category is ChangeCategory.TABLE or any(node.role is NodeRole.TABLE_CELL for node in cited):
        return "tables"
    if change.subtype == "heading" or any(node.role is NodeRole.HEADING for node in cited):
        return "headings"
    if change.subtype == "list_item" or any(node.role is NodeRole.LIST_ITEM for node in cited):
        return "lists"
    if change.category is ChangeCategory.DATE:
        return "dates"
    if change.category is ChangeCategory.NUMBER:
        return "numbers"
    if change.category is ChangeCategory.TEXT:
        return "text"
    return "other"


def within_block(change: Change, cited: list[DocxNode]) -> bool:
    """Whether words were added to or removed from a block that is still there.

    A whole paragraph added or removed quotes the whole paragraph; words added
    to a paragraph that already existed quote only those words.
    """
    if change.category is not ChangeCategory.TEXT:
        return False
    if change.kind not in (ChangeKind.ADDED, ChangeKind.REMOVED):
        return False
    if len(cited) != 1 or cited[0].role not in (NodeRole.PARAGRAPH, NodeRole.HEADING, NodeRole.LIST_ITEM):
        return False
    value = change.new_value if change.kind is ChangeKind.ADDED else change.old_value
    return normalize(value or "") != normalize(_excerpt(cited[0].text))


def serialize_docx_comparison(outcome: DocxComparisonOutcome, processing_ms: int) -> dict[str, Any]:
    result = outcome.result
    documents: dict[str, DocxDocument] = {"old": outcome.previous, "new": outcome.current}
    indexes = {side: document.node_index() for side, document in documents.items()}

    def source(ref: Any) -> dict[str, Any]:
        assert isinstance(ref, DocxRef)
        return {"sha256": ref.sha256, "nodeCount": ref.node_count}

    changes: list[dict[str, Any]] = []
    for change in result.changes:
        cited = [
            indexes[evidence.side.value][evidence.node_id]
            for evidence in change.evidence
            if evidence.node_id and evidence.node_id in indexes[evidence.side.value]
        ]
        evidence_payload = []
        for item in change.evidence:
            node = indexes[item.side.value].get(item.node_id or "")
            evidence_payload.append(
                {
                    "side": item.side.value,
                    "scope": item.scope,
                    "nodeId": item.node_id,
                    "path": item.node_path,
                    "sectionPath": list(item.section_path),
                    "field": item.field,
                    "excerpt": item.excerpt,
                    "location": describe_location(node) if node is not None else "Document properties",
                }
            )
        changes.append(
            {
                "id": change.id,
                "seq": change.seq,
                "type": change.change_type.value,
                "kind": change.kind.value,
                "category": change.category.value,
                "subtype": change.subtype,
                "label": change.label,
                "oldValue": change.old_value,
                "newValue": change.new_value,
                "delta": change.delta,
                "confidence": change.confidence,
                "isNoise": False,
                "noiseReason": None,
                "sections": sorted(
                    {" › ".join(item.section_path) for item in change.evidence if item.section_path}
                ),
                "group": group_of(change, cited),
                "withinBlock": within_block(change, cited),
                "evidence": evidence_payload,
            }
        )

    return {
        "engineVersion": result.engine_version,
        "processingMs": processing_ms,
        "documents": {"previous": source(result.old_document), "revised": source(result.new_document)},
        "counts": {"total": len(changes), "meaningful": len(changes), "noise": 0},
        "changes": changes,
        "groups": [
            {
                "id": group_id,
                "label": label,
                "changeCount": sum(1 for change in changes if change["group"] == group_id),
                "changeIds": [change["id"] for change in changes if change["group"] == group_id],
            }
            for group_id, label in GROUPS
        ],
        "view": content_view(
            outcome.previous.nodes,
            outcome.current.nodes,
            result.changes,
            fields=tuple(
                {name: getattr(document.properties, attribute) for name, attribute, _ in PROPERTY_FIELDS}
                for document in (outcome.previous, outcome.current)
            ),
            place=describe_location,
        ),
        "diagnostics": {
            "notes": list(outcome.diagnostics.notes),
            "previousWarnings": list(outcome.diagnostics.previous_warnings),
            "revisedWarnings": list(outcome.diagnostics.revised_warnings),
            "droppedUntraceable": outcome.diagnostics.dropped_untraceable,
        },
    }


__all__ = ["GROUPS", "describe_location", "group_of", "serialize_docx_comparison", "within_block"]
