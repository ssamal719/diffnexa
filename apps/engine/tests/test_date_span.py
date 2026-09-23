"""A date's evidence is the date's own words, and nothing next to it.

Regression: the helper that finds which words spell a changed date used to
accept any run of words that merely *contained* a date. In "Maximum age: 30
years. Deadline: 30 September 2026. Vacancies: 627." the run "30 years.
Deadline: 30 September 2026" was taken as the date, so the age change was
swallowed into it, the date was reported twice and the vacancy change was lost.
The PDF engine and the webpage engine (which Word comparison reuses) carried the
same helper; all three are checked here.
"""

from __future__ import annotations

from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.compare import compare_documents
from diffnexa_engine.compare.values import parse_whole_date
from diffnexa_engine.contracts import verify_traceability
from diffnexa_engine.docx import extract_docx
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot

from .helpers.docx_files import word
from .helpers.pdfs import text_pdf

OLD = "Maximum age: 30 years. Deadline: 30 September 2026. Vacancies: 627."
NEW = "Maximum age: 32 years. Deadline: 15 October 2026. Vacancies: 654."
EXPECTED = [
    ("date", "30 September 2026", "15 October 2026"),
    ("number", "30", "32"),
    ("number", "627", "654"),
]


def found(changes) -> list[tuple[str, str | None, str | None]]:
    return sorted(
        (change.category.value, change.old_value, change.new_value)
        for change in changes
        if change.noise_reason is None
    )


def test_a_whole_date_is_only_the_date():
    assert parse_whole_date("30 September 2026.").text == "30 September 2026"
    assert parse_whole_date("(15 October 2026)").text == "15 October 2026"
    assert parse_whole_date("Deadline: 30 September 2026") is None
    assert parse_whole_date("30 years. Deadline: 30 September 2026") is None


def test_webpages_report_each_value_once():
    def page(text: str):
        return extract_snapshot(
            f"<html><body><main><p>{text}</p></main></body></html>",
            url="https://example.com/notice",
            fetched_at="2026-01-01T00:00:00+00:00",
        )

    outcome = compare_snapshots_verbose(page(OLD), page(NEW))
    assert found(outcome.result.changes) == sorted(EXPECTED)


def test_word_documents_report_each_value_once():
    old = extract_docx(word(lambda document: document.add_paragraph(OLD)))
    new = extract_docx(word(lambda document: document.add_paragraph(NEW)))
    assert found(compare_docx(old, new).result.changes) == sorted(EXPECTED)


def test_pdfs_report_each_value_once():
    old, new = extract_document(text_pdf([[OLD]])), extract_document(text_pdf([[NEW]]))
    result = compare_documents(old, new)
    assert verify_traceability(result, old, new) == []
    assert found(result.changes) == sorted(EXPECTED)


def test_date_evidence_cites_only_the_date():
    def page(text: str):
        return extract_snapshot(
            f"<html><body><main><p>{text}</p></main></body></html>",
            url="https://example.com/notice",
            fetched_at="2026-01-01T00:00:00+00:00",
        )

    outcome = compare_snapshots_verbose(
        page("Delivery is scheduled for 30 June 2026."), page("Delivery is scheduled for 15 July 2026.")
    )
    [change] = outcome.result.changes
    assert [evidence.excerpt for evidence in change.evidence] == ["30 June 2026.", "15 July 2026."]
