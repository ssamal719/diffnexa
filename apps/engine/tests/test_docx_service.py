"""The engine's DOCX Compare endpoint.

Two .docx files arrive as a multipart upload, are read in memory and compared.
These check the response shape the website relies on, that every refusal names
which of the two files it was about, that the size ceiling holds, that the
endpoint is protected by the shared secret, and that nothing leaks.
"""

from __future__ import annotations

import json
import logging
import warnings

import pytest

from diffnexa_engine.docx import DOCX_MESSAGES, DocxErrorCode

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.docx_files import body, package, paragraph, table, word  # noqa: E402

SECRET = "docx-test-secret-value"
PRIVATE_SENTENCE = "The confidential settlement amount is 4,250,000."


def agreement(amount: str):
    def build(document) -> None:
        document.add_heading("Fees", 1)
        document.add_paragraph(PRIVATE_SENTENCE)
        table(document, [("Item", "Fee"), ("Setup", amount)])

    return word(build)


ORIGINAL = agreement("$10,000")
REVISED = agreement("$12,000")


@pytest.fixture
def client():
    return TestClient(build_app())


def post(client, original=ORIGINAL, revised=REVISED, headers=None):
    return client.post(
        "/v1/docx/compare",
        files={
            "original": ("a.docx", original, "application/octet-stream"),
            "revised": ("b.docx", revised, "application/octet-stream"),
        },
        headers=headers or {},
    )


def test_two_documents_are_compared(client):
    response = post(client)
    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"] == {"total": 1, "meaningful": 1, "noise": 0}
    [change] = payload["changes"]
    assert (change["group"], change["oldValue"], change["newValue"]) == ("tables", "$10,000", "$12,000")
    assert [e["location"] for e in change["evidence"]] == ["Table 1, row 2, column 2"] * 2
    assert set(payload) == {
        "engineVersion",
        "processingMs",
        "documents",
        "counts",
        "changes",
        "groups",
        "view",
        "diagnostics",
    }
    assert set(payload["documents"]) == {"previous", "revised"}
    # The read-only view of both documents, for the workspace: the cell the
    # evidence cites is marked on each side.
    view = payload["view"]
    assert set(view) == {"original", "revised", "marks"}
    assert {(m["change"], m["side"]) for m in view["marks"]} == {
        (change["id"], "original"),
        (change["id"], "revised"),
    }


def test_identical_documents_report_no_changes(client):
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
        (b"", REVISED, DocxErrorCode.EMPTY_FILE, "original"),
        (ORIGINAL, b"%PDF-1.7\n", DocxErrorCode.NOT_DOCX, "revised"),
        (ORIGINAL, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512, DocxErrorCode.LEGACY_DOC, "revised"),
        (
            package(
                body(paragraph("x")), content_type="application/vnd.ms-word.document.macroEnabled.main+xml"
            ),
            REVISED,
            DocxErrorCode.MACRO_ENABLED,
            "original",
        ),
        (
            ORIGINAL,
            package(body(paragraph("x")), members=[("../evil", b"x")]),
            DocxErrorCode.UNREADABLE,
            "revised",
        ),
        (ORIGINAL[: len(ORIGINAL) // 2], REVISED, DocxErrorCode.UNREADABLE, "original"),
    ],
)
def test_a_refusal_names_the_file_and_uses_the_shared_message(client, original, revised, code, side):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        response = post(client, original=original, revised=revised)
    assert response.status_code == 400
    assert response.json() == {"error": {"code": code.value, "message": DOCX_MESSAGES[code], "side": side}}


def test_an_oversized_document_is_refused_with_413(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_DOCX_MAX_FILE_MB", "1")
    client = TestClient(build_app())
    big = ORIGINAL + b"\x00" * (1024 * 1024)
    response = post(client, revised=big)
    assert response.status_code == 413
    assert response.json()["error"] == {
        "code": "docx_too_large",
        "message": DOCX_MESSAGES[DocxErrorCode.TOO_LARGE],
        "side": "revised",
    }


def test_errors_never_leak_internal_detail(client):
    for original in (b"PK\x03\x04garbage", package("<w:document><w:body><w:p>")):
        text = post(client, original=original).text
        for leak in ("Traceback", "/home/", "diffnexa_engine", "lxml", "zipfile", "BadZipFile"):
            assert leak not in text


def test_document_text_is_never_logged(client, caplog, capsys):
    with caplog.at_level(logging.DEBUG):
        post(client)
        post(client, original=package(body(paragraph(PRIVATE_SENTENCE)) + "<broken"))
    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert "confidential settlement" not in output


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
    contract = json.loads((repo_root / "packages/contracts/errors.json").read_text())["docx_messages"]
    assert contract == {code.value: message for code, message in DOCX_MESSAGES.items()}
