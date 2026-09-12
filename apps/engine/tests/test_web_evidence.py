"""Tests for webpage evidence.

The product's claim is that every reported change can be traced back to the page
it came from. These tests are that claim, written down: each one describes a way
evidence could be wrong, and asserts it is refused rather than displayed.

Nothing here is repaired or tolerated. Evidence that cannot be verified is an
error, not a caveat.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from diffnexa_engine.contracts.changes import (
    Change,
    ChangeCategory,
    ChangeKind,
    Evidence,
    Side,
)
from diffnexa_engine.contracts.traceability import verify_traceability
from diffnexa_engine.contracts.web_traceability import (
    verify_no_web_evidence,
    verify_web_traceability,
)
from diffnexa_engine.model.document import BBox
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.snapshot import Snapshot

FIXTURES = Path(__file__).parent / "fixtures" / "web"

BEFORE_HTML = """<html><body><main>
<h1>Service Terms</h1>
<p>Payment is due within 30 days of invoice.</p>
<p>The supplier shall provide quarterly reports.</p>
</main></body></html>"""

AFTER_HTML = BEFORE_HTML.replace("30 days", "14 days")


@pytest.fixture(scope="module")
def snapshots() -> tuple[Snapshot, Snapshot]:
    before = extract_snapshot(BEFORE_HTML, url="https://example.com/terms")
    after = extract_snapshot(AFTER_HTML, url="https://example.com/terms")
    return before, after


def node_with(snapshot: Snapshot, fragment: str):
    return next(node for node in snapshot.nodes if fragment in node.text)


def evidence_for(snapshot: Snapshot, fragment: str, side: Side, words: int = 3, **overrides):
    """Build honest evidence for the node containing `fragment`."""
    node = node_with(snapshot, fragment)
    cited = node.tokens[:words]
    data = {
        "side": side,
        "scope": "node",
        "snapshot_sha256": snapshot.content_sha256,
        "node_id": node.id,
        "node_path": node.path,
        "section_path": node.section_path,
        "token_ids": tuple(token.id for token in cited),
        "excerpt": " ".join(token.text for token in cited),
    }
    data.update(overrides)
    return Evidence(**data)


def change_with(*evidence: Evidence, **overrides) -> Change:
    data = {
        "id": "c0",
        "seq": 0,
        "kind": ChangeKind.MODIFIED,
        "category": ChangeCategory.TEXT,
        "old_value": "30 days",
        "new_value": "14 days",
        "evidence": evidence,
    }
    data.update(overrides)
    return Change(**data)


# ---------------------------------------------------------------- valid evidence


def test_honest_web_evidence_verifies(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    assert verify_web_traceability([change], before, after) == []


def test_evidence_records_where_a_reader_would_look(snapshots):
    before, _after = snapshots
    evidence = evidence_for(before, "Payment is due", Side.OLD)
    assert evidence.node_path
    assert evidence.section_path == ("Service Terms",)
    assert evidence.snapshot_sha256 == before.content_sha256
    assert evidence.token_ids


def test_a_text_range_is_accepted_instead_of_tokens(snapshots):
    before, after = snapshots
    node = node_with(before, "Payment is due")
    evidence = Evidence(
        side=Side.OLD,
        scope="node",
        snapshot_sha256=before.content_sha256,
        node_id=node.id,
        text_range=(0, 7),
        excerpt=node.text[0:7],
    )
    change = change_with(evidence, evidence_for(after, "Payment is due", Side.NEW))
    assert verify_web_traceability([change], before, after) == []


# ---------------------------------------------------------------- broken evidence


def test_a_missing_node_is_refused(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, node_id="n999", token_ids=("n999-t0",)),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("not in the old snapshot" in issue.message for issue in issues)


def test_a_wrong_snapshot_fingerprint_is_refused(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, snapshot_sha256="a" * 64),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("different old snapshot" in issue.message for issue in issues)


def test_evidence_from_the_other_side_is_refused(snapshots):
    """Old-side evidence citing the new snapshot's fingerprint must not pass."""
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, snapshot_sha256=after.content_sha256),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    assert verify_web_traceability([change], before, after) != []


def test_a_missing_token_is_refused(snapshots):
    before, after = snapshots
    node = node_with(before, "Payment is due")
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, token_ids=(f"{node.id}-t99",)),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("is not on node" in issue.message for issue in issues)


def test_a_token_belonging_to_another_node_is_refused_by_the_contract(snapshots):
    """Caught at construction: a token must be named for the node citing it."""
    before, _after = snapshots
    node = node_with(before, "Payment is due")
    other = node_with(before, "quarterly reports")
    with pytest.raises(ValidationError, match="belong to the cited node"):
        Evidence(
            side=Side.OLD,
            scope="node",
            snapshot_sha256=before.content_sha256,
            node_id=node.id,
            token_ids=(other.tokens[0].id,),
        )


def test_a_wrong_path_is_refused(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, node_path="main > p:nth-of-type(9)"),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("not at the cited path" in issue.message for issue in issues)


def test_a_wrong_section_path_is_refused(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, section_path=("Invented Heading",)),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("cited headings" in issue.message for issue in issues)


def test_an_excerpt_that_was_not_cited_is_refused(snapshots):
    before, after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD, excerpt="Something else entirely"),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    issues = verify_web_traceability([change], before, after)
    assert any("excerpt does not match" in issue.message for issue in issues)


def test_a_text_range_past_the_end_is_refused(snapshots):
    before, after = snapshots
    node = node_with(before, "Payment is due")
    evidence = Evidence(
        side=Side.OLD,
        scope="node",
        snapshot_sha256=before.content_sha256,
        node_id=node.id,
        text_range=(0, len(node.text) + 50),
    )
    change = change_with(evidence, evidence_for(after, "Payment is due", Side.NEW))
    issues = verify_web_traceability([change], before, after)
    assert any("runs past the end" in issue.message for issue in issues)


# ---------------------------------------------------------------- malformed shapes


def test_node_evidence_needs_a_snapshot_a_node_and_a_location(snapshots):
    before, _after = snapshots
    node = node_with(before, "Payment is due")
    base = {
        "side": Side.OLD,
        "scope": "node",
        "snapshot_sha256": before.content_sha256,
        "node_id": node.id,
        "token_ids": (node.tokens[0].id,),
    }
    Evidence(**base)  # complete evidence is accepted

    for missing in ("snapshot_sha256", "node_id", "token_ids"):
        incomplete = {key: value for key, value in base.items() if key != missing}
        with pytest.raises(ValidationError):
            Evidence(**incomplete)


def test_duplicate_token_ids_are_refused(snapshots):
    before, _after = snapshots
    node = node_with(before, "Payment is due")
    with pytest.raises(ValidationError, match="must not repeat"):
        Evidence(
            side=Side.OLD,
            scope="node",
            snapshot_sha256=before.content_sha256,
            node_id=node.id,
            token_ids=(node.tokens[0].id, node.tokens[0].id),
        )


def test_an_impossible_text_range_is_refused(snapshots):
    before, _after = snapshots
    node = node_with(before, "Payment is due")
    for span in [(5, 5), (9, 2), (-1, 4)]:
        with pytest.raises(ValidationError):
            Evidence(
                side=Side.OLD,
                scope="node",
                snapshot_sha256=before.content_sha256,
                node_id=node.id,
                text_range=span,
            )


# ---------------------------------------------------------------- the two worlds


def test_web_evidence_cannot_carry_page_or_bbox_fields(snapshots):
    before, _after = snapshots
    node = node_with(before, "Payment is due")
    common = {
        "side": Side.OLD,
        "scope": "node",
        "snapshot_sha256": before.content_sha256,
        "node_id": node.id,
        "token_ids": (node.tokens[0].id,),
    }
    for intruder in (
        {"page": 3},
        {"bbox": BBox(x0=0, y0=0, x1=10, y1=10)},
        {"word_ids": ("p1-w0",)},
        {"field": "metadata.title"},
    ):
        with pytest.raises(ValidationError):
            Evidence(**common, **intruder)


def test_pdf_evidence_cannot_carry_webpage_fields():
    common = {"side": Side.OLD, "scope": "page", "page": 2, "word_ids": ("p2-w1",)}
    for intruder in (
        {"snapshot_sha256": "b" * 64},
        {"node_id": "n4"},
        {"node_path": "main > p"},
        {"token_ids": ("n4-t0",)},
        {"text_range": (0, 4)},
        {"section_path": ("Terms",)},
    ):
        with pytest.raises(ValidationError):
            Evidence(**common, **intruder)


def test_document_evidence_cannot_carry_webpage_fields():
    with pytest.raises(ValidationError):
        Evidence(
            side=Side.OLD,
            scope="document",
            field="metadata.title",
            node_id="n1",
            token_ids=("n1-t0",),
        )


def test_a_change_cannot_mix_webpage_and_document_evidence(snapshots):
    before, _after = snapshots
    with pytest.raises(ValidationError, match="cannot mix"):
        change_with(
            evidence_for(before, "Payment is due", Side.OLD),
            Evidence(side=Side.NEW, scope="page", page=1, word_ids=("p1-w0",)),
        )


def test_the_pdf_checker_refuses_webpage_evidence(snapshots):
    """Belt and braces: a PDF comparison must never return node evidence."""
    before, _after = snapshots
    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD),
        evidence_for(before, "Payment is due", Side.NEW, snapshot_sha256=before.content_sha256),
    )
    assert verify_no_web_evidence([change]) != []


def test_the_web_checker_refuses_document_page_evidence():
    change = change_with(
        Evidence(side=Side.OLD, scope="page", page=1, word_ids=("p1-w0",)),
        Evidence(side=Side.NEW, scope="page", page=1, word_ids=("p1-w0",)),
    )
    before = extract_snapshot(BEFORE_HTML, url="https://example.com/")
    after = extract_snapshot(AFTER_HTML, url="https://example.com/")
    issues = verify_web_traceability([change], before, after)
    assert any("cannot describe a webpage" in issue.message for issue in issues)


def test_tool_one_evidence_still_verifies_exactly_as_before():
    """The PDF guarantees are unchanged by this extension."""
    from diffnexa_engine.adapters.pdf.extract import extract_document
    from diffnexa_engine.compare import compare_documents

    from .helpers.pdfs import text_pdf

    old = extract_document(text_pdf([["Contract value: 50,000"]]))
    new = extract_document(text_pdf([["Contract value: 75,000"]]))
    result = compare_documents(old, new)
    assert result.changes
    assert verify_traceability(result, old, new) == []
    assert verify_no_web_evidence(result.changes) == []


# ---------------------------------------------------------------- regressions


def test_evidence_stays_valid_for_content_after_a_void_element():
    """W3 regression: content parsed inside <embed> must still be citable.

    The HTML parser nests content written after a void element inside it. W3
    fixed the extraction; this checks the resulting nodes and tokens are still
    coherent enough to be used as evidence.
    """
    html = "<html><body><main><embed src='x.swf'><p>Payment is due within 30 days.</p></main></body></html>"
    before = extract_snapshot(html, url="https://example.com/")
    after = extract_snapshot(html.replace("30 days", "14 days"), url="https://example.com/")

    change = change_with(
        evidence_for(before, "Payment is due", Side.OLD),
        evidence_for(after, "Payment is due", Side.NEW),
    )
    assert verify_web_traceability([change], before, after) == []


def test_evidence_works_for_malformed_markup():
    """Another W3 edge case: repaired markup still produces citable nodes."""
    raw = (FIXTURES / "malformed.html").read_text(encoding="utf-8")
    before = extract_snapshot(raw, url="https://example.com/")
    after = extract_snapshot(raw.replace("First paragraph", "Revised paragraph"), url="https://example.com/")

    change = change_with(
        evidence_for(before, "paragraph", Side.OLD),
        evidence_for(after, "paragraph", Side.NEW),
    )
    assert verify_web_traceability([change], before, after) == []


def test_evidence_works_for_table_cells():
    raw = (FIXTURES / "tables.html").read_text(encoding="utf-8")
    before = extract_snapshot(raw, url="https://example.com/")
    after = extract_snapshot(raw.replace("120,000", "150,000"), url="https://example.com/")

    change = change_with(
        evidence_for(before, "120,000", Side.OLD, words=1),
        evidence_for(after, "150,000", Side.NEW, words=1),
        category=ChangeCategory.TABLE,
        old_value="120,000",
        new_value="150,000",
    )
    assert verify_web_traceability([change], before, after) == []


# ---------------------------------------------------------------- serialisation


def test_evidence_serialises_deterministically(snapshots):
    before, _after = snapshots
    first = evidence_for(before, "Payment is due", Side.OLD)
    second = evidence_for(before, "Payment is due", Side.OLD)
    assert first == second
    assert first.model_dump_json() == second.model_dump_json()


def test_evidence_survives_a_round_trip(snapshots):
    before, after = snapshots
    original = evidence_for(before, "Payment is due", Side.OLD)
    restored = Evidence.model_validate_json(original.model_dump_json())
    assert restored == original

    change = change_with(restored, evidence_for(after, "Payment is due", Side.NEW))
    assert verify_web_traceability([change], before, after) == []


def test_evidence_is_immutable(snapshots):
    before, _after = snapshots
    evidence = evidence_for(before, "Payment is due", Side.OLD)
    with pytest.raises(ValidationError):
        evidence.node_id = "n99"  # type: ignore[misc]
