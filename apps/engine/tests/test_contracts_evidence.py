"""The evidence contract: a change without traceable evidence cannot exist."""

import pytest
from pydantic import ValidationError

from diffnexa_engine.contracts import (
    AIAnnotation,
    Change,
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    DocumentRef,
    Evidence,
    Side,
)
from diffnexa_engine.model import BBox

BOX = BBox(x0=10, y0=10, x1=50, y1=20)
OLD_EV = Evidence(side=Side.OLD, page=2, word_ids=("p2-w3",), bbox=BOX, excerpt="627")
NEW_EV = Evidence(side=Side.NEW, page=2, word_ids=("p2-w3",), bbox=BOX, excerpt="654")
REF = DocumentRef(sha256="b" * 64, page_count=3)


def modified(**overrides) -> Change:
    data = dict(
        id="c1",
        seq=0,
        kind=ChangeKind.MODIFIED,
        category=ChangeCategory.NUMBER,
        old_value="627",
        new_value="654",
        evidence=(OLD_EV, NEW_EV),
    )
    data.update(overrides)
    return Change(**data)


def result(changes=(), annotations=()) -> ComparisonResult:
    return ComparisonResult(
        engine_version="t",
        old_document=REF,
        new_document=REF,
        changes=tuple(changes),
        annotations=tuple(annotations),
    )


def test_valid_modified_change():
    change = modified()
    assert change.evidence_pages(Side.OLD) == {2}


def test_change_without_evidence_is_rejected():
    with pytest.raises(ValidationError):
        modified(evidence=())


def test_evidence_without_page_is_rejected():
    with pytest.raises(ValidationError, match="must name a page"):
        Evidence(side=Side.OLD, word_ids=("p1-w0",))


def test_evidence_without_location_is_rejected():
    with pytest.raises(ValidationError, match="word_ids or a bbox"):
        Evidence(side=Side.OLD, page=1, excerpt="text only is not traceable")


def test_blank_excerpt_rejected():
    with pytest.raises(ValidationError):
        Evidence(side=Side.OLD, page=1, bbox=BOX, excerpt="   ")


def test_added_needs_new_side_evidence():
    with pytest.raises(ValidationError, match="new PDF"):
        Change(
            id="c1",
            seq=0,
            kind=ChangeKind.ADDED,
            category=ChangeCategory.TEXT,
            new_value="x",
            evidence=(OLD_EV,),
        )
    Change(
        id="c1", seq=0, kind=ChangeKind.ADDED, category=ChangeCategory.TEXT, new_value="x", evidence=(NEW_EV,)
    )


def test_removed_needs_old_side_evidence():
    with pytest.raises(ValidationError, match="old PDF"):
        Change(
            id="c1",
            seq=0,
            kind=ChangeKind.REMOVED,
            category=ChangeCategory.TEXT,
            old_value="x",
            evidence=(NEW_EV,),
        )


@pytest.mark.parametrize("kind", [ChangeKind.MODIFIED, ChangeKind.MOVED])
def test_modified_and_moved_need_both_sides(kind):
    with pytest.raises(ValidationError, match="both PDFs"):
        modified(kind=kind, evidence=(OLD_EV,))


def test_modified_needs_both_values():
    with pytest.raises(ValidationError, match="old and the new value"):
        modified(new_value=None)


def test_document_scope_only_for_metadata():
    doc_ev_old = Evidence(side=Side.OLD, scope="document", field="metadata.title", excerpt="A")
    doc_ev_new = Evidence(side=Side.NEW, scope="document", field="metadata.title", excerpt="B")
    Change(
        id="m1",
        seq=0,
        kind=ChangeKind.MODIFIED,
        category=ChangeCategory.METADATA,
        old_value="A",
        new_value="B",
        evidence=(doc_ev_old, doc_ev_new),
    )
    with pytest.raises(ValidationError, match="only metadata"):
        modified(evidence=(doc_ev_old, doc_ev_new))


def test_document_scope_needs_field_and_no_location():
    with pytest.raises(ValidationError):
        Evidence(side=Side.OLD, scope="document", excerpt="A")
    with pytest.raises(ValidationError):
        Evidence(side=Side.OLD, scope="document", field="metadata.title", page=1)


def test_result_rejects_duplicate_ids_and_seq():
    with pytest.raises(ValidationError, match="unique"):
        result([modified(), modified(seq=1)])
    with pytest.raises(ValidationError, match="sequence"):
        result([modified(), modified(id="c2")])


def test_result_rejects_pages_outside_document():
    far = Evidence(side=Side.NEW, page=9, bbox=BOX)
    with pytest.raises(ValidationError, match="only 3 pages"):
        result([modified(evidence=(OLD_EV, far))])


def test_result_rejects_annotation_for_unknown_change():
    ann = AIAnnotation(change_id="c999", confidence=0.9, title="Invented")
    with pytest.raises(ValidationError, match="unknown change"):
        result([modified()], [ann])


def test_result_rejects_two_annotations_for_one_change():
    a = AIAnnotation(change_id="c1", confidence=0.9)
    with pytest.raises(ValidationError, match="more than one"):
        result([modified()], [a, a])
