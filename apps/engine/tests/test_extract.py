"""Extraction accuracy: words, positions, fonts, rotation, cropping, scanned pages."""

import pikepdf
import pytest

from diffnexa_engine.adapters.pdf.extract import (
    classify_text_layer,
    clean_font_name,
    extract_document,
    parse_pdf_date,
    to_display_coords,
)
from diffnexa_engine.errors import DocumentError, ErrorCode
from diffnexa_engine.model import TextLayerStatus

from .helpers.pdfs import encrypted_pdf, image_only_pdf, text_pdf, with_pikepdf


def test_words_positions_and_fonts():
    doc = extract_document(text_pdf([["Total Vacancies: 627"]], font="Helvetica-Bold", size=14))
    page = doc.page(1)
    assert [w.text for w in page.words] == ["Total", "Vacancies:", "627"]
    assert [w.id for w in page.words] == ["p1-w0", "p1-w1", "p1-w2"]
    first = page.words[0]
    assert first.font_name == "Helvetica-Bold" and first.bold and not first.italic
    assert first.font_size == 14
    # drawn at x=72, baseline 72pt below the top: the box starts at x=72, near the top.
    assert first.bbox.x0 == pytest.approx(72, abs=0.5)
    assert 50 < first.bbox.y0 < 80
    assert page.words[0].bbox.x1 < page.words[1].bbox.x0 < page.words[2].bbox.x0
    assert page.text_layer is TextLayerStatus.PRESENT and not page.likely_scanned


def test_multiple_pages_and_source_info():
    data = text_pdf([["alpha"], ["beta"], ["gamma"]])
    doc = extract_document(data)
    assert doc.page_count == 3
    assert [doc.page(n).text() for n in (1, 2, 3)] == ["alpha", "beta", "gamma"]
    assert doc.source.size_bytes == len(data)
    assert doc.extraction.engine_version and "pdfplumber" in doc.extraction.extractor


def test_extraction_is_deterministic():
    data = text_pdf([["same input"], ["same output"]])
    assert extract_document(data) == extract_document(data)


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_page_reads_whole_words(rotation):
    data = with_pikepdf(
        text_pdf([["Second page reads correctly"]]), lambda pdf: pdf.pages[0].rotate(rotation, relative=False)
    )
    page = extract_document(data).page(1)
    assert page.rotation == rotation
    assert page.text() == "Second page reads correctly"
    if rotation in (90, 270):
        assert (page.width, page.height) == (841.89, 595.28)
    for word in page.words:
        assert word.bbox.within(page.width, page.height)


def test_rotation_coordinate_mapping():
    w, h = 100.0, 200.0
    box = (10.0, 20.0, 30.0, 25.0)  # x0, top, x1, bottom on the upright page
    assert to_display_coords(*box, w, h, 0) == box
    assert to_display_coords(*box, w, h, 90) == (175.0, 10.0, 180.0, 30.0)
    assert to_display_coords(*box, w, h, 180) == (70.0, 175.0, 90.0, 180.0)
    assert to_display_coords(*box, w, h, 270) == (20.0, 70.0, 25.0, 90.0)


def test_inherited_rotation_is_respected():
    def rotate_parent(pdf):
        pdf.Root.Pages.Rotate = 90
        for page in pdf.pages:
            if "/Rotate" in page.obj:
                del page.obj["/Rotate"]

    page = extract_document(with_pikepdf(text_pdf([["inherited rotation"]]), rotate_parent)).page(1)
    assert page.rotation == 90 and page.text() == "inherited rotation"


def _two_column_pdf() -> bytes:
    import io

    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595.28, 841.89), invariant=1)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "visible")
    c.drawString(450, 700, "hidden")
    c.showPage()
    c.save()
    return buf.getvalue()


def test_text_outside_crop_box_is_ignored():
    def crop(pdf):
        pdf.pages[0].obj.CropBox = pikepdf.Array([0, 0, 300, 841.89])

    doc = extract_document(with_pikepdf(_two_column_pdf(), crop))
    page = doc.page(1)
    assert page.width == 300
    assert page.text() == "visible"
    assert any("outside the visible page" in w for w in doc.extraction.warnings)


def test_crop_box_offset_shifts_coordinates():
    def crop(pdf):
        pdf.pages[0].obj.CropBox = pikepdf.Array([50, 0, 595.28, 841.89])

    uncropped = extract_document(_two_column_pdf()).page(1).words[0]
    cropped = extract_document(with_pikepdf(_two_column_pdf(), crop)).page(1).words[0]
    assert cropped.text == uncropped.text == "visible"
    assert cropped.bbox.x0 == pytest.approx(uncropped.bbox.x0 - 50, abs=0.01)
    assert cropped.bbox.y0 == pytest.approx(uncropped.bbox.y0, abs=0.01)


def test_scanned_page_detected():
    doc = extract_document(image_only_pdf())
    page = doc.page(1)
    assert page.text_layer is TextLayerStatus.ABSENT
    assert page.likely_scanned and page.image_coverage >= 0.99
    assert len(page.images) == 1
    assert any("looks scanned" in w for w in doc.extraction.warnings)


def test_blank_page_is_not_called_scanned():
    page = extract_document(text_pdf([[]])).page(1)
    assert page.text_layer is TextLayerStatus.ABSENT and not page.likely_scanned


def test_unreadable_text_heuristic():
    assert classify_text_layer([]) is TextLayerStatus.ABSENT
    assert classify_text_layer(["Total", "Vacancies"]) is TextLayerStatus.PRESENT
    garbled = ["(cid:12)(cid:45)(cid:3)", "(cid:77)(cid:9)", "ok"]
    assert classify_text_layer(garbled) is TextLayerStatus.UNREADABLE
    assert classify_text_layer(["\ue001\ue002\ue003\ue004\ue005\ue006"]) is TextLayerStatus.UNREADABLE
    # A single odd glyph in normal text is fine.
    assert classify_text_layer(["Normal sentence with one (cid:4) glyph in it"]) is TextLayerStatus.PRESENT


def test_links_and_metadata():
    data = text_pdf(
        [["See the portal"]],
        title="Notice 12/2026",
        author="Board",
        link=("https://example.org/apply", (72, 700, 200, 780)),
    )
    doc = extract_document(data)
    assert doc.metadata.title == "Notice 12/2026" and doc.metadata.author == "Board"
    links = doc.page(1).links
    assert len(links) == 1 and links[0].uri == "https://example.org/apply"


def test_owner_password_pdf_extracts():
    doc = extract_document(encrypted_pdf(text_pdf([["restricted but readable"]]), user=""))
    assert doc.source.is_encrypted and doc.page(1).text() == "restricted but readable"


def test_rejected_files_raise_document_error():
    with pytest.raises(DocumentError) as info:
        extract_document(encrypted_pdf(text_pdf([["x"]]), user="pw"))
    assert info.value.code is ErrorCode.PASSWORD_PROTECTED
    with pytest.raises(DocumentError) as info:
        extract_document(b"not a pdf")
    assert info.value.code is ErrorCode.NOT_PDF


def test_helpers():
    assert clean_font_name("ABCDEF+Times-Italic") == "Times-Italic"
    assert clean_font_name(None) is None
    assert parse_pdf_date("D:20260930143000+05'30'") == "2026-09-30T14:30:00"
    assert parse_pdf_date("D:2026") == "2026"
    assert parse_pdf_date("yesterday") == "yesterday"
