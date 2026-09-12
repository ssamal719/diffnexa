"""Tests for the engine's shared-secret authentication."""

from __future__ import annotations

import pytest

from diffnexa_engine.service.auth import check_credentials, configured_secret, extract_bearer_token

from .helpers.pdfs import text_pdf

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

SECRET = "correct-horse-battery-staple"
PDF = text_pdf([["Total Vacancies: 627"]])


@pytest.fixture
def secured_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    return TestClient(build_app())


@pytest.fixture
def open_client(monkeypatch) -> TestClient:
    monkeypatch.delenv("ENGINE_SHARED_SECRET", raising=False)
    return TestClient(build_app())


def compare(client: TestClient, headers: dict[str, str] | None = None):
    return client.post(
        "/v1/compare",
        files={
            "previous": ("previous.pdf", PDF, "application/pdf"),
            "revised": ("revised.pdf", PDF, "application/pdf"),
        },
        headers=headers or {},
    )


# ---------------------------------------------------------------- header parsing


@pytest.mark.parametrize(
    "header, expected",
    [
        ("Bearer abc123", "abc123"),
        ("bearer abc123", "abc123"),  # the scheme is case-insensitive
        ("BEARER   abc123  ", "abc123"),
        (None, None),
        ("", None),
        ("abc123", None),  # no scheme
        ("Basic abc123", None),  # wrong scheme
        ("Bearer", None),  # no token
        ("Bearer    ", None),
    ],
)
def test_bearer_token_parsing(header, expected):
    assert extract_bearer_token(header) == expected


def test_secret_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", "  spaced-secret  ")
    assert configured_secret() == "spaced-secret"
    monkeypatch.setenv("ENGINE_SHARED_SECRET", "   ")
    assert configured_secret() is None
    monkeypatch.delenv("ENGINE_SHARED_SECRET", raising=False)
    assert configured_secret() is None


@pytest.mark.parametrize(
    "header, secret, allowed, status",
    [
        ("Bearer s3cret", "s3cret", True, None),
        (None, "s3cret", False, 401),
        ("", "s3cret", False, 401),
        ("Basic s3cret", "s3cret", False, 401),
        ("Bearer wrong", "s3cret", False, 403),
        ("Bearer s3cre", "s3cret", False, 403),  # a prefix is not enough
        ("Bearer s3cretX", "s3cret", False, 403),
        (None, None, True, None),  # authentication switched off
        ("Bearer anything", None, True, None),
    ],
)
def test_credential_checks(header, secret, allowed, status):
    assert check_credentials(header, secret) == (allowed, status)


# ---------------------------------------------------------------- the live service


def test_comparison_needs_credentials_when_a_secret_is_set(secured_client):
    response = compare(secured_client)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_wrong_credentials_are_forbidden(secured_client):
    response = compare(secured_client, {"Authorization": "Bearer wrong-secret"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_correct_credentials_are_accepted(secured_client):
    response = compare(secured_client, {"Authorization": f"Bearer {SECRET}"})
    assert response.status_code == 200
    assert response.json()["counts"]["total"] == 0  # same file both sides


def test_refusals_never_reveal_the_secret(secured_client):
    for headers in ({}, {"Authorization": "Bearer wrong-secret"}):
        response = compare(secured_client, headers)
        assert SECRET not in response.text
        assert SECRET not in str(dict(response.headers))


def test_health_check_stays_reachable_without_credentials(secured_client):
    """Hosting platforms poll a fixed URL and cannot be told to send a header."""
    response = secured_client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_check_exposes_nothing_sensitive(secured_client):
    body = secured_client.get("/healthz").json()
    assert set(body) == {"status", "engine_version", "limits", "requires_auth", "authenticated"}
    assert SECRET not in secured_client.get("/healthz").text


def test_health_check_reports_whether_our_credentials_work(secured_client):
    """So a mismatched secret is visible instead of silently failing later."""
    anonymous = secured_client.get("/healthz").json()
    assert anonymous["requires_auth"] is True and anonymous["authenticated"] is False

    wrong = secured_client.get("/healthz", headers={"Authorization": "Bearer nope"}).json()
    assert wrong["authenticated"] is False

    right = secured_client.get("/healthz", headers={"Authorization": f"Bearer {SECRET}"}).json()
    assert right["authenticated"] is True


def test_health_check_says_auth_is_off_when_no_secret_is_set(open_client):
    body = open_client.get("/healthz").json()
    assert body["requires_auth"] is False and body["authenticated"] is True


def test_health_check_also_accepts_credentials(secured_client):
    """The website sends them anyway; that must not cause a rejection."""
    response = secured_client.get("/healthz", headers={"Authorization": f"Bearer {SECRET}"})
    assert response.status_code == 200


def test_engine_runs_open_when_no_secret_is_configured(open_client):
    """Local development keeps working without any configuration."""
    assert compare(open_client).status_code == 200
    assert open_client.get("/healthz").status_code == 200


def test_comparison_results_are_unchanged_by_authentication(secured_client, open_client):
    """Authentication must not touch what the comparison produces."""
    new_pdf = text_pdf([["Total Vacancies: 654"]])

    def run(client: TestClient, headers: dict[str, str]):
        return client.post(
            "/v1/compare",
            files={
                "previous": ("previous.pdf", PDF, "application/pdf"),
                "revised": ("revised.pdf", new_pdf, "application/pdf"),
            },
            headers=headers,
        ).json()

    secured = run(secured_client, {"Authorization": f"Bearer {SECRET}"})
    unsecured = run(open_client, {})
    secured.pop("processingMs")
    unsecured.pop("processingMs")
    assert secured == unsecured
