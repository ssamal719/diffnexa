"""DOCX page locations: the page each change is on, read from the layout Word recorded.

The oracle is a rendering, never paragraph arithmetic. tests/fixtures/docx_pages
holds two 135-page documents whose recorded layout comes from LibreOffice's
own rendering of them, and expected.json holds the page the rendered PDF shows
each change on (see build.py there). DiffNexa must report exactly those pages.

The small hand-built documents pin down the rules the long ones rely on: a
page break inside a paragraph, a table row that splits across pages, a hard
page break followed by Word's own marker, and — most importantly — that no
page number is given at all when the file's layout cannot be trusted.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

import pytest

from diffnexa_engine.compare.normalize import normalize_key
from diffnexa_engine.docx.api import evidence_page, serialize_docx_comparison, token_index
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.docx.extract import extract_docx
from tests.helpers.docx_files import body, package, word

FIXTURES = Path(__file__).parent / "fixtures" / "docx_pages"
ORACLE = json.loads((FIXTURES / "expected.json").read_text())


@pytest.fixture(scope="module")
def paged():
    original = extract_docx((FIXTURES / "original.docx").read_bytes())
    revised = extract_docx((FIXTURES / "revised.docx").read_bytes())
    return original, revised, compare_docx(original, revised)


def _words(document, evidence) -> list[str]:
    node = document.node_index()[evidence.node_id]
    return [node.tokens[token_index(token)].text for token in evidence.token_ids]


# ---------------------------------------------------------------- the long documents


def test_the_fixture_documents_are_over_a_hundred_pages(paged):
    original, revised, _ = paged
    assert ORACLE["pages"]["original"] >= 100
    assert original.layout.status == "recorded"
    assert revised.layout.status == "recorded"
    assert original.layout.pages == ORACLE["pages"]["original"]
    assert revised.layout.pages == ORACLE["pages"]["revised"]


@pytest.mark.parametrize("entry", ORACLE["changes"], ids=[entry["id"] for entry in ORACLE["changes"]])
def test_every_change_is_on_the_page_the_rendering_shows(paged, entry):
    original, revised, outcome = paged
    documents = {"old": original, "new": revised}
    matches = []
    for change in outcome.result.changes:
        cited = {
            side: [
                word
                for item in change.evidence
                if item.side.value == side
                for word in _words(documents[side], item)
            ]
            for side in ("old", "new")
        }
        if (entry["old"] and entry["old"] in cited["old"]) or (entry["new"] and entry["new"] in cited["new"]):
            matches.append(change)
    assert len(matches) == 1, f"{entry['id']}: expected one change, found {len(matches)}"
    change = matches[0]
    pages = {
        side: {evidence_page(documents[side], item) for item in change.evidence if item.side.value == side}
        for side in ("old", "new")
    }
    if entry["oldPage"] is not None:
        assert pages["old"] == {entry["oldPage"]}, entry["what"]
    else:
        assert pages["old"] == set()
    if entry["newPage"] is not None:
        assert pages["new"] == {entry["newPage"]}, entry["what"]
    else:
        assert pages["new"] == set()


def test_the_changes_are_spread_through_the_document(paged):
    pages = {entry["oldPage"] or entry["newPage"] for entry in ORACLE["changes"]}
    assert {10, 25, 75}.issubset(pages)
    assert any(page >= 100 for page in pages)
    same_page = [entry for entry in ORACLE["changes"] if entry["id"].startswith("same-page")]
    assert len(same_page) == 2 and same_page[0]["oldPage"] == same_page[1]["oldPage"]


def test_a_paragraph_that_runs_across_a_page_break_places_each_word_on_its_own_page(paged):
    original, _, outcome = paged
    entry = next(item for item in ORACLE["changes"] if item["id"] == "second-half-of-a-split-paragraph")
    node = next(node for node in original.nodes if any(token.text == entry["old"] for token in node.tokens))
    placed = original.layout.nodes[node.id]
    assert placed.breaks, "the paragraph should run across a page break"
    assert placed.page == entry["oldPage"] - 1  # it starts on the page before
    changed = next(index for index, token in enumerate(node.tokens) if token.text == entry["old"])
    assert placed.page_of_token(changed) == entry["oldPage"]


def test_the_response_carries_pages_for_evidence_and_the_document_view(paged):
    _, _, outcome = paged
    body_ = serialize_docx_comparison(outcome, 0)
    assert body_["layout"]["previous"] == {
        "status": "recorded",
        "reason": None,
        "pages": ORACLE["pages"]["original"],
    }
    pages = [item["page"] for change in body_["changes"] for item in change["evidence"]]
    assert all(isinstance(page, int) for page in pages)
    nodes = body_["view"]["original"]["nodes"]
    assert all(isinstance(node.get("page"), int) for node in nodes)
    split = [node for node in nodes if node.get("pageBreaks")]
    assert split, "paragraphs that run across a page break carry where the new page begins"
    for node in split:
        assert all(0 < offset < len(node["text"]) for offset in node["pageBreaks"])


def test_where_pages_fall_is_not_part_of_what_the_document_says():
    data = (FIXTURES / "original.docx").read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = {info.filename: archive.read(info.filename) for info in archive.infolist()}
    members["word/document.xml"] = re.sub(rb"<w:lastRenderedPageBreak/>", b"", members["word/document.xml"])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    without_markers = extract_docx(buffer.getvalue())
    with_markers = extract_docx(data)
    assert without_markers.content_sha256 == with_markers.content_sha256
    # The statistics still say 135 pages, but the breaks no longer add up to it.
    assert without_markers.layout.status == "unavailable"
    assert without_markers.layout.reason == "pages_disagree"


# ---------------------------------------------------------------- when the layout cannot be trusted


def test_a_file_whose_statistics_are_stale_gets_no_page_numbers():
    # python-docx copies its template's statistics — "1 page, 0 words" — into every file.
    def build(document):
        for index in range(40):
            document.add_paragraph(f"Clause {index} " + "text " * 60)
        document.add_page_break()
        document.add_paragraph("After the break.")

    extracted = extract_docx(word(build))
    assert extracted.layout.status == "unavailable"
    assert extracted.layout.reason == "statistics_out_of_date"
    assert extracted.layout.page_of(extracted.nodes[-1].id) is None
    outcome = compare_docx(extracted, extract_docx(word(lambda d: d.add_paragraph("Something else."))))
    payload = serialize_docx_comparison(outcome, 0)
    assert {item["page"] for change in payload["changes"] for item in change["evidence"]} == {None}
    assert all("page" not in node for node in payload["view"]["original"]["nodes"])


def test_a_file_without_statistics_gets_no_page_numbers():
    extracted = extract_docx(package(body("<w:p><w:r><w:t>Only text.</w:t></w:r></w:p>")))
    assert extracted.layout.status == "unavailable"
    assert extracted.layout.reason == "no_statistics"


def test_breaks_that_do_not_add_up_to_the_recorded_page_count_are_not_trusted():
    xml = body(
        "<w:p><w:r><w:t>one two</w:t></w:r></w:p>"
        "<w:p><w:r><w:lastRenderedPageBreak/><w:t>three four</w:t></w:r></w:p>"
        "<w:p><w:r><w:lastRenderedPageBreak/><w:t>five six</w:t></w:r></w:p>"
    )
    extracted = extract_docx(package(xml, statistics=(2, 6)))  # the breaks make 3 pages
    assert extracted.layout.status == "unavailable"
    assert extracted.layout.reason == "pages_disagree"


# ---------------------------------------------------------------- the rules


def _placed(xml: str, pages: int, words: int):
    extracted = extract_docx(package(body(xml), statistics=(pages, words)))
    assert extracted.layout.status == "recorded", extracted.layout.reason
    by_text = {node.text: node for node in extracted.nodes}
    return extracted, by_text


def test_a_page_that_begins_inside_a_paragraph():
    extracted, nodes = _placed(
        '<w:p><w:r><w:t xml:space="preserve">one two </w:t></w:r>'
        "<w:r><w:lastRenderedPageBreak/><w:t>three four</w:t></w:r></w:p>",
        pages=2,
        words=4,
    )
    node = nodes["one two three four"]
    assert [extracted.layout.page_of(node.id, index) for index in range(4)] == [1, 1, 2, 2]


def test_a_hard_page_break_followed_by_words_own_marker_is_one_new_page():
    extracted, nodes = _placed(
        "<w:p><w:r><w:t>first page</w:t></w:r></w:p>"
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        "<w:p><w:r><w:lastRenderedPageBreak/><w:t>second page</w:t></w:r></w:p>",
        pages=2,
        words=4,
    )
    assert extracted.layout.page_of(nodes["second page"].id) == 2


def test_a_hard_page_break_alone_starts_a_new_page():
    extracted, nodes = _placed(
        "<w:p><w:r><w:t>first page</w:t></w:r></w:p>"
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        "<w:p><w:r><w:t>second page</w:t></w:r></w:p>",
        pages=2,
        words=4,
    )
    assert extracted.layout.page_of(nodes["second page"].id) == 2


def test_a_table_row_split_across_pages_counts_one_new_page_not_one_per_cell():
    row = (
        "<w:tr>"
        "<w:tc><w:p><w:r><w:lastRenderedPageBreak/><w:t>left cell</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:lastRenderedPageBreak/><w:t>right cell</w:t></w:r></w:p></w:tc>"
        "</w:tr>"
    )
    header = (
        "<w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>"
    )
    extracted, nodes = _placed(
        f"<w:tbl>{header}{row}</w:tbl><w:p><w:r><w:t>after the table</w:t></w:r></w:p>",
        pages=2,
        words=9,
    )
    assert extracted.layout.page_of(nodes["Name"].id) == 1
    assert extracted.layout.page_of(nodes["left cell"].id) == 2
    assert extracted.layout.page_of(nodes["right cell"].id) == 2
    assert extracted.layout.page_of(nodes["after the table"].id) == 2


def test_markers_inside_a_text_box_are_not_counted():
    xml = (
        "<w:p><w:r><w:t>body text</w:t></w:r>"
        "<w:r><w:pict><w:txbxContent><w:p><w:r><w:lastRenderedPageBreak/><w:t>box</w:t></w:r></w:p>"
        "</w:txbxContent></w:pict></w:r></w:p>"
    )
    extracted, nodes = _placed(xml, pages=1, words=2)
    assert extracted.layout.page_of(nodes["body text"].id) == 1


def test_matching_options_do_not_leak_outside_a_comparison():
    assert normalize_key("Deadline") == "deadline"
