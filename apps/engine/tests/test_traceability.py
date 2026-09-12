"""Evidence must trace to real words, on real pages, inside real page bounds."""

from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.contracts import (
    Change,
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    DocumentRef,
    Evidence,
    Side,
    verify_traceability,
)
from diffnexa_engine.model import BBox

from .helpers.pdfs import text_pdf

OLD = extract_document(text_pdf([["Intro"], ["Total Vacancies: 627"]]))
NEW = extract_document(text_pdf([["Intro"], ["Total Vacancies: 654"]]))


def _ev(doc, side, word_index=2, **overrides):
    word = doc.page(2).words[word_index]
    data = dict(side=side, page=2, word_ids=(word.id,), bbox=word.bbox, excerpt=word.text)
    data.update(overrides)
    return Evidence(**data)


def _result(old_ev, new_ev, old_sha=None):
    change = Change(
        id="c0",
        seq=0,
        kind=ChangeKind.MODIFIED,
        category=ChangeCategory.NUMBER,
        old_value="627",
        new_value="654",
        evidence=(old_ev, new_ev),
    )
    return ComparisonResult(
        engine_version="t",
        old_document=DocumentRef(sha256=old_sha or OLD.source.sha256, page_count=2),
        new_document=DocumentRef(sha256=NEW.source.sha256, page_count=2),
        changes=(change,),
    )


def test_valid_evidence_traces():
    assert verify_traceability(_result(_ev(OLD, Side.OLD), _ev(NEW, Side.NEW)), OLD, NEW) == []


def test_unknown_word_id_flagged():
    issues = verify_traceability(
        _result(_ev(OLD, Side.OLD, word_ids=("p2-w99",)), _ev(NEW, Side.NEW)), OLD, NEW
    )
    assert any("p2-w99 not found" in i.message for i in issues)


def test_word_from_another_page_flagged():
    issues = verify_traceability(
        _result(_ev(OLD, Side.OLD, word_ids=("p1-w0",)), _ev(NEW, Side.NEW)), OLD, NEW
    )
    assert any("not found on page 2" in i.message for i in issues)


def test_bbox_outside_page_flagged():
    far = BBox(x0=10, y0=10, x1=5000, y1=20)
    issues = verify_traceability(_result(_ev(OLD, Side.OLD, bbox=far), _ev(NEW, Side.NEW)), OLD, NEW)
    assert any("outside page" in i.message for i in issues)


def test_excerpt_mismatch_flagged():
    issues = verify_traceability(_result(_ev(OLD, Side.OLD, excerpt="999"), _ev(NEW, Side.NEW)), OLD, NEW)
    assert any("excerpt" in i.message for i in issues)


def test_wrong_document_flagged():
    issues = verify_traceability(_result(_ev(OLD, Side.OLD), _ev(NEW, Side.NEW), old_sha="c" * 64), OLD, NEW)
    assert any(i.change_id == "*" for i in issues)
