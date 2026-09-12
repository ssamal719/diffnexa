"""A test-only 'perfect comparator' built from a golden spec.

It does not compare documents. It turns each expected change into a Change with
real evidence located in the extracted documents, so the scorer and the
traceability checks can be exercised end-to-end on real PDFs.
"""

from __future__ import annotations

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.contracts import (
    Change,
    ChangeKind,
    ComparisonResult,
    DocumentRef,
    Evidence,
    Side,
    normalize_text,
)
from diffnexa_engine.golden.spec import ExpectedChange, GoldenSpec
from diffnexa_engine.model import BBox, Document, Page, Word


def find_words(page: Page, value: str) -> list[Word]:
    target = normalize_text(value)
    words = list(page.words)
    for start in range(len(words)):
        joined = ""
        for end in range(start, len(words)):
            joined = (joined + " " + words[end].text).strip()
            if target in normalize_text(joined):
                return words[start : end + 1]
            if len(joined) > len(target) + 200:
                break
    raise LookupError(f"{value!r} not found on page {page.number}")


def _evidence(doc: Document, side: Side, page_no: int, value: str | None) -> Evidence:
    page = doc.page(page_no)
    if value is None:
        excerpt = " ".join(w.text for w in page.words[:8]) or None
        return Evidence(
            side=side, page=page_no, bbox=BBox(x0=0, y0=0, x1=page.width, y1=page.height), excerpt=excerpt
        )
    words = find_words(page, value)
    return Evidence(
        side=side,
        page=page_no,
        word_ids=tuple(w.id for w in words),
        bbox=BBox.union([w.bbox for w in words]),
        excerpt=" ".join(w.text for w in words),
    )


def change_from_expected(exp: ExpectedChange, idx: int, old: Document, new: Document) -> Change:
    evidence = []
    if exp.old_page is not None:
        evidence.append(_evidence(old, Side.OLD, exp.old_page, exp.old))
    if exp.new_page is not None:
        evidence.append(_evidence(new, Side.NEW, exp.new_page, exp.new))
    kind = exp.kind or (
        ChangeKind.MODIFIED
        if exp.old is not None and exp.new is not None
        else ChangeKind.ADDED
        if exp.new_page is not None
        else ChangeKind.REMOVED
    )
    return Change(
        id=f"c{idx}",
        seq=idx,
        kind=kind,
        category=exp.category,
        label=exp.label,
        old_value=exp.old,
        new_value=exp.new,
        evidence=tuple(evidence),
    )


def oracle_result(
    spec: GoldenSpec, old: Document, new: Document, extra: list[Change] | tuple[Change, ...] = ()
) -> ComparisonResult:
    changes = [change_from_expected(e, i, old, new) for i, e in enumerate(spec.expected_changes)]
    changes += list(extra)
    return ComparisonResult(
        engine_version=ENGINE_VERSION,
        old_document=DocumentRef(sha256=old.source.sha256, page_count=old.page_count),
        new_document=DocumentRef(sha256=new.source.sha256, page_count=new.page_count),
        changes=tuple(changes),
    )
