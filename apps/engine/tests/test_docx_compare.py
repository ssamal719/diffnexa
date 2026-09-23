"""Comparing two Word documents: what is found, and the evidence behind it.

Every pair is two real .docx files built with python-docx and read by the real
reader. Assertions are on the response the website receives, so the groups,
locations and evidence are checked exactly as a user would see them.
"""

from __future__ import annotations

import json

from diffnexa_engine.contracts.docx_traceability import verify_docx_traceability
from diffnexa_engine.docx import extract_docx
from diffnexa_engine.docx.api import GROUPS, serialize_docx_comparison
from diffnexa_engine.docx.compare import compare_docx

from .helpers.docx_files import add_hyperlink, table, word

PARAGRAPHS = ("Invoices are payable within 30 days.", "The supplier delivers monthly from 15 March 2026.")
ITEMS = ("Monthly report", "Quarterly review")
ROWS = (("Item", "Fee"), ("Setup", "$10,000"), ("Support", "$2,000"))


def agreement(
    document,
    *,
    title="Services Agreement",
    heading="Payment Terms",
    heading_level=2,
    paragraphs=PARAGRAPHS,
    items=ITEMS,
    link="https://example.com/terms",
    rows=ROWS,
    tables=1,
) -> None:
    document.core_properties.title = title
    document.add_heading("Services Agreement", 1)
    if heading:
        document.add_heading(heading, heading_level)
    for text in paragraphs:
        document.add_paragraph(text)
    for text in items:
        document.add_paragraph(text, style="List Bullet")
    see = document.add_paragraph("See ")
    add_hyperlink(see, link, "the terms")
    for _ in range(tables):
        table(document, list(rows))


def compare(**changes):
    old = extract_docx(word(agreement))
    new = extract_docx(word(lambda document: agreement(document, **changes)))
    outcome = compare_docx(old, new)
    return outcome, serialize_docx_comparison(outcome, processing_ms=0)


def only(payload) -> dict:
    assert payload["counts"]["total"] == 1, [(c["kind"], c["label"]) for c in payload["changes"]]
    return payload["changes"][0]


# ---------------------------------------------------------------- no change


def test_identical_documents_have_no_changes():
    _, payload = compare()
    assert payload["counts"] == {"total": 0, "meaningful": 0, "noise": 0}
    assert all(group["changeCount"] == 0 for group in payload["groups"])


def test_the_same_document_saved_twice_has_no_changes():
    """Different ZIP bytes, same content."""
    first, second = word(agreement), word(agreement)
    outcome = compare_docx(extract_docx(first), extract_docx(second))
    assert outcome.result.changes == ()


# ---------------------------------------------------------------- paragraphs


def test_an_added_paragraph():
    change = only(compare(paragraphs=(*PARAGRAPHS, "Late payments incur a fee."))[1])
    assert (change["group"], change["kind"], change["category"]) == ("text", "added", "text")
    assert change["newValue"] == "Late payments incur a fee."
    assert [e["side"] for e in change["evidence"]] == ["new"]
    assert change["evidence"][0]["location"] == "Paragraph 5"


def test_a_removed_paragraph():
    change = only(compare(paragraphs=PARAGRAPHS[:1])[1])
    assert (change["group"], change["kind"]) == ("text", "removed")
    assert change["oldValue"] == PARAGRAPHS[1]
    assert [e["side"] for e in change["evidence"]] == ["old"]


def test_a_modified_paragraph_is_reported_at_word_level():
    change = only(compare(paragraphs=(PARAGRAPHS[0], "The supplier delivers weekly from 15 March 2026."))[1])
    assert (change["group"], change["kind"]) == ("text", "modified")
    assert (change["oldValue"], change["newValue"]) == ("monthly", "weekly")
    assert [e["side"] for e in change["evidence"]] == ["old", "new"]


# ---------------------------------------------------------------- headings


def test_an_added_heading():
    old = extract_docx(word(lambda document: agreement(document, heading=None)))
    new = extract_docx(word(agreement))
    change = only(serialize_docx_comparison(compare_docx(old, new), 0))
    assert (change["group"], change["kind"], change["subtype"]) == ("headings", "added", "heading")
    assert change["newValue"] == "Payment Terms"
    assert change["evidence"][0]["location"] == "Heading 2, paragraph 2"


def test_a_removed_heading():
    change = only(compare(heading=None)[1])
    assert (change["group"], change["kind"], change["oldValue"]) == ("headings", "removed", "Payment Terms")


def test_a_changed_heading():
    change = only(compare(heading="Payment and Refund Terms")[1])
    assert change["group"] == "headings"
    assert change["newValue"] == "and Refund"
    assert [(e["side"], e["location"]) for e in change["evidence"]] == [("new", "Heading 2, paragraph 2")]


def test_a_heading_whose_level_changed_is_a_structure_change():
    change = only(compare(heading_level=3)[1])
    assert (change["group"], change["category"]) == ("structure", "layout")
    assert change["subtype"] == "heading_level"
    assert (change["oldValue"], change["newValue"]) == ("Heading 2", "Heading 3")


# ---------------------------------------------------------------- lists


def test_an_added_list_item():
    change = only(compare(items=(*ITEMS, "Annual audit"))[1])
    assert (change["group"], change["kind"], change["newValue"]) == ("lists", "added", "Annual audit")
    assert change["evidence"][0]["location"] == "Bulleted list item (level 1), paragraph 7"


def test_a_removed_list_item():
    change = only(compare(items=ITEMS[:1])[1])
    assert (change["group"], change["kind"], change["oldValue"]) == ("lists", "removed", "Quarterly review")


def test_a_modified_list_item():
    change = only(compare(items=(ITEMS[0], "Quarterly business review"))[1])
    assert (change["group"], change["subtype"], change["newValue"]) == ("lists", "list_item", "business")


def test_a_paragraph_that_became_a_list_item_is_a_structure_change():
    def before(document):
        document.add_paragraph("Monthly report")

    def after(document):
        document.add_paragraph("Monthly report", style="List Number")

    outcome = compare_docx(extract_docx(word(before)), extract_docx(word(after)))
    change = only(serialize_docx_comparison(outcome, 0))
    assert (change["group"], change["subtype"]) == ("structure", "block_type")
    assert (change["oldValue"], change["newValue"]) == ("Paragraph", "Numbered list item, level 1")


# ---------------------------------------------------------------- tables


def test_an_added_table():
    change = only(compare(tables=2)[1])
    assert (change["group"], change["kind"], change["subtype"], change["label"]) == (
        "tables",
        "added",
        "table",
        "Table 2",
    )
    assert change["evidence"][0]["location"] == "Table 2, row 1, column 1"


def test_a_removed_table():
    old = extract_docx(word(lambda document: agreement(document, tables=2)))
    new = extract_docx(word(agreement))
    change = only(serialize_docx_comparison(compare_docx(old, new), 0))
    assert (change["group"], change["kind"], change["subtype"]) == ("tables", "removed", "table")
    assert all(e["side"] == "old" for e in change["evidence"])


def test_an_added_row():
    change = only(compare(rows=(*ROWS, ("Training", "$500")))[1])
    assert (change["group"], change["kind"], change["subtype"]) == ("tables", "added", "row")
    assert change["newValue"] == "Training · $500"
    locations = [e["location"] for e in change["evidence"]]
    assert locations == ["Table 1, row 4, column 1", "Table 1, row 4, column 2"]


def test_a_removed_row():
    change = only(compare(rows=ROWS[:2])[1])
    assert (change["group"], change["kind"], change["oldValue"]) == ("tables", "removed", "Support · $2,000")


def test_a_changed_cell_names_its_table_row_and_column():
    change = only(compare(rows=(ROWS[0], ROWS[1], ("Premium support", "$2,000")))[1])
    assert (change["group"], change["subtype"]) == ("tables", "table_cell")
    assert (change["oldValue"], change["newValue"]) == ("Support", "Premium support")
    assert [e["location"] for e in change["evidence"]] == ["Table 1, row 3, column 1"] * 2


def test_a_changed_amount_in_a_cell_keeps_its_value_and_difference():
    change = only(compare(rows=(ROWS[0], ("Setup", "$12,000"), ROWS[2]))[1])
    assert (change["group"], change["category"]) == ("tables", "number")
    assert (change["oldValue"], change["newValue"], change["delta"]) == ("$10,000", "$12,000", "+2000 (+20%)")


def test_an_added_column_is_cells_added_not_every_cell_changed():
    wider = tuple((*row, extra) for row, extra in zip(ROWS, ("Notes", "One-off", "Monthly"), strict=True))
    _, payload = compare(rows=wider)
    assert payload["counts"]["total"] == 3
    assert {(c["kind"], c["subtype"]) for c in payload["changes"]} == {("added", "table_cell")}


# ---------------------------------------------------------------- numbers, dates, links


def test_a_changed_number():
    change = only(compare(paragraphs=("Invoices are payable within 45 days.", PARAGRAPHS[1]))[1])
    assert (change["group"], change["category"]) == ("numbers", "number")
    assert (change["oldValue"], change["newValue"], change["delta"]) == ("30", "45", "+15 (+50%)")


def test_a_changed_date():
    change = only(compare(paragraphs=(PARAGRAPHS[0], "The supplier delivers monthly from 30 March 2026."))[1])
    assert (change["group"], change["category"]) == ("dates", "date")
    assert (change["oldValue"], change["newValue"]) == ("15 March 2026", "30 March 2026")
    assert change["delta"] == "15 days later"


def test_a_changed_link_destination():
    change = only(compare(link="https://example.org/terms-v2")[1])
    assert (change["group"], change["category"]) == ("other", "link")
    assert (change["oldValue"], change["newValue"]) == (
        "https://example.com/terms",
        "https://example.org/terms-v2",
    )
    assert [e["location"] for e in change["evidence"]] == ["Link in paragraph 7"] * 2


def test_a_changed_title_is_kept_apart_from_the_body():
    change = only(compare(title="Master Services Agreement")[1])
    assert (change["group"], change["category"], change["label"]) == ("other", "metadata", "Document title")
    assert {e["scope"] for e in change["evidence"]} == {"document"}
    assert {e["location"] for e in change["evidence"]} == {"Document properties"}


# ---------------------------------------------------------------- several at once


MIXED = dict(
    heading="Payment and Refund Terms",
    paragraphs=("Invoices are payable within 45 days.", "The supplier delivers monthly from 30 March 2026."),
    items=(*ITEMS, "Annual audit"),
    rows=(ROWS[0], ("Setup", "$12,000"), ROWS[2], ("Training", "$500")),
)


def test_several_changes_are_each_found_once():
    _, payload = compare(**MIXED)
    groups = sorted(change["group"] for change in payload["changes"])
    assert groups == ["dates", "headings", "lists", "numbers", "tables", "tables"]
    assert [change["id"] for change in payload["changes"]] == [f"c{i}" for i in range(6)]


def test_groups_account_for_every_change_exactly_once():
    _, payload = compare(**MIXED)
    listed = [change_id for group in payload["groups"] for change_id in group["changeIds"]]
    assert sorted(listed) == sorted(change["id"] for change in payload["changes"])
    assert [group["id"] for group in payload["groups"]] == [group_id for group_id, _ in GROUPS]
    assert sum(group["changeCount"] for group in payload["groups"]) == payload["counts"]["total"]


# ---------------------------------------------------------------- evidence


def test_every_change_has_evidence_that_traces_back_to_the_documents():
    outcome, payload = compare(**MIXED, link="https://example.org/terms-v2", title="New title")
    assert payload["counts"]["total"] == 8
    assert verify_docx_traceability(outcome.result.changes, outcome.previous, outcome.current) == []
    assert payload["diagnostics"]["droppedUntraceable"] == 0
    for change in outcome.result.changes:
        assert change.evidence, change.id
        for evidence in change.evidence:
            assert evidence.excerpt
            assert evidence.scope == "document" or (evidence.node_id and evidence.node_path)


def test_evidence_cites_the_right_document():
    outcome, payload = compare(**MIXED)
    fingerprints = {"old": outcome.previous.content_sha256, "new": outcome.current.content_sha256}
    assert payload["documents"]["previous"]["sha256"] == fingerprints["old"]
    assert payload["documents"]["revised"]["sha256"] == fingerprints["new"]
    for change in outcome.result.changes:
        for evidence in change.evidence:
            assert evidence.snapshot_sha256 == fingerprints[evidence.side.value]
            document = outcome.previous if evidence.side.value == "old" else outcome.current
            node = document.node_index()[evidence.node_id]
            assert node.path == evidence.node_path
            assert evidence.excerpt.replace("…", "").strip() in node.text or node.text in evidence.excerpt


def test_old_values_come_from_the_original_and_new_values_from_the_revision():
    outcome, _ = compare(**MIXED)
    old_text = " ".join(node.text for node in outcome.previous.nodes)
    new_text = " ".join(node.text for node in outcome.current.nodes)
    for change in outcome.result.changes:
        if change.old_value and change.subtype != "row":
            assert change.old_value in old_text, change.old_value
        if change.new_value and change.subtype != "row":
            assert change.new_value in new_text, change.new_value


# ---------------------------------------------------------------- determinism


def test_the_response_is_byte_identical_every_time_apart_from_timing():
    runs = []
    for _ in range(3):
        _, payload = compare(**MIXED, link="https://example.org/terms-v2")
        payload["processingMs"] = None
        runs.append(json.dumps(payload, sort_keys=True))
    assert runs[0] == runs[1] == runs[2]


def test_the_response_is_the_same_whichever_way_the_file_was_saved():
    old_a, old_b = word(agreement), word(agreement)
    new_a = word(lambda document: agreement(document, **MIXED))
    new_b = word(lambda document: agreement(document, **MIXED))
    first = serialize_docx_comparison(compare_docx(extract_docx(old_a), extract_docx(new_a)), 0)
    second = serialize_docx_comparison(compare_docx(extract_docx(old_b), extract_docx(new_b)), 0)
    assert first == second


def test_no_change_is_labelled_by_importance():
    _, payload = compare(**MIXED)
    text = json.dumps(payload).lower()
    for word_ in ("important", "minor", "major", "risky", "favorable", "unfavorable", "critical"):
        assert word_ not in text


def test_a_heading_reworded_in_several_places_is_reported_whole():
    change = only(compare(heading="Payment, Refund and Invoicing")[1])
    assert (change["group"], change["kind"], change["subtype"]) == ("headings", "modified", "heading")
    assert (change["oldValue"], change["newValue"]) == ("Payment Terms", "Payment, Refund and Invoicing")
    assert [e["side"] for e in change["evidence"]] == ["old", "new"]


def test_changes_are_listed_in_reading_order():
    _, payload = compare(**MIXED, title="New title")
    assert payload["changes"][0]["category"] == "metadata", "document properties come first"
    body = [change for change in payload["changes"] if change["category"] != "metadata"]
    groups = [change["group"] for change in body]
    assert groups == ["headings", "numbers", "dates", "lists", "tables", "tables"]
    assert [change["seq"] for change in payload["changes"]] == list(range(len(payload["changes"])))


def test_an_added_column_is_reported_row_by_row():
    wider = tuple((*row, extra) for row, extra in zip(ROWS, ("Notes", "One-off", "Monthly"), strict=True))
    _, payload = compare(rows=wider)
    assert [change["newValue"] for change in payload["changes"]] == ["Notes", "One-off", "Monthly"]


def test_words_added_inside_a_block_are_told_apart_from_a_whole_new_block():
    inside = only(compare(heading="Payment and Refund Terms")[1])
    assert (inside["kind"], inside["newValue"], inside["withinBlock"]) == ("added", "and Refund", True)
    item = only(compare(items=(ITEMS[0], "Quarterly business review"))[1])
    assert item["withinBlock"] is True
    whole = only(compare(paragraphs=(*PARAGRAPHS, "Late payments incur a fee."))[1])
    assert whole["withinBlock"] is False
    heading = only(compare(heading=None)[1])
    assert heading["withinBlock"] is False
    cell = only(compare(rows=(ROWS[0], ("Setup", "$12,000"), ROWS[2]))[1])
    assert cell["withinBlock"] is False


def test_a_link_change_is_placed_at_its_paragraph_not_at_the_end():
    _, payload = compare(**MIXED, link="https://example.org/terms-v2")
    order = [change["group"] for change in payload["changes"]]
    # The link sits in the paragraph before the table, so it comes before the table changes.
    assert order.index("other") < order.index("tables")
