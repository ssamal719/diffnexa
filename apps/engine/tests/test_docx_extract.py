"""Reading Word documents into the comparable model.

Every fixture is a real .docx, built with python-docx (Word's own styles and
numbering) or assembled by hand for structures python-docx will not write.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.docx import DocxError, DocxErrorCode, DocxLimits, extract_docx
from diffnexa_engine.web.snapshot import NodeRole

from .helpers.docx_files import add_hyperlink, body, package, paragraph, table, word


def roles(document) -> list[tuple[str, str]]:
    return [(node.role.value, node.text) for node in document.nodes]


def sample(document) -> None:
    document.core_properties.title = "Services Agreement"
    document.core_properties.subject = "Acme and Northwind"
    document.core_properties.author = "Jane Private"
    document.add_heading("Services Agreement", level=0)
    document.add_heading("Payment Terms", level=2)
    document.add_paragraph("Invoices are payable within 30 days.")
    document.add_paragraph("Monthly report", style="List Bullet")
    document.add_paragraph("Quarterly review", style="List Number")
    document.add_paragraph("Nested item", style="List Bullet 2")
    link = document.add_paragraph("See ")
    add_hyperlink(link, "https://example.com/terms", "the terms")
    table(document, [("Item", "Fee"), ("Setup", "$10,000")])


SAMPLE = extract_docx(word(sample))


def test_headings_keep_their_level_and_title_is_a_heading():
    headings = [(node.level, node.text) for node in SAMPLE.nodes if node.role is NodeRole.HEADING]
    assert headings == [(1, "Services Agreement"), (2, "Payment Terms")]


def test_headings_become_the_section_path_of_what_follows():
    paragraph_node = next(node for node in SAMPLE.nodes if node.role is NodeRole.PARAGRAPH)
    assert paragraph_node.section_path == ("Services Agreement", "Payment Terms")


def test_lists_keep_their_kind_and_level():
    items = [
        (node.text, node.list_kind, node.list_level)
        for node in SAMPLE.nodes
        if node.role is NodeRole.LIST_ITEM
    ]
    assert items == [
        ("Monthly report", "bulleted", 1),
        ("Quarterly review", "numbered", 1),
        ("Nested item", "bulleted", 1),
    ]


def test_list_numbers_are_not_part_of_the_text():
    """Word computes "1." itself; renumbering is therefore never a change."""
    item = next(node for node in SAMPLE.nodes if node.text == "Quarterly review")
    assert not item.text[0].isdigit()


def test_tables_are_read_cell_by_cell_with_their_position():
    cells = [node for node in SAMPLE.nodes if node.role is NodeRole.TABLE_CELL]
    assert [(c.text, c.path) for c in cells] == [
        ("Item", "body/tbl[1]/tr[1]/tc[1]"),
        ("Fee", "body/tbl[1]/tr[1]/tc[2]"),
        ("Setup", "body/tbl[1]/tr[2]/tc[1]"),
        ("$10,000", "body/tbl[1]/tr[2]/tc[2]"),
    ]
    fee = cells[3].table
    assert (fee.table_index, fee.row_index, fee.column_index) == (0, 1, 1)
    assert (fee.column_header, fee.row_key, fee.is_header) == ("Fee", "Setup", False)
    assert cells[0].table.is_header


def test_external_links_keep_their_destination_and_the_text_stays_in_place():
    [link] = [node for node in SAMPLE.nodes if node.role is NodeRole.LINK]
    assert (link.text, link.href) == ("the terms", "https://example.com/terms")
    assert link.path == "body/p[7]/hyperlink[1]"
    assert any(node.text == "See the terms" for node in SAMPLE.nodes if node.role is NodeRole.PARAGRAPH)


def test_every_node_has_a_stable_id_path_and_citable_words():
    for index, node in enumerate(SAMPLE.nodes):
        assert node.id == f"n{index}"
        assert node.path.startswith("body/")
        assert [token.text for token in node.tokens] == node.text.split()
        assert all(token.id.startswith(f"{node.id}-t") for token in node.tokens)


def test_only_title_and_subject_are_read_from_the_properties():
    assert SAMPLE.properties.title == "Services Agreement"
    assert SAMPLE.properties.subject == "Acme and Northwind"
    assert "Jane Private" not in SAMPLE.model_dump_json()


def test_the_fingerprint_depends_on_content_not_on_the_zip():
    """Saving the same document twice gives different bytes but the same content."""
    first, second = word(sample), word(sample)
    assert extract_docx(first).content_sha256 == extract_docx(second).content_sha256
    changed = extract_docx(word(lambda d: (sample(d), d.add_paragraph("One more."))))
    assert changed.content_sha256 != SAMPLE.content_sha256


def test_merged_cells_do_not_shift_their_neighbours():
    grid = (
        "<w:tbl><w:tr>"
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + paragraph("Spanning header") + "</w:tc>"
        "<w:tc>" + paragraph("Total") + "</w:tc></w:tr>"
        "<w:tr><w:tc>"
        + paragraph("A")
        + "</w:tc><w:tc>"
        + paragraph("B")
        + "</w:tc><w:tc>"
        + paragraph("C")
        + "</w:tc></w:tr></w:tbl>"
    )
    document = extract_docx(package(body(grid)))
    positions = {node.text: node.table.column_index for node in document.nodes}
    assert positions == {"Spanning header": 0, "Total": 2, "A": 0, "B": 1, "C": 2}
    assert next(n for n in document.nodes if n.text == "C").table.column_header == "Total"


def test_a_nested_table_is_read_as_part_of_its_cell():
    nested = "<w:tbl><w:tr><w:tc>" + paragraph("inner value") + "</w:tc></w:tr></w:tbl>"
    grid = "<w:tbl><w:tr><w:tc>" + paragraph("outer") + nested + "</w:tc></w:tr></w:tbl>"
    document = extract_docx(package(body(grid)))
    assert [node.text for node in document.nodes] == ["outer inner value"]


def test_content_controls_are_read_in_place():
    xml = "<w:sdt><w:sdtContent>" + paragraph("Inside a content control") + "</w:sdtContent></w:sdt>"
    assert roles(extract_docx(package(body(xml)))) == [("paragraph", "Inside a content control")]


def test_hidden_text_and_field_codes_are_not_read():
    xml = (
        "<w:p><w:r><w:t>Visible</w:t></w:r>"
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve"> secret</w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve"> 7</w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
    assert roles(extract_docx(package(body(xml)))) == [("paragraph", "Visible 7")]


def test_images_and_text_boxes_are_counted_never_read():
    xml = (
        "<w:p><w:r><w:t>Before</w:t></w:r><w:r><w:drawing><w:txbxContent>"
        + paragraph("text box words")
        + "</w:txbxContent></w:drawing></w:r></w:p>"
    )
    document = extract_docx(package(body(xml)))
    assert roles(document) == [("paragraph", "Before")]
    assert document.extraction.embedded_objects == 1
    assert "not compared" in document.extraction.warnings[0]


def test_comments_are_not_read():
    def commented(document) -> None:
        paragraph_ = document.add_paragraph("Clause text.")
        document.add_comment(paragraph_.runs, text="Reviewer note that must stay private", author="R")

    document = extract_docx(word(commented))
    assert roles(document) == [("paragraph", "Clause text.")]
    assert "Reviewer note" not in document.model_dump_json()
    assert any("comments" in warning for warning in document.extraction.warnings)


def test_headers_and_footers_are_reported_as_not_compared():
    def with_header(document) -> None:
        document.sections[0].header.paragraphs[0].text = "Confidential header"
        document.add_paragraph("Body.")

    document = extract_docx(word(with_header))
    assert "Confidential header" not in document.model_dump_json()
    assert any("headers or footers" in warning for warning in document.extraction.warnings)


REVISION = 'w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"'


@pytest.mark.parametrize(
    "revision",
    [
        f"<w:ins {REVISION}><w:r><w:t>added</w:t></w:r></w:ins>",
        f"<w:del {REVISION}><w:r><w:delText>gone</w:delText></w:r></w:del>",
        f"<w:moveTo {REVISION}><w:r><w:t>moved</w:t></w:r></w:moveTo>",
    ],
)
def test_documents_with_pending_tracked_changes_are_refused(revision):
    xml = '<w:p><w:r><w:t xml:space="preserve">Text </w:t></w:r>' + revision + "</w:p>"
    with pytest.raises(DocxError) as caught:
        extract_docx(package(body(xml)))
    assert caught.value.code is DocxErrorCode.TRACKED_CHANGES


def test_formatting_only_revisions_do_not_block_reading():
    xml = (
        '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="A"><w:rPr/></w:rPrChange></w:rPr>'
        "<w:t>Bold now</w:t></w:r></w:p>"
    )
    assert roles(extract_docx(package(body(xml)))) == [("paragraph", "Bold now")]


def test_too_many_pieces_of_content_is_refused():
    xml = "".join(paragraph(f"Line {index}") for index in range(30))
    with pytest.raises(DocxError) as caught:
        extract_docx(package(body(xml)), DocxLimits(max_nodes=20))
    assert caught.value.code is DocxErrorCode.TOO_COMPLEX


def test_an_empty_document_has_no_nodes():
    document = extract_docx(word(lambda d: None))
    assert document.nodes == ()
