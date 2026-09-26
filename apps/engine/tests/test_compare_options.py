"""Ignore options for PDF Compare and Excel Compare, and the page pairs PDF Compare returns.

Each option must change what counts as a difference exactly as it says, only
for the comparison that asked for it, and never hide a real change: numbers,
dates and the words around an ignored difference are still compared.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.xlsx.compare import ExcelOptions, compare_xlsx
from diffnexa_engine.xlsx.extract import extract_xlsx

from .helpers.pdfs import text_pdf
from .helpers.xlsx_files import workbook

fastapi = pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    return TestClient(build_app())


# ---------------------------------------------------------------- PDF


def pdf_post(client: TestClient, previous: bytes, revised: bytes, **form: str):
    return client.post(
        "/v1/compare",
        files={
            "previous": ("previous.pdf", previous, "application/pdf"),
            "revised": ("revised.pdf", revised, "application/pdf"),
        },
        data=form,
    )


NOTICE = [
    "Recruitment Notice No. 12/2026",
    "Applications are invited for the post of Junior Assistant.",
    "Total Vacancies: 627",
]


def notice(*replacements: tuple[str, str]) -> bytes:
    lines = list(NOTICE)
    for old, new in replacements:
        lines = [line.replace(old, new) for line in lines]
    return text_pdf([lines])


def meaningful(body: dict) -> list[dict]:
    return [change for change in body["changes"] if not change["isNoise"]]


def test_pdf_capitalisation_is_ignored_by_default_and_compared_when_asked(client):
    old, new = notice(), notice(("Junior Assistant", "junior assistant"))
    default = pdf_post(client, old, new).json()
    assert meaningful(default) == []
    assert default["options"] == {"ignoreCase": True, "ignorePunctuation": False}

    strict = pdf_post(client, old, new, ignore_case="false").json()
    assert strict["options"]["ignoreCase"] is False
    [change] = meaningful(strict)
    assert "junior" in (change["newValue"] or "").lower()


def test_pdf_punctuation_is_compared_by_default_and_ignorable(client):
    old, new = notice(), notice(("Junior Assistant.", "Junior Assistant"))
    assert len(meaningful(pdf_post(client, old, new).json())) == 1
    relaxed = pdf_post(client, old, new, ignore_punctuation="true").json()
    assert meaningful(relaxed) == []
    assert relaxed["options"]["ignorePunctuation"] is True


def test_pdf_ignoring_punctuation_never_hides_a_changed_number(client):
    old, new = notice(), notice(("627", "654"), ("Junior Assistant.", "Junior Assistant"))
    [change] = meaningful(pdf_post(client, old, new, ignore_punctuation="true").json())
    assert (change["oldValue"], change["newValue"]) == ("627", "654")


def test_pdf_invalid_option_values_keep_the_defaults(client):
    old, new = notice(), notice(("Junior Assistant", "junior assistant"))
    body = pdf_post(client, old, new, ignore_case="maybe", ignore_punctuation="1").json()
    assert body["options"] == {"ignoreCase": True, "ignorePunctuation": False}
    assert meaningful(body) == []


def test_pdf_options_apply_to_one_comparison_only(client):
    old, new = notice(), notice(("Junior Assistant", "junior assistant"))
    assert len(meaningful(pdf_post(client, old, new, ignore_case="false").json())) == 1
    assert meaningful(pdf_post(client, old, new).json()) == []


def test_pdf_returns_which_pages_were_paired(client):
    first = ["Page one of the notice", "Total Vacancies: 627"]
    second = ["Page two of the notice", "Last date to apply: 30 September 2026"]
    inserted = ["An inserted page about reservation", "Seats are reserved as per rules"]
    body = pdf_post(client, text_pdf([first, second]), text_pdf([first, inserted, second])).json()
    assert body["pageLinks"] == [
        {"previous": 1, "revised": 1},
        {"previous": None, "revised": 2},
        {"previous": 2, "revised": 3},
    ]


# ---------------------------------------------------------------- Excel


def book(status: str, name: str = "Pro", price: int = 299) -> bytes:
    def build(workbook_):
        sheet = workbook_.active
        sheet.title = "Plans"
        sheet.append(["Plan", "Price", "Status"])
        sheet.append([name, price, status])

    return workbook(build)


def excel_post(client: TestClient, original: bytes, revised: bytes, **form: str):
    return client.post(
        "/v1/excel/compare",
        files={
            "original": ("a.xlsx", original, "application/octet-stream"),
            "revised": ("b.xlsx", revised, "application/octet-stream"),
        },
        data=form,
    )


def test_excel_text_is_compared_exactly_by_default(client):
    body = excel_post(client, book("Paid"), book("paid")).json()
    assert body["options"] == {"ignoreCase": False, "ignoreWhitespace": False}
    [change] = body["changes"]
    assert (change["oldValue"], change["newValue"]) == ("Paid", "paid")


def test_excel_capitalisation_can_be_ignored(client):
    body = excel_post(client, book("Paid"), book("PAID"), ignore_case="true").json()
    assert body["options"]["ignoreCase"] is True
    assert body["changes"] == []


def test_excel_extra_spaces_can_be_ignored(client):
    assert len(excel_post(client, book("Paid in full"), book(" Paid  in full ")).json()["changes"]) == 1
    body = excel_post(client, book("Paid in full"), book(" Paid  in full "), ignore_whitespace="true").json()
    assert body["changes"] == []


def test_excel_ignoring_spaces_never_joins_separate_words(client):
    body = excel_post(client, book("Paid in full"), book("Paidin full"), ignore_whitespace="true").json()
    assert len(body["changes"]) == 1


def test_excel_options_never_hide_a_changed_number(client):
    body = excel_post(
        client, book("Paid"), book("PAID", price=349), ignore_case="true", ignore_whitespace="true"
    ).json()
    [change] = body["changes"]
    assert (change["oldValue"], change["newValue"]) == ("299", "349")


def test_excel_a_row_whose_label_only_changed_case_is_still_matched(client):
    # With capitalisation ignored the row is the same row, so nothing is reported.
    body = excel_post(client, book("Paid", name="Pro"), book("Paid", name="PRO"), ignore_case="true").json()
    assert body["changes"] == []


def test_excel_options_apply_to_one_comparison_only():
    old = extract_xlsx(book("Paid"))
    new = extract_xlsx(book("paid"))
    assert compare_xlsx(old, new, ExcelOptions(ignore_case=True)).changes == []
    assert len(compare_xlsx(old, new).changes) == 1


def test_excel_invalid_option_values_keep_exact_matching(client):
    body = excel_post(client, book("Paid"), book("paid"), ignore_case="yes").json()
    assert body["options"]["ignoreCase"] is False
    assert len(body["changes"]) == 1
