import pytest
from pydantic import ValidationError

from diffnexa_engine.model import (
    BBox,
    Document,
    DocumentSource,
    ExtractionInfo,
    Page,
    TextLayerStatus,
    TextSource,
    Word,
)

SHA = "a" * 64


def _word(i: int, page: int = 1, **kw) -> Word:
    return Word(id=f"p{page}-w{i}", text=f"w{i}", bbox=BBox(x0=0, y0=0, x1=10, y1=10), **kw)


def _doc(pages) -> Document:
    return Document(
        source=DocumentSource(sha256=SHA, size_bytes=100),
        pages=tuple(pages),
        extraction=ExtractionInfo(engine_version="test", extractor="test"),
    )


def test_bbox_rejects_inverted_box():
    with pytest.raises(ValidationError):
        BBox(x0=10, y0=0, x1=5, y1=10)


def test_bbox_within_and_union():
    a, b = BBox(x0=0, y0=0, x1=10, y1=10), BBox(x0=5, y0=5, x1=20, y1=30)
    assert BBox.union([a, b]) == BBox(x0=0, y0=0, x1=20, y1=30)
    assert a.within(10, 10) and not b.within(10, 10)


def test_models_are_immutable():
    word = _word(0)
    with pytest.raises(ValidationError):
        word.text = "changed"  # type: ignore[misc]


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        Word(id="p1-w0", text="x", bbox=BBox(x0=0, y0=0, x1=1, y1=1), colour="red")


@pytest.mark.parametrize("bad_id", ["w0", "p0-w1", "p1-w01", "p1_w1", "p1-w-1"])
def test_word_id_format(bad_id):
    with pytest.raises(ValidationError):
        Word(id=bad_id, text="x", bbox=BBox(x0=0, y0=0, x1=1, y1=1))


def test_word_ids_must_belong_to_their_page():
    with pytest.raises(ValidationError, match="does not belong"):
        Page(number=2, width=100, height=100, text_layer=TextLayerStatus.PRESENT, words=(_word(0, 1),))


def test_duplicate_word_ids_rejected():
    with pytest.raises(ValidationError, match="duplicate"):
        Page(number=1, width=100, height=100, text_layer=TextLayerStatus.PRESENT, words=(_word(0), _word(0)))


def test_pages_must_be_numbered_in_order():
    p1 = Page(number=1, width=10, height=10, text_layer=TextLayerStatus.ABSENT)
    p3 = Page(number=3, width=10, height=10, text_layer=TextLayerStatus.ABSENT)
    with pytest.raises(ValidationError):
        _doc([p1, p3])


def test_document_needs_at_least_one_page():
    with pytest.raises(ValidationError):
        _doc([])


def test_ocr_ready_words():
    """OCR (V1.1) produces the same Word objects, marked with their source and confidence."""
    ocr = _word(0, source=TextSource.OCR, confidence=0.82)
    assert ocr.source is TextSource.OCR and ocr.confidence == 0.82
    assert _word(1).source is TextSource.TEXT_LAYER and _word(1).confidence == 1.0
    with pytest.raises(ValidationError):
        _word(2, confidence=1.5)


def test_json_round_trip_and_word_index():
    page = Page(
        number=1, width=100, height=100, text_layer=TextLayerStatus.PRESENT, words=(_word(0), _word(1))
    )
    doc = _doc([page])
    again = Document.model_validate_json(doc.model_dump_json())
    assert again == doc
    assert set(doc.word_index()) == {"p1-w0", "p1-w1"}
    with pytest.raises(IndexError):
        doc.page(2)
