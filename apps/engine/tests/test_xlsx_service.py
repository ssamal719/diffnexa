"""The engine's Excel Compare endpoint.

Two .xlsx files arrive as a multipart upload, are read in memory and compared.
These check the response shape the workspace relies on, that each refusal names
which file it is about, that the size ceiling holds, that the endpoint is
protected by the shared secret, and that nothing leaks.
"""

from __future__ import annotations

import json
import logging
import warnings

import pytest

from diffnexa_engine.xlsx import EXCEL_MESSAGES, ExcelErrorCode

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.xlsx_files import package, sheet_xml, workbook  # noqa: E402

SECRET = "excel-test-secret-value"
PRIVATE = "Confidential payroll total"


def pricing(price: int) -> bytes:
    def build(book):
        sheet = book.active
        sheet.title = "Pricing"
        sheet.append(["Plan", "Price", PRIVATE])
        sheet.append(["Pro", price, 185000])

    return workbook(build)


ORIGINAL = pricing(299)
REVISED = pricing(349)


@pytest.fixture
def client():
    return TestClient(build_app())


def post(client, original=ORIGINAL, revised=REVISED, headers=None):
    return client.post(
        "/v1/excel/compare",
        files={
            "original": ("a.xlsx", original, "application/octet-stream"),
            "revised": ("b.xlsx", revised, "application/octet-stream"),
        },
        headers=headers or {},
    )


def test_two_workbooks_are_compared(client):
    response = post(client)
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "engineVersion",
        "processingMs",
        "workbooks",
        "counts",
        "groups",
        "changes",
        "sheets",
        "grids",
        "diagnostics",
    }
    [change] = payload["changes"]
    assert (change["sheet"], change["ref"], change["oldValue"], change["newValue"]) == (
        "Pricing",
        "B2",
        "299",
        "349",
    )
    assert change["evidence"] == [
        {"side": "old", "sheet": "Pricing", "cell": "B2", "excerpt": "299"},
        {"side": "new", "sheet": "Pricing", "cell": "B2", "excerpt": "349"},
    ]
    assert payload["grids"]["original"][0]["name"] == "Pricing"


def test_identical_workbooks_report_no_changes(client):
    payload = post(client, revised=ORIGINAL).json()
    assert payload["counts"]["total"] == 0
    assert payload["changes"] == []


def test_the_response_is_the_same_every_time_apart_from_timing(client):
    runs = []
    for _ in range(2):
        payload = post(client).json()
        payload.pop("processingMs")
        runs.append(json.dumps(payload, sort_keys=True))
    assert runs[0] == runs[1]


@pytest.mark.parametrize(
    ("original", "revised", "code", "side"),
    [
        (b"", REVISED, ExcelErrorCode.EMPTY_FILE, "original"),
        (ORIGINAL, b"%PDF-1.7\n", ExcelErrorCode.NOT_XLSX, "revised"),
        (ORIGINAL, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512, ExcelErrorCode.LEGACY_XLS, "revised"),
        (
            package(content_type="application/vnd.ms-excel.sheet.macroEnabled.main+xml"),
            REVISED,
            ExcelErrorCode.MACRO_ENABLED,
            "original",
        ),
        (ORIGINAL, package(members=[("../evil", b"x")]), ExcelErrorCode.UNREADABLE, "revised"),
        (ORIGINAL[: len(ORIGINAL) // 2], REVISED, ExcelErrorCode.UNREADABLE, "original"),
    ],
)
def test_a_refusal_names_the_file_and_uses_the_shared_message(client, original, revised, code, side):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        response = post(client, original=original, revised=revised)
    assert response.status_code == 400
    assert response.json() == {"error": {"code": code.value, "message": EXCEL_MESSAGES[code], "side": side}}


def test_an_oversized_workbook_is_refused_with_413(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_EXCEL_MAX_FILE_MB", "1")
    client = TestClient(build_app())
    response = post(client, revised=ORIGINAL + b"\x00" * (1024 * 1024))
    assert response.status_code == 413
    assert response.json()["error"] == {
        "code": "excel_too_large",
        "message": EXCEL_MESSAGES[ExcelErrorCode.TOO_LARGE],
        "side": "revised",
    }


def test_errors_never_leak_internal_detail(client):
    for original in (b"PK\x03\x04garbage", package({"S": "<worksheet><sheetData><row>"})):
        text = post(client, original=original).text
        for leak in ("Traceback", "/home/", "diffnexa_engine", "lxml", "zipfile", "BadZipFile"):
            assert leak not in text


def test_workbook_content_is_never_logged(client, caplog, capsys):
    with caplog.at_level(logging.DEBUG):
        post(client)
        broken = package(
            {"S": sheet_xml(f'<row r="1"><c r="A1" t="inlineStr"><is><t>{PRIVATE}</t></is></c>')}
        )
        post(client, original=broken)
    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert PRIVATE not in output


def test_the_endpoint_requires_credentials(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    secured = TestClient(build_app())
    assert post(secured).status_code == 401
    assert post(secured, headers={"Authorization": "Bearer wrong"}).status_code == 403
    assert post(secured, headers={"Authorization": f"Bearer {SECRET}"}).status_code == 200


def test_no_response_contains_the_secret(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    secured = TestClient(build_app())
    headers = {"Authorization": f"Bearer {SECRET}"}
    for response in (
        post(secured, headers=headers),
        post(secured, original=b"", headers=headers),
        post(secured),
        post(secured, headers={"Authorization": "Bearer wrong"}),
    ):
        assert SECRET not in response.text


def test_interactive_docs_stay_disabled(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_the_engine_messages_match_the_shared_contract(repo_root):
    contract = json.loads((repo_root / "packages/contracts/errors.json").read_text())["excel_messages"]
    assert contract == {code.value: message for code, message in EXCEL_MESSAGES.items()}
