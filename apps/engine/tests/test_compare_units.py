"""Tests for the pieces the comparison engine is built from."""

from __future__ import annotations

from decimal import Decimal

import pytest

from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.compare.blocks import build_blocks, build_lines
from diffnexa_engine.compare.headers import looks_like_page_number
from diffnexa_engine.compare.normalize import normalize, normalize_key
from diffnexa_engine.compare.text_align import PairKind, align_blocks, word_segments
from diffnexa_engine.compare.values import ValueKind, compare_values, parse_date, parse_value

from .helpers.pdfs import text_pdf

# ---------------------------------------------------------------- normalisation


def test_normalisation_ignores_only_presentation_differences():
    assert normalize("Total   Vacancies:\n627") == "Total Vacancies: 627"
    assert normalize("\u201cquoted\u201d") == '"quoted"'
    assert normalize("30\u2013September") == "30-September"
    assert normalize("caf\u00e9") == normalize("cafe\u0301")


def test_normalisation_keeps_real_differences():
    assert normalize("627") != normalize("654")
    assert normalize("Vacancies") != normalize("Vacancy")
    # Case is preserved for display; only the matching key folds it.
    assert normalize("Total") != normalize("total")
    assert normalize_key("Total") == normalize_key("total")


# ---------------------------------------------------------------- values


@pytest.mark.parametrize(
    "text, kind, number",
    [
        ("627", ValueKind.NUMBER, Decimal("627")),
        ("1,23,45,678", ValueKind.NUMBER, Decimal("12345678")),  # Indian grouping
        ("1,234,567", ValueKind.NUMBER, Decimal("1234567")),  # international grouping
        ("12.5", ValueKind.NUMBER, Decimal("12.5")),
        ("2026", ValueKind.YEAR, Decimal("2026")),
        ("10%", ValueKind.PERCENT, Decimal("10")),
        ("₹50,000", ValueKind.MONEY, Decimal("50000")),
        ("Rs. 1,23,456", ValueKind.MONEY, Decimal("123456")),
        ("$1,200.50", ValueKind.MONEY, Decimal("1200.50")),
    ],
)
def test_number_parsing(text, kind, number):
    value = parse_value(text)
    assert value is not None and value.kind is kind and value.number == number
    assert value.text in text or value.text == text  # the original spelling is kept


def test_identifier_is_not_treated_as_a_number():
    value = parse_value("RN-12/2026")
    assert value is not None and value.kind is ValueKind.IDENTIFIER


@pytest.mark.parametrize(
    "text, expected",
    [
        ("30 September 2026", (30, 9, 2026)),
        ("30th Sept, 2026", (30, 9, 2026)),
        ("September 30, 2026", (30, 9, 2026)),
        ("2026-09-30", (30, 9, 2026)),
        ("30/09/2026", (30, 9, 2026)),  # 30 cannot be a month, so unambiguous
        ("09-30-2026", (30, 9, 2026)),
    ],
)
def test_date_parsing(text, expected):
    value = parse_date(text)
    assert value is not None
    assert (value.day, value.month, value.year) == expected


def test_ambiguous_dates_are_flagged_not_guessed():
    value = parse_date("03/04/2026")
    assert value is not None and value.ambiguous is True


def test_impossible_dates_are_rejected():
    assert parse_date("31 February 2026") is None
    assert parse_date("45 September 2026") is None


def test_non_dates_are_not_dates():
    assert parse_date("Section B") is None
    assert parse_date("627") is None


def test_numeric_difference_and_percentage():
    delta = compare_values(parse_value("627"), parse_value("654"))
    assert delta is not None
    assert delta.absolute == "+27" and delta.percent == "+4.31%"
    assert delta.summary == "+27 (+4.31%)"


def test_decrease_is_signed():
    delta = compare_values(parse_value("654"), parse_value("627"))
    assert delta is not None and delta.absolute == "-27"


def test_date_difference_is_in_days():
    delta = compare_values(parse_date("30 September 2026"), parse_date("15 October 2026"))
    assert delta is not None and delta.days == 15 and "15 days later" == delta.summary


@pytest.mark.parametrize(
    "old, new, reason",
    [
        ("2026", "2027", "a year change is not a 0.05% increase"),
        ("10%", "12%", "percentage points are not a percentage of a percentage"),
        ("0", "50", "there is no percentage increase from zero"),
    ],
)
def test_misleading_percentages_are_not_calculated(old, new, reason):
    delta = compare_values(parse_value(old), parse_value(new))
    assert delta is not None, reason
    assert delta.percent is None, reason


def test_values_with_different_currencies_are_not_subtracted():
    assert compare_values(parse_value("₹500"), parse_value("$500")) is None


def test_identifiers_have_no_arithmetic():
    assert compare_values(parse_value("RN-12/2026"), parse_value("RN-13/2026")) is None


def test_identical_values_have_no_difference():
    assert compare_values(parse_value("627"), parse_value("627")) is None


# ---------------------------------------------------------------- page furniture


@pytest.mark.parametrize("text", ["3", "Page 2 of 7", "- 4 -", "2 / 9"])
def test_page_numbering_is_recognised(text):
    assert looks_like_page_number(text)


@pytest.mark.parametrize("text", ["Total Vacancies: 627", "Page of the notice", "Annexure"])
def test_ordinary_text_is_not_page_numbering(text):
    assert not looks_like_page_number(text)


# ---------------------------------------------------------------- blocks


def test_words_group_into_lines_in_reading_order():
    document = extract_document(text_pdf([["First line here", "Second line here"]]))
    lines = build_lines(document.page(1))
    assert [line.text for line in lines] == ["First line here", "Second line here"]


def test_hyphenated_word_split_across_lines_is_rejoined():
    document = extract_document(text_pdf([["The recruit-", "ment notice"]]))
    blocks = build_blocks(document)
    assert "recruitment notice" in " ".join(block.text for block in blocks)


def test_headings_are_detected_by_size():
    document = extract_document(text_pdf([["Important Dates"]], font="Helvetica-Bold", size=18))
    blocks = build_blocks(document)
    assert blocks and blocks[0].is_heading


# ---------------------------------------------------------------- alignment


def _blocks(lines: list[list[str]]):
    return build_blocks(extract_document(text_pdf(lines)))


def test_identical_documents_align_completely():
    old = _blocks([["Total Vacancies: 627"]])
    new = _blocks([["Total Vacancies: 627"]])
    assert all(pair.kind is PairKind.EQUAL for pair in align_blocks(old, new))


def test_edited_paragraph_pairs_rather_than_being_deleted_and_readded():
    old = _blocks([["The last date to apply is 30 September 2026."]])
    new = _blocks([["The last date to apply is 15 October 2026."]])
    pairs = [p for p in align_blocks(old, new) if p.kind is not PairKind.EQUAL]
    assert len(pairs) == 1 and pairs[0].kind is PairKind.MODIFIED


def test_word_segments_isolate_the_changed_words():
    old = _blocks([["Total Vacancies: 627"]])
    new = _blocks([["Total Vacancies: 654"]])
    segments = word_segments(old[0], new[0])
    assert len(segments) == 1
    assert segments[0].old_text == "627" and segments[0].new_text == "654"
    assert segments[0].old_word_ids and segments[0].new_word_ids


def test_completely_different_paragraphs_do_not_pair():
    old = _blocks([["Applications open on the official portal."]])
    new = _blocks([["Zebra migration patterns across the savannah."]])
    kinds = {p.kind for p in align_blocks(old, new) if p.kind is not PairKind.EQUAL}
    assert kinds == {PairKind.ADDED, PairKind.REMOVED}
