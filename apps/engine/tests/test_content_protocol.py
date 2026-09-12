"""Tests for the shared content protocol.

The point of this layer is that text comparison no longer depends on PDF
geometry. These tests prove it by aligning objects that have no pages, no
coordinates and no fonts — only text and words — and getting the same results
the PDF path gets.

If a future adapter (a web page, a Word document) can satisfy `ContentBlock`,
it inherits paragraph alignment, move detection and word-level diffing without
inventing a single coordinate.
"""

from __future__ import annotations

from dataclasses import dataclass

from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.compare.blocks import build_blocks
from diffnexa_engine.compare.text_align import PairKind, align_blocks, word_segments
from diffnexa_engine.model.content import ContentBlock, ContentToken

from .helpers.pdfs import text_pdf


# A minimal stand-in for a future adapter: no bounding boxes, no page numbers,
# no fonts. Exactly what an HTML paragraph or a spreadsheet cell would provide.
@dataclass(frozen=True)
class PlainToken:
    id: str
    text: str


@dataclass(frozen=True)
class PlainBlock:
    id: str
    text: str
    tokens: tuple[PlainToken, ...]


def plain(block_id: str, text: str) -> PlainBlock:
    words = text.split()
    return PlainBlock(
        id=block_id,
        text=text,
        tokens=tuple(PlainToken(f"{block_id}-t{index}", word) for index, word in enumerate(words)),
    )


# ---------------------------------------------------------------- the protocol


def test_a_block_with_no_geometry_satisfies_the_protocol():
    block = plain("b1", "The supplier shall deliver the goods")
    assert isinstance(block, ContentBlock)
    assert isinstance(block.tokens[0], ContentToken)


def test_the_pdf_adapters_block_satisfies_the_protocol():
    document = extract_document(text_pdf([["Total amount: 50,000"]]))
    block = build_blocks(document)[0]
    assert isinstance(block, ContentBlock)
    assert isinstance(block.tokens[0], ContentToken)


def test_tokens_and_words_are_the_same_tuple_on_a_pdf_block():
    """Two names for one thing, so they can never drift apart."""
    document = extract_document(text_pdf([["Total amount: 50,000"]]))
    block = build_blocks(document)[0]
    assert block.tokens == block.words


def test_something_missing_tokens_is_not_a_content_block():
    @dataclass(frozen=True)
    class TextOnly:
        text: str

    assert not isinstance(TextOnly("just text"), ContentBlock)


# ---------------------------------------------------------------- alignment


def test_identical_blocks_align_without_any_geometry():
    old = [plain("a", "The supplier shall deliver the goods")]
    new = [plain("b", "The supplier shall deliver the goods")]
    pairs = align_blocks(old, new)
    assert [pair.kind for pair in pairs] == [PairKind.EQUAL]


def test_an_edited_block_pairs_rather_than_being_deleted_and_readded():
    old = [plain("a", "Payment is due within 30 days of invoice")]
    new = [plain("b", "Payment is due within 14 days of invoice")]
    pairs = align_blocks(old, new)
    assert len(pairs) == 1 and pairs[0].kind is PairKind.MODIFIED


def test_added_and_removed_blocks_are_reported():
    old = [plain("a", "Clause one applies to all deliverables listed here")]
    new = [plain("b", "An entirely different clause about something else again")]
    kinds = {pair.kind for pair in align_blocks(old, new)}
    assert kinds == {PairKind.ADDED, PairKind.REMOVED}


def test_moved_text_is_detected_without_pages():
    moved = "Acceptance testing shall complete within ten working days"
    old = [plain("a", moved), plain("b", "A second paragraph of ordinary text")]
    new = [plain("c", "A second paragraph of ordinary text"), plain("d", moved)]
    pairs = align_blocks(old, new)
    assert any(pair.kind is PairKind.MOVED for pair in pairs)


def test_word_segments_isolate_the_changed_words():
    old = plain("a", "Contract value: 50,000")
    new = plain("b", "Contract value: 75,000")
    segments = word_segments(old, new)
    assert len(segments) == 1
    assert segments[0].old_text == "50,000"
    assert segments[0].new_text == "75,000"
    # The IDs come from the adapter, so evidence can point back at its own model.
    assert segments[0].old_word_ids == ("a-t2",)
    assert segments[0].new_word_ids == ("b-t2",)


def test_alignment_preserves_the_callers_own_type():
    """Give it PlainBlocks and the pairs hold PlainBlocks, with their own fields."""
    old = [plain("a", "Payment is due within 30 days of invoice")]
    new = [plain("b", "Payment is due within 14 days of invoice")]
    pair = align_blocks(old, new)[0]
    assert pair.old is not None and pair.new is not None
    assert pair.old.id == "a" and pair.new.id == "b"


def test_a_pdf_block_and_a_plain_block_align_the_same_way():
    """The same wording change produces the same result from either source."""
    old_pdf = build_blocks(extract_document(text_pdf([["Contract value: 50,000"]])))
    new_pdf = build_blocks(extract_document(text_pdf([["Contract value: 75,000"]])))
    pdf_segments = word_segments(old_pdf[0], new_pdf[0])

    plain_segments = word_segments(plain("a", "Contract value: 50,000"), plain("b", "Contract value: 75,000"))

    assert [(s.old_text, s.new_text) for s in pdf_segments] == [
        (s.old_text, s.new_text) for s in plain_segments
    ]
