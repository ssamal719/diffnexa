"""End-to-end tests for the comparison engine, on real PDFs built in the test.

Three things are checked for every case: the right change is found, nothing else
is found, and every change can be traced back to the documents.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.compare import compare_documents, compare_documents_verbose
from diffnexa_engine.contracts import ChangeKind, ChangeType, Side, verify_traceability
from diffnexa_engine.model.document import Document

from .helpers.pdfs import image_only_pdf, text_pdf

NOTICE_OLD = [
    ["Recruitment Notice No. 12/2026", "Post: Junior Assistant"],
    ["Total Vacancies: 627", "Maximum age: 30 years"],
    ["Last date to apply: 30 September 2026"],
]


def build(pages: list[list[str]]) -> Document:
    return extract_document(text_pdf(pages))


def compare(old_pages: list[list[str]], new_pages: list[list[str]]):
    old, new = build(old_pages), build(new_pages)
    result = compare_documents(old, new)
    assert verify_traceability(result, old, new) == [], "evidence must always be traceable"
    return result, old, new


def meaningful(result):
    return [change for change in result.changes if change.noise_reason is None]


def types(result) -> list[ChangeType]:
    return [change.change_type for change in meaningful(result)]


# ---------------------------------------------------------------- no false positives


def test_identical_documents_report_nothing():
    result, _, _ = compare(NOTICE_OLD, NOTICE_OLD)
    assert result.changes == ()


def test_the_same_file_compared_with_itself_reports_nothing():
    data = text_pdf(NOTICE_OLD)
    old, new = extract_document(data), extract_document(data)
    assert compare_documents(old, new).changes == ()


def test_reflowed_text_is_not_a_content_change():
    """Identical words, different line breaks."""
    old = [["The application deadline is 30 September 2026 for all candidates."]]
    new = [["The application deadline is", "30 September 2026 for all candidates."]]
    result, _, _ = compare(old, new)
    assert meaningful(result) == []


def test_a_different_font_is_not_a_content_change():
    old_doc = extract_document(text_pdf([["Total Vacancies: 627"]], font="Helvetica"))
    new_doc = extract_document(text_pdf([["Total Vacancies: 627"]], font="Times-Roman", size=13))
    result = compare_documents(old_doc, new_doc)
    assert [c for c in result.changes if c.noise_reason is None] == []


def test_comparison_is_reproducible():
    old, new = build(NOTICE_OLD), build([["Total Vacancies: 654"]])
    first = compare_documents(old, new)
    second = compare_documents(old, new)
    assert first == second


# ---------------------------------------------------------------- numbers


def test_number_change_is_one_typed_change_with_the_difference():
    new_pages = [NOTICE_OLD[0], ["Total Vacancies: 654", "Maximum age: 30 years"], NOTICE_OLD[2]]
    result, _, _ = compare(NOTICE_OLD, new_pages)
    changes = meaningful(result)
    assert len(changes) == 1
    change = changes[0]
    assert change.change_type is ChangeType.NUMBER_CHANGED
    assert (change.old_value, change.new_value) == ("627", "654")
    assert change.delta == "+27 (+4.31%)"
    assert change.label == "Total Vacancies"
    assert change.evidence_pages(Side.OLD) == {2} and change.evidence_pages(Side.NEW) == {2}


def test_currency_amount_keeps_its_original_formatting():
    result, _, _ = compare([["Application fee: Rs. 1,23,45,678"]], [["Application fee: Rs. 1,25,00,000"]])
    change = meaningful(result)[0]
    assert (change.old_value, change.new_value) == ("1,23,45,678", "1,25,00,000")


def test_a_year_change_gets_no_percentage():
    result, _, _ = compare([["Examination year: 2026"]], [["Examination year: 2027"]])
    change = meaningful(result)[0]
    assert change.delta == "+1"


# ---------------------------------------------------------------- dates


def test_date_change_is_one_change_with_the_day_difference():
    new_pages = [NOTICE_OLD[0], NOTICE_OLD[1], ["Last date to apply: 15 October 2026"]]
    result, _, _ = compare(NOTICE_OLD, new_pages)
    changes = meaningful(result)
    assert len(changes) == 1
    change = changes[0]
    assert change.change_type is ChangeType.DATE_CHANGED
    assert (change.old_value, change.new_value) == ("30 September 2026", "15 October 2026")
    assert change.delta == "15 days later"
    assert change.evidence_pages(Side.NEW) == {3}


def test_an_ambiguous_date_format_is_not_reported_as_a_date_change():
    """03/04/2026 could be March or April; it must not become a calendar difference."""
    result, _, _ = compare([["Interview on 03/04/2026"]], [["Interview on 05/06/2026"]])
    assert ChangeType.DATE_CHANGED not in types(result)


# ---------------------------------------------------------------- text


def test_added_paragraph():
    new_pages = [NOTICE_OLD[0] + ["Applications must be submitted online only."]] + NOTICE_OLD[1:]
    result, _, _ = compare(NOTICE_OLD, new_pages)
    changes = meaningful(result)
    assert [c.change_type for c in changes] == [ChangeType.TEXT_ADDED]
    assert "submitted online only" in (changes[0].new_value or "")
    assert changes[0].old_value is None


def test_removed_paragraph():
    old_pages = [NOTICE_OLD[0] + ["This sentence will be deleted entirely."]] + NOTICE_OLD[1:]
    result, _, _ = compare(old_pages, NOTICE_OLD)
    changes = meaningful(result)
    assert [c.change_type for c in changes] == [ChangeType.TEXT_REMOVED]
    assert "deleted entirely" in (changes[0].old_value or "")


def test_reworded_text_is_a_modification_with_both_values():
    old = [["Candidates must hold a bachelor's degree from a recognised university."]]
    new = [["Candidates must hold a master's degree from a recognised university."]]
    result, _, _ = compare(old, new)
    change = meaningful(result)[0]
    assert change.change_type is ChangeType.TEXT_MODIFIED
    assert change.old_value and change.new_value
    assert "bachelor" in change.old_value and "master" in change.new_value


def test_text_moved_to_another_page_is_not_a_deletion_plus_an_addition():
    sentence = "The written examination will be held at district examination centres."
    # The blank strings are paragraph breaks, as in a real document: a moved
    # paragraph is a paragraph, not a line glued to its neighbours.
    old = [["Notice", "", sentence], ["Second page content here"]]
    new = [["Notice"], ["Second page content here", "", sentence]]
    result, _, _ = compare(old, new)
    moved = [c for c in result.changes if c.kind is ChangeKind.MOVED]
    # Reordering two paragraphs can honestly be described either way round: the
    # sentence moved down, or the other paragraph moved up. What must hold is
    # that it is reported once, as a move, and never as a deletion plus an
    # addition. (The cross-page case with an unambiguous answer is covered by
    # the moved-paragraph golden pair.)
    assert len(moved) == 1
    assert moved[0].old_value and moved[0].new_value
    assert moved[0].old_value == moved[0].new_value, "moved text keeps its wording"
    assert meaningful(result) == [], "a pure move is not a content change"


# ---------------------------------------------------------------- pages


def test_added_page():
    new_pages = NOTICE_OLD + [["Annexure: Revised syllabus for the written examination."]]
    result, _, _ = compare(NOTICE_OLD, new_pages)
    page_changes = [c for c in meaningful(result) if c.change_type is ChangeType.PAGE_ADDED]
    assert len(page_changes) == 1
    assert page_changes[0].evidence_pages(Side.NEW) == {4}


def test_removed_page():
    result, _, _ = compare(NOTICE_OLD, NOTICE_OLD[:2])
    page_changes = [c for c in meaningful(result) if c.change_type is ChangeType.PAGE_REMOVED]
    assert len(page_changes) == 1
    assert page_changes[0].evidence_pages(Side.OLD) == {3}


def test_inserting_a_page_does_not_rewrite_the_pages_after_it():
    new_pages = [NOTICE_OLD[0], ["A brand new inserted page of content."]] + NOTICE_OLD[1:]
    result, _, _ = compare(NOTICE_OLD, new_pages)
    # The vacancy and date text simply moved down a page; it did not change.
    assert ChangeType.NUMBER_CHANGED not in types(result)
    assert ChangeType.DATE_CHANGED not in types(result)
    assert ChangeType.PAGE_ADDED in types(result)


# ---------------------------------------------------------------- evidence


def test_every_change_carries_traceable_evidence():
    new_pages = [
        NOTICE_OLD[0],
        ["Total Vacancies: 654", "Maximum age: 32 years"],
        ["Last date to apply: 15 October 2026"],
    ]
    result, old, new = compare(NOTICE_OLD, new_pages)
    assert len(meaningful(result)) == 3
    for change in result.changes:
        assert change.evidence
        for evidence in change.evidence:
            assert evidence.page is not None
            assert evidence.word_ids or evidence.bbox
            assert evidence.excerpt


def test_evidence_words_really_exist_in_the_documents():
    result, old, new = compare(NOTICE_OLD, [NOTICE_OLD[0], ["Total Vacancies: 654"], NOTICE_OLD[2]])
    old_words = old.word_index()
    new_words = new.word_index()
    for change in result.changes:
        for evidence in change.evidence:
            index = old_words if evidence.side is Side.OLD else new_words
            for word_id in evidence.word_ids:
                assert word_id in index


def test_results_name_the_exact_files_they_came_from():
    old, new = build(NOTICE_OLD), build(NOTICE_OLD[:2])
    result = compare_documents(old, new)
    assert result.old_document.sha256 == old.source.sha256
    assert result.new_document.sha256 == new.source.sha256
    assert result.old_document.page_count == 3 and result.new_document.page_count == 2


def test_no_ai_annotations_are_produced():
    result, _, _ = compare(NOTICE_OLD, [NOTICE_OLD[0], ["Total Vacancies: 654"], NOTICE_OLD[2]])
    assert result.annotations == ()


# ---------------------------------------------------------------- scanned pages


def test_a_scanned_page_is_reported_honestly_and_not_invented():
    old = extract_document(image_only_pdf())
    new = extract_document(image_only_pdf())
    outcome = compare_documents_verbose(old, new)
    assert outcome.diagnostics.ocr_required is True
    assert outcome.diagnostics.new_scanned_pages == [1]
    assert outcome.result.changes == (), "no text may be invented from an image"
    assert any("OCR" in note for note in outcome.diagnostics.notes)


def test_a_document_that_is_partly_scanned_still_compares_its_text_pages():
    import io

    import pikepdf

    def with_scan(pages: list[list[str]]) -> Document:
        text_part = pikepdf.open(io.BytesIO(text_pdf(pages)))
        scan_part = pikepdf.open(io.BytesIO(image_only_pdf()))
        text_part.pages.extend(scan_part.pages)
        buffer = io.BytesIO()
        text_part.save(buffer)
        return extract_document(buffer.getvalue())

    old = with_scan([["Total Vacancies: 627"]])
    new = with_scan([["Total Vacancies: 654"]])
    outcome = compare_documents_verbose(old, new)
    assert outcome.diagnostics.ocr_required is True
    changes = [c for c in outcome.result.changes if c.noise_reason is None]
    assert [c.change_type for c in changes] == [ChangeType.NUMBER_CHANGED]


# ---------------------------------------------------------------- documented limitations


def test_limitation_heavily_rewritten_text_is_reported_as_removal_plus_addition():
    """Documented in text_align.py: past the similarity threshold it is new text."""
    old = [["Applications are invited from eligible candidates for the posts below."]]
    new = [["Zebras migrate across the savannah during the dry season each year."]]
    result, _, _ = compare(old, new)
    assert set(types(result)) == {ChangeType.TEXT_ADDED, ChangeType.TEXT_REMOVED}


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_pages_compare_normally(rotation):
    import io

    import pikepdf

    def rotated(text: str) -> Document:
        with pikepdf.open(io.BytesIO(text_pdf([[text]]))) as pdf:
            pdf.pages[0].rotate(rotation, relative=False)
            buffer = io.BytesIO()
            pdf.save(buffer)
        return extract_document(buffer.getvalue())

    old, new = rotated("Total Vacancies: 627"), rotated("Total Vacancies: 654")
    result = compare_documents(old, new)
    changes = [c for c in result.changes if c.noise_reason is None]
    assert [c.change_type for c in changes] == [ChangeType.NUMBER_CHANGED]
    assert (changes[0].old_value, changes[0].new_value) == ("627", "654")
