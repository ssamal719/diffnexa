"""The read-only document view that Word and webpage results carry for the workspace.

It must show exactly what the evidence cites, in the text the comparison read,
and must never add, drop or alter a change.
"""

from __future__ import annotations

import copy

from diffnexa_engine.ai.adapters import build_facts
from diffnexa_engine.docx import extract_docx
from diffnexa_engine.docx.api import serialize_docx_comparison
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.web.api import serialize_web_comparison
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.view import content_view, token_spans

from .helpers.docx_files import word
from .test_docx_compare import agreement, compare


def snap(html: str):
    return extract_snapshot(html, url="https://example.com/t", fetched_at="2026-01-01T00:00:00+00:00")


PAGE = """<html><head><title>{title}</title></head><body><main>
<h1>Terms</h1><h2>Governing law</h2>
<p>This agreement is governed by the laws of the State of {state}.</p>
<p>Delivery is scheduled for 30 June 2026.</p>
</main></body></html>"""


def web(old_state="Delaware", new_state="New York", old_title="Terms", new_title="Terms"):
    outcome = compare_snapshots_verbose(
        snap(PAGE.format(title=old_title, state=old_state)),
        snap(PAGE.format(title=new_title, state=new_state)),
    )
    return outcome, serialize_web_comparison(outcome, 0)


def marked_text(view: dict, mark: dict) -> str:
    node = next(n for n in view[mark["side"]]["nodes"] if n["id"] == mark["node"])
    return node["text"][mark["start"] : mark["end"]]


# ---------------------------------------------------------------- marks


def test_a_changed_word_is_marked_exactly_within_its_sentence():
    _, payload = web()
    view = payload["view"]
    (change,) = payload["changes"]
    texts = {m["side"]: marked_text(view, m) for m in view["marks"] if m["change"] == change["id"]}
    assert texts == {"original": "Delaware.", "revised": "New York."}
    revised = next(n for n in view["revised"]["nodes"] if "New York" in n["text"])
    assert revised["text"] == "This agreement is governed by the laws of the State of New York."
    assert revised["section"] == ["Terms", "Governing law"]


def test_every_change_is_marked_on_the_side_its_evidence_cites():
    _, payload = compare(
        heading="Payment and Refund Terms",
        paragraphs=(
            "Invoices are payable within 45 days.",
            "The supplier delivers monthly from 30 March 2026.",
        ),
        items=("Monthly report", "Quarterly review", "Annual audit"),
    )
    view = payload["view"]
    for change in payload["changes"]:
        cited = {
            ("original" if e["side"] == "old" else "revised", e["nodeId"])
            for e in change["evidence"]
            if e["nodeId"]
        }
        marked = {
            (m["side"], m["node"]) for m in view["marks"] if m["change"] == change["id"] and "node" in m
        }
        assert marked == cited, change["label"]


def test_an_added_paragraph_is_marked_whole_and_only_on_the_revised_side():
    _, payload = compare(
        paragraphs=(
            "Invoices are payable within 30 days.",
            "Late payments incur a fee.",
            "The supplier delivers monthly from 15 March 2026.",
        )
    )
    (change,) = payload["changes"]
    marks = [m for m in payload["view"]["marks"] if m["change"] == change["id"]]
    assert {m["side"] for m in marks} == {"revised"}
    assert [marked_text(payload["view"], m) for m in marks] == ["Late payments incur a fee."]


def test_document_level_evidence_is_marked_as_a_field_not_a_node():
    _, payload = compare(title="Master Services Agreement")
    view = payload["view"]
    (change,) = payload["changes"]
    marks = [m for m in view["marks"] if m["change"] == change["id"]]
    assert {(m["side"], m["field"]) for m in marks} == {
        ("original", "properties.title"),
        ("revised", "properties.title"),
    }
    assert view["original"]["fields"]["properties.title"] == "Services Agreement"
    assert view["revised"]["fields"]["properties.title"] == "Master Services Agreement"


def test_a_page_title_change_is_marked_as_a_metadata_field():
    _, payload = web(new_state="Delaware", new_title="Terms of Service")
    view = payload["view"]
    assert {(m["side"], m.get("field")) for m in view["marks"]} == {
        ("original", "metadata.title"),
        ("revised", "metadata.title"),
    }
    assert view["revised"]["fields"]["metadata.title"] == "Terms of Service"


def test_evidence_whose_words_cannot_be_placed_marks_the_whole_block():
    outcome, payload = web()
    node = next(n for n in outcome.current.nodes if "New York" in n.text)
    broken = node.model_copy(update={"text": "rewritten"})
    nodes = tuple(broken if n.id == node.id else n for n in outcome.current.nodes)
    view = content_view(outcome.previous.nodes, nodes, outcome.result.changes, fields=({}, {}))
    revised = [m for m in view["marks"] if m["side"] == "revised"]
    assert [(m["start"], m["end"]) for m in revised] == [(0, len("rewritten"))]


def test_words_are_found_in_reading_order():
    outcome, _ = web(old_state="New York", new_state="New York New York")
    node = next(n for n in outcome.current.nodes if "New York New York" in n.text)
    spans = token_spans(node)
    starts = [spans[t.id][0] for t in node.tokens]
    assert starts == sorted(starts) and len(set(starts)) == len(starts)
    assert all(node.text[a:b] == t.text for t, (a, b) in ((t, spans[t.id]) for t in node.tokens))


# ---------------------------------------------------------------- places and structure


def test_word_nodes_carry_the_reader_facing_place_and_structure():
    _, payload = compare()
    nodes = payload["view"]["revised"]["nodes"]
    heading = next(n for n in nodes if n["text"] == "Payment Terms")
    assert (heading["role"], heading["level"]) == ("heading", 2)
    assert heading["place"].startswith("Heading 2")
    item = next(n for n in nodes if n["text"] == "Monthly report")
    assert item["list"] and item["listLevel"] == 1
    cell = next(n for n in nodes if n["text"] == "$10,000")
    assert cell["table"] == [0, 1, 1]  # zero-based: table, row, column
    assert cell["place"] == "Table 1, row 2, column 2"


def test_web_nodes_carry_no_invented_place():
    _, payload = web()
    assert all("place" not in n for n in payload["view"]["revised"]["nodes"])


# ---------------------------------------------------------------- nothing else changes


def test_the_view_changes_nothing_else_in_the_result():
    outcome, payload = web()
    without = serialize_web_comparison(
        type(outcome)(result=outcome.result, diagnostics=outcome.diagnostics), 0
    )
    assert "view" not in without
    assert {k: v for k, v in payload.items() if k != "view"} == without


def test_the_view_is_not_part_of_what_the_ai_is_given():
    old = extract_docx(word(agreement))
    new = extract_docx(word(lambda d: agreement(d, title="Master Services Agreement")))
    payload = serialize_docx_comparison(compare_docx(old, new), 0)
    stripped = copy.deepcopy(payload)
    del stripped["view"]
    assert build_facts("docx", payload) == build_facts("docx", stripped)
