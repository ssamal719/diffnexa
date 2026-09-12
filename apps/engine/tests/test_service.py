"""Tests for the engine's HTTP service, driven through a real test client."""

from __future__ import annotations

import pytest

from diffnexa_engine.config import EngineLimits

from .helpers.pdfs import encrypted_pdf, image_only_pdf, padded_pdf, text_pdf

fastapi = pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

NOTICE_OLD = text_pdf(
    [
        ["Recruitment Notice No. 12/2026"],
        ["Total Vacancies: 627", "Maximum age: 30 years"],
        ["Last date to apply: 30 September 2026"],
    ]
)
NOTICE_NEW = text_pdf(
    [
        ["Recruitment Notice No. 12/2026"],
        ["Total Vacancies: 654", "Maximum age: 30 years"],
        ["Last date to apply: 15 October 2026"],
    ]
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(build_app())


def post(client: TestClient, previous: bytes, revised: bytes):
    return client.post(
        "/v1/compare",
        files={
            "previous": ("previous.pdf", previous, "application/pdf"),
            "revised": ("revised.pdf", revised, "application/pdf"),
        },
    )


def test_health_reports_version_and_limits(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    limits = EngineLimits.from_env()
    assert body["status"] == "ok"
    assert body["engine_version"]
    assert body["limits"]["max_pages"] == limits.max_pages


def test_comparison_returns_real_changes(client):
    response = post(client, NOTICE_OLD, NOTICE_NEW)
    assert response.status_code == 200
    body = response.json()

    assert body["counts"]["meaningful"] == 2
    kinds = {change["type"] for change in body["changes"]}
    assert kinds == {"NUMBER_CHANGED", "DATE_CHANGED"}

    number = next(c for c in body["changes"] if c["type"] == "NUMBER_CHANGED")
    assert (number["oldValue"], number["newValue"]) == ("627", "654")
    assert number["delta"] == "+27 (+4.31%)"
    assert number["label"] == "Total Vacancies"
    assert number["oldPages"] == [2] and number["newPages"] == [2]
    assert number["evidence"], "every change carries evidence"
    assert all(item["page"] for item in number["evidence"])
    assert any(item["excerpt"] for item in number["evidence"])

    date = next(c for c in body["changes"] if c["type"] == "DATE_CHANGED")
    assert date["delta"] == "15 days later"


def test_documents_are_identified_by_fingerprint(client):
    body = post(client, NOTICE_OLD, NOTICE_NEW).json()
    assert len(body["documents"]["previous"]["sha256"]) == 64
    assert body["documents"]["previous"]["pageCount"] == 3
    assert body["documents"]["previous"]["sha256"] != body["documents"]["revised"]["sha256"]


def test_identical_documents_report_no_changes(client):
    body = post(client, NOTICE_OLD, NOTICE_OLD).json()
    assert body["counts"]["total"] == 0
    assert body["changes"] == []


def test_password_protected_file_gets_a_friendly_message(client):
    locked = encrypted_pdf(text_pdf([["secret"]]), user="pw")
    response = post(client, locked, NOTICE_NEW)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "password_protected"
    assert error["side"] == "previous"
    assert "password protected" in error["message"]
    assert "Traceback" not in response.text and "pikepdf" not in response.text


def test_a_file_that_is_not_a_pdf_is_rejected(client):
    response = post(client, b"GIF89a not a pdf at all", NOTICE_NEW)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "not_pdf"


def test_damaged_file_is_rejected(client):
    response = post(client, NOTICE_OLD[: len(NOTICE_OLD) // 3], NOTICE_NEW)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "corrupted"


def test_oversized_file_is_refused(client, monkeypatch):
    monkeypatch.setenv("DIFFNEXA_MAX_FILE_MB", "1")
    small_limit_client = TestClient(build_app())
    big = padded_pdf(NOTICE_OLD, 2 * 1024 * 1024)
    assert len(big) > 1024 * 1024
    response = post(small_limit_client, big, NOTICE_NEW)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_scanned_documents_are_reported_honestly(client):
    scan = image_only_pdf()
    body = post(client, scan, scan).json()
    assert body["diagnostics"]["ocrRequired"] is True
    assert body["diagnostics"]["revisedScannedPages"] == [1]
    assert body["changes"] == [], "no text may be invented from an image"
    assert any("OCR" in note for note in body["diagnostics"]["notes"])


def test_missing_file_is_a_validation_error(client):
    response = client.post("/v1/compare", files={"previous": ("previous.pdf", NOTICE_OLD, "application/pdf")})
    assert response.status_code == 422


def test_no_interactive_docs_are_exposed(client):
    assert client.get("/docs").status_code == 404
