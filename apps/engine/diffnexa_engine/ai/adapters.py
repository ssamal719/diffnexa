"""From each tool's published comparison result to `AnalysisFacts`.

Each DiffNexa tool already publishes its deterministic changes, with their IDs
and evidence, in the JSON it returns to the website. These adapters read that
JSON — the very result the person is looking at — and restate each change as
plain facts. They add nothing: every location, value and classification below
is read from the result, and every evidence item keeps its place.

An adapter never guesses. A change with no evidence, or evidence whose place
cannot be stated from the result itself, makes the whole payload unusable: it
is refused rather than analysed with the evidence missing.

The payload is untrusted input (it has travelled through a browser), so every
field is type-checked here. The website only forwards results it sealed when
the engine returned them, so a well-formed payload is also a genuine one.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pydantic import ValidationError

from diffnexa_engine.ai.errors import AIAnalysisError, AIErrorCode
from diffnexa_engine.ai.facts import CHANGE_ID_PATTERN, TOOLS, AnalysisFacts, ChangeFacts, EvidenceFact

#: More changes than any one analysis should even be asked to consider.
MAX_PAYLOAD_CHANGES = 5_000
#: Longest text kept from any one field. Longer text is cut, and marked as cut.
MAX_FIELD_CHARS = 4_000

TOOL_NAMES: dict[str, tuple[str, str]] = {
    "pdf": ("PDF Compare", "two versions of a PDF document"),
    "web": ("Website Change Detector", "two captures of the same webpage"),
    "policy": ("Policy & Terms Monitor", "two captures of a policy or terms page"),
    "competitor": ("Competitor Monitor", "two captures of a competitor's webpage"),
    "price": ("Price Monitor", "two captures of a pricing or product page"),
    "docx": ("DOCX Compare", "two versions of a Word document"),
    "excel": ("Excel Compare", "two versions of an Excel workbook"),
}

TOOL_NOTES: dict[str, tuple[str, ...]] = {
    "pdf": ("Locations are page numbers in the original and revised PDF.",),
    "web": ("Locations are the headings of the page sections a change is in.",),
    "policy": (
        "Policy topics are assigned by DiffNexa's deterministic keyword and heading rules. A topic "
        "says which subject a change touches. It is not a legal assessment.",
    ),
    "competitor": (
        "Competitor signals are assigned by DiffNexa's deterministic rules. A signal says which "
        "part of the page a change is in. It is not a judgement about the competitor.",
    ),
    "price": (
        "Price categories are assigned by DiffNexa's deterministic rules from the page's own "
        "wording. They say what kind of pricing text changed. They are not a judgement of value.",
    ),
    "docx": (
        "A Word document has no fixed pages, so locations are paragraphs and table cells, "
        "counted from the start of the document.",
    ),
    "excel": (
        "Locations are sheet names and cell addresses. Formulas are compared as written and are "
        "never calculated; a formula's result is the value saved in the file.",
    ),
}


def _bad(detail: str) -> AIAnalysisError:
    return AIAnalysisError(AIErrorCode.BAD_REQUEST, detail)


def _text(value: Any, name: str, *, optional: bool = True) -> str | None:
    if value is None:
        if optional:
            return None
        raise _bad(f"{name} is missing")
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise _bad(f"{name} must be text")
    text = str(value)
    if len(text) > MAX_FIELD_CHARS:
        text = text[:MAX_FIELD_CHARS] + " […]"
    return text


def _list(value: Any, name: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise _bad(f"{name} must be a list")
    return value


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise _bad(f"{name} must be an object")
    return value


def _side(value: Any) -> str:
    if value in ("old", "previous", "original"):
        return "original"
    if value in ("new", "revised"):
        return "revised"
    raise _bad("evidence side is not recognised")


def _type_label(change: Mapping[str, Any]) -> str:
    raw = change.get("type")
    if isinstance(raw, str) and re.fullmatch(r"[A-Z_]{3,40}", raw):
        words = raw.replace("_", " ").lower()
        return words[0].upper() + words[1:]
    category = _text(change.get("category"), "category", optional=False) or ""
    return f"{category.capitalize()} {change.get('kind', 'changed')}"


def _join(parts: Sequence[str]) -> str:
    return " › ".join(part for part in parts if part)


# ---------------------------------------------------------------- per-tool evidence places


def _pdf_place(item: Mapping[str, Any], change: Mapping[str, Any]) -> str:
    page = item.get("page")
    if isinstance(page, int) and not isinstance(page, bool) and page >= 1:
        return f"Page {page}"
    if page is None and change.get("category") == "metadata":
        return "Document properties"
    raise _bad("PDF evidence has no page")


_METADATA_FIELDS = {
    "metadata.title": "Page title",
    "metadata.description": "Page description",
    "metadata.canonical": "Canonical address",
    "properties.title": "Document title (properties)",
    "properties.subject": "Document subject (properties)",
}


def _field_place(field: Any) -> str:
    name = _text(field, "evidence field", optional=False) or ""
    return _METADATA_FIELDS.get(name, f"Document properties: {name}")


def _web_place(item: Mapping[str, Any], _change: Mapping[str, Any]) -> str:
    if item.get("scope") == "document":
        return _field_place(item.get("field"))
    sections = [_text(part, "section") or "" for part in _list(item.get("sectionPath"), "sectionPath")]
    if sections:
        return f"Section: {_join(sections)}"
    if item.get("nodeId") or item.get("path"):
        return "Page content outside any headed section"
    raise _bad("webpage evidence has no place")


def _docx_place(item: Mapping[str, Any], _change: Mapping[str, Any]) -> str:
    if item.get("scope") == "document":
        return _field_place(item.get("field"))
    location = _text(item.get("location"), "evidence location")
    if not location:
        raise _bad("Word evidence has no location")
    sections = [_text(part, "section") or "" for part in _list(item.get("sectionPath"), "sectionPath")]
    return f"{location}, under “{sections[-1]}”" if sections else location


def _excel_place(item: Mapping[str, Any], _change: Mapping[str, Any]) -> str:
    sheet = _text(item.get("sheet"), "evidence sheet", optional=False)
    cell = _text(item.get("cell"), "evidence cell")
    if cell and not re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]{0,6}", cell):
        raise _bad("evidence cell is not a cell address")
    return f"Sheet “{sheet}”, cell {cell}" if cell else f"Sheet “{sheet}”"


# ---------------------------------------------------------------- per-tool change places


def _pdf_location(change: Mapping[str, Any], evidence: Sequence[EvidenceFact]) -> str:
    old = sorted({p for p in _list(change.get("oldPages"), "oldPages") if isinstance(p, int)})
    new = sorted({p for p in _list(change.get("newPages"), "newPages") if isinstance(p, int)})

    def pages(values: list[int]) -> str:
        return ("page " if len(values) == 1 else "pages ") + ", ".join(str(v) for v in values)

    if old and new:
        return pages(new).capitalize() if old == new else f"Original {pages(old)} · revised {pages(new)}"
    if new:
        return f"Revised {pages(new)}"
    if old:
        return f"Original {pages(old)}"
    return evidence[0].location


def _web_location(change: Mapping[str, Any], evidence: Sequence[EvidenceFact]) -> str:
    sections = [_text(s, "section") or "" for s in _list(change.get("sections"), "sections")]
    if sections and sections[0]:
        return f"Section: {sections[0]}"
    return evidence[0].location


def _docx_location(_change: Mapping[str, Any], evidence: Sequence[EvidenceFact]) -> str:
    revised = [item.location for item in evidence if item.side == "revised"]
    original = [item.location for item in evidence if item.side == "original"]
    if revised and original and revised[0] != original[0]:
        return f"{revised[0]} (was {original[0]})"
    return (revised or original)[0]


def _excel_location(change: Mapping[str, Any], _evidence: Sequence[EvidenceFact]) -> str:
    sheet = _text(change.get("sheet"), "sheet", optional=False)
    ref = _text(change.get("ref"), "ref")
    here = f"{sheet} · {ref}" if ref else f"Sheet {sheet}"
    original = change.get("original")
    revised = change.get("revised")
    if isinstance(original, Mapping) and isinstance(revised, Mapping):
        old_sheet = _text(original.get("sheet"), "original sheet")
        old_ref = _text(original.get("ref"), "original ref")
        if old_sheet and old_sheet != sheet:
            return f"{here} (was {old_sheet}{f' · {old_ref}' if old_ref else ''})"
        if old_ref and ref and old_ref != ref:
            return f"{here} (was {old_ref})"
    return here


# ---------------------------------------------------------------- per-tool classifications


def _web_signals(_change: Mapping[str, Any], _result: Mapping[str, Any]) -> tuple[str, ...]:
    return ()


def _policy_signals(change: Mapping[str, Any], _result: Mapping[str, Any]) -> tuple[str, ...]:
    topics = []
    for topic in _list(change.get("policyTopics"), "policyTopics"):
        label = _text(_mapping(topic, "policy topic").get("label"), "topic label")
        if label:
            topics.append(f"Policy topic: {label}")
    return tuple(topics)


def _competitor_signals(change: Mapping[str, Any], _result: Mapping[str, Any]) -> tuple[str, ...]:
    signal = change.get("competitorSignal")
    if signal is None:
        return ()
    signal = _mapping(signal, "competitor signal")
    label = _text(signal.get("label"), "signal label")
    reason = _text(signal.get("reason"), "signal reason")
    return (f"Competitor signal: {label}" + (f" ({reason})" if reason else ""),) if label else ()


def _price_signals(change: Mapping[str, Any], _result: Mapping[str, Any]) -> tuple[str, ...]:
    category = change.get("priceCategory")
    if category is None:
        return ()
    category = _mapping(category, "price category")
    label = _text(category.get("label"), "category label")
    reason = _text(category.get("reason"), "category reason")
    return (f"Price category: {label}" + (f" ({reason})" if reason else ""),) if label else ()


def _group_signals(change: Mapping[str, Any], result: Mapping[str, Any]) -> tuple[str, ...]:
    group = change.get("group")
    for item in _list(result.get("groups"), "groups"):
        item = _mapping(item, "group")
        if item.get("id") == group:
            label = _text(item.get("label"), "group label")
            return (f"Group: {label}",) if label else ()
    return ()


def _excel_details(change: Mapping[str, Any]) -> tuple[str, ...]:
    details: list[str] = []
    for side, title in (("original", "Original"), ("revised", "Revised")):
        place = change.get(side)
        if not isinstance(place, Mapping):
            continue
        cell = place.get("cell")
        if isinstance(cell, Mapping):
            formula = _text(cell.get("formula"), "formula")
            display = _text(cell.get("display"), "display")
            if formula:
                result = display if display else "no stored result"
                details.append(f"{title} formula: {formula} (stored result: {result})")
            link = _text(cell.get("link"), "link")
            if link:
                details.append(f"{title} link: {link}")
        note = _text(place.get("note"), "note")
        if note:
            details.append(f"{title}: {note}")
    return tuple(details)


# ---------------------------------------------------------------- what did not change


def _no_unchanged(_result: Mapping[str, Any], _changes: Sequence[ChangeFacts]) -> tuple[str, ...]:
    return ()


def _excel_unchanged(result: Mapping[str, Any], _changes: Sequence[ChangeFacts]) -> tuple[str, ...]:
    touched: set[str] = set()
    for change in _list(result.get("changes"), "changes"):
        change = _mapping(change, "change")
        for side in ("original", "revised"):
            place = change.get(side)
            if isinstance(place, Mapping) and isinstance(place.get("sheet"), str):
                touched.add(place["sheet"])
        if isinstance(change.get("sheet"), str):
            touched.add(change["sheet"])
    quiet = []
    for pairing in _list(result.get("sheets"), "sheets"):
        pairing = _mapping(pairing, "sheet pairing")
        original, revised = pairing.get("original"), pairing.get("revised")
        if pairing.get("status") == "same" and original == revised and isinstance(original, str):
            if original not in touched:
                quiet.append(original)
    if not quiet:
        return ()
    names = ", ".join(f"“{name}”" for name in quiet)
    noun = "sheet" if len(quiet) == 1 else "sheets"
    return (f"No changes were detected on the {noun} {names}, which is in both workbooks.",)


def _docx_unchanged(result: Mapping[str, Any], _changes: Sequence[ChangeFacts]) -> tuple[str, ...]:
    empty = []
    for group in _list(result.get("groups"), "groups"):
        group = _mapping(group, "group")
        if group.get("changeCount") == 0 and isinstance(group.get("label"), str):
            empty.append(group["label"])
    if not empty:
        return ()
    return ("No changes were detected in these groups: " + ", ".join(empty) + ".",)


def _policy_unchanged(result: Mapping[str, Any], _changes: Sequence[ChangeFacts]) -> tuple[str, ...]:
    policy = result.get("policy")
    if not isinstance(policy, Mapping):
        return ()
    quiet = []
    for topic in _list(policy.get("topics"), "policy topics"):
        topic = _mapping(topic, "policy topic")
        if topic.get("status") == "present" and topic.get("changeCount") == 0:
            if isinstance(topic.get("label"), str):
                quiet.append(topic["label"])
    if not quiet:
        return ()
    return (
        "The page has sections on these topics, and no detected change touches them: "
        + ", ".join(quiet)
        + ".",
    )


# ---------------------------------------------------------------- assembling


Place = Callable[[Mapping[str, Any], Mapping[str, Any]], str]
Locate = Callable[[Mapping[str, Any], Sequence[EvidenceFact]], str]
Signals = Callable[[Mapping[str, Any], Mapping[str, Any]], tuple[str, ...]]
Unchanged = Callable[[Mapping[str, Any], Sequence[ChangeFacts]], tuple[str, ...]]

_ADAPTERS: dict[str, tuple[Place, Locate, Signals, Unchanged]] = {
    "pdf": (_pdf_place, _pdf_location, _web_signals, _no_unchanged),
    "web": (_web_place, _web_location, _web_signals, _no_unchanged),
    "policy": (_web_place, _web_location, _policy_signals, _policy_unchanged),
    "competitor": (_web_place, _web_location, _competitor_signals, _no_unchanged),
    "price": (_web_place, _web_location, _price_signals, _no_unchanged),
    "docx": (_docx_place, _docx_location, _group_signals, _docx_unchanged),
    "excel": (_excel_place, _excel_location, _group_signals, _excel_unchanged),
}


def _change_facts(tool: str, change: Mapping[str, Any], order: int, result: Mapping[str, Any]) -> ChangeFacts:
    place, locate, signals, _ = _ADAPTERS[tool]
    change_id = change.get("id")
    if not isinstance(change_id, str) or not re.fullmatch(CHANGE_ID_PATTERN, change_id):
        raise _bad("a change has no usable ID")
    items = _list(change.get("evidence"), "evidence")
    if not items:
        raise _bad(f"change {change_id} has no evidence")
    evidence = []
    for index, item in enumerate(items, start=1):
        item = _mapping(item, "evidence")
        evidence.append(
            EvidenceFact(
                ref=f"{change_id}.e{index}",
                side=_side(item.get("side")),
                location=place(item, change),
                excerpt=_text(item.get("excerpt"), "excerpt"),
            )
        )
    kind = change.get("kind")
    if kind not in ("added", "removed", "modified", "moved"):
        raise _bad(f"change {change_id} has an unknown kind")
    return ChangeFacts(
        id=change_id,
        order=order,
        kind=kind,
        category=_text(change.get("category"), "category", optional=False) or "",
        type_label=_type_label(change),
        label=_text(change.get("label"), "label"),
        location=locate(change, evidence),
        original=_text(change.get("oldValue"), "oldValue"),
        revised=_text(change.get("newValue"), "newValue"),
        delta=_text(change.get("delta"), "delta"),
        signals=signals(change, result),
        details=_excel_details(change) if tool == "excel" else (),
        noise=bool(change.get("isNoise", False)),
        evidence=tuple(evidence),
    )


def build_facts(tool: str, result: Any) -> AnalysisFacts:
    """Restate one tool's comparison result as facts, or refuse it.

    Raises AIAnalysisError: ai_unsupported for a tool this layer does not know,
    ai_too_large for an unreasonable number of changes, ai_bad_request for a
    payload that is not that tool's result, or whose evidence cannot be read.
    """
    if tool not in TOOLS:
        raise AIAnalysisError(AIErrorCode.UNSUPPORTED, "unknown tool")
    result = _mapping(result, "result")
    changes = _list(result.get("changes"), "changes")
    if len(changes) > MAX_PAYLOAD_CHANGES:
        raise AIAnalysisError(AIErrorCode.TOO_LARGE, f"{len(changes)} changes")
    try:
        facts = [
            _change_facts(tool, _mapping(item, "change"), order, result) for order, item in enumerate(changes)
        ]
        ids = [item.id for item in facts]
        if len(ids) != len(set(ids)):
            raise _bad("change IDs are not unique")
        name, subject = TOOL_NAMES[tool]
        return AnalysisFacts(
            tool=tool,  # type: ignore[arg-type]
            tool_name=name,
            subject=subject,
            total_changes=len(facts),
            changes=tuple(facts),
            unchanged=_ADAPTERS[tool][3](result, facts),
            tool_notes=TOOL_NOTES[tool],
        )
    except ValidationError as exc:
        # Pydantic's message can quote the offending value, which may be document
        # text; only the field names travel on.
        fields = sorted({".".join(str(p) for p in error["loc"]) for error in exc.errors()})
        raise _bad(f"invalid facts: {', '.join(fields)[:200]}") from None


__all__ = ["MAX_FIELD_CHARS", "MAX_PAYLOAD_CHANGES", "TOOL_NAMES", "build_facts"]
