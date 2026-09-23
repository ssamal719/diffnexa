"""The engine's webpage endpoints.

Every test runs offline against the local stub server. Nothing here contacts a
real website, so the suite is deterministic and safe to run anywhere.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.web import robots
from diffnexa_engine.web.api import MAX_SNAPSHOT_BYTES

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.stub_server import StubServer  # noqa: E402

SECRET = "w7-test-secret-value"


@pytest.fixture
def server():
    robots.clear_cache()
    stub = StubServer()
    try:
        yield stub
    finally:
        stub.stop()
        robots.clear_cache()


@pytest.fixture
def client(server, monkeypatch):
    """A client whose engine may reach the stub, and nothing else."""
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    return TestClient(build_app())


def snapshot_of(client, server, path="/page"):
    response = client.post("/v1/web/snapshot", json={"url": server.url(path)})
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


# ---------------------------------------------------------------- snapshot


def test_a_public_page_is_captured(client, server):
    snapshot = snapshot_of(client, server)
    assert snapshot["metadata"]["title"] == "Service Terms"
    assert snapshot["nodes"], "the capture must contain the page's content"
    assert len(snapshot["content_sha256"]) == 64
    assert snapshot["render_note"] is None
    texts = " ".join(node["text"] for node in snapshot["nodes"])
    assert "50,000" in texts


def test_a_capture_records_where_and_when_it_came_from(client, server):
    snapshot = snapshot_of(client, server)
    assert snapshot["source"]["url"].endswith("/page")
    assert snapshot["source"]["fetched_at"]
    assert snapshot["source"]["http_status"] == 200


@pytest.mark.parametrize(
    "url, code",
    [
        ("", "bad_request"),
        ("not a url", "url_not_allowed"),
        ("file:///etc/passwd", "url_not_allowed"),
        ("http://169.254.169.254/latest/meta-data/", "url_not_allowed"),
        ("http://10.0.0.1/", "url_not_allowed"),
        ("http://user:pass@example.com/", "url_not_allowed"),
    ],
)
def test_refused_addresses_are_reported_clearly(client, url, code):
    response = client.post("/v1/web/snapshot", json={"url": url})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code
    assert "Traceback" not in response.text


def test_a_missing_url_is_a_bad_request(client):
    assert client.post("/v1/web/snapshot", json={}).json()["error"]["code"] == "bad_request"


def test_an_unreachable_page_is_reported(client, server):
    assert (
        client.post("/v1/web/snapshot", json={"url": server.url("/missing")}).json()["error"]["code"]
        == "url_unreachable"
    )


def test_a_page_that_is_not_html_is_reported(client, server):
    for path in ("/plain", "/pdf"):
        body = client.post("/v1/web/snapshot", json={"url": server.url(path)}).json()
        assert body["error"]["code"] == "url_not_html"


def test_a_javascript_page_is_refused_honestly(client, server):
    body = client.post("/v1/web/snapshot", json={"url": server.url("/js-shell")}).json()
    assert body["error"]["code"] == "page_needs_javascript"
    assert "browser" in body["error"]["message"]


def test_an_oversized_page_is_refused(client, server, monkeypatch):
    monkeypatch.setenv("DIFFNEXA_WEB_MAX_BYTES", "2048")
    small = TestClient(build_app())
    response = small.post("/v1/web/snapshot", json={"url": server.url("/huge")})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "page_too_large"


def test_a_slow_page_times_out(client, server, monkeypatch):
    monkeypatch.setenv("DIFFNEXA_WEB_TIMEOUT_S", "1")
    impatient = TestClient(build_app())
    response = impatient.post("/v1/web/snapshot", json={"url": server.url("/slow")})
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "fetch_timeout"


def test_a_site_that_asks_not_to_be_read_is_respected(client, server, monkeypatch):
    server.robots_body = b"User-agent: *\nDisallow: /\n"
    monkeypatch.setenv("DIFFNEXA_WEB_ROBOTS", "1")
    polite = TestClient(build_app())
    body = polite.post("/v1/web/snapshot", json={"url": server.url("/page")}).json()
    assert body["error"]["code"] == "url_not_allowed"


# ---------------------------------------------------------------- compare


def test_an_unchanged_page_reports_nothing(client, server):
    previous = snapshot_of(client, server)
    response = client.post(
        "/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": previous}
    )
    assert response.status_code == 200
    assert response.json()["counts"]["meaningful"] == 0


def test_a_changed_page_reports_the_change_with_evidence(client, server):
    previous = snapshot_of(client, server)
    server.page_html = server.page_html.replace(b"50,000", b"75,000")

    body = client.post(
        "/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": previous}
    ).json()

    assert body["counts"]["meaningful"] == 1
    change = body["changes"][0]
    assert change["type"] == "NUMBER_CHANGED"
    assert (change["oldValue"], change["newValue"]) == ("50,000", "75,000")
    assert change["delta"] == "+25000 (+50%)"
    assert change["evidence"], "every change carries its evidence"
    assert change["sections"] == ["Service Terms › Pricing"]
    assert body["documents"]["previous"]["sha256"] != body["documents"]["revised"]["sha256"]
    assert "pageCount" not in body["documents"]["previous"]


@pytest.mark.parametrize(
    "payload",
    [
        {"nope": 1},
        "not a snapshot at all",
        {"schema_version": "1"},
        [],
        {"nodes": [{"id": "bad"}]},
    ],
)
def test_a_file_that_is_not_a_capture_is_refused(client, server, payload):
    body = client.post(
        "/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": payload}
    ).json()
    assert body["error"]["code"] == "snapshot_unreadable"


def test_a_missing_capture_is_a_bad_request(client, server):
    body = client.post("/v1/web/compare", json={"url": server.url("/page")}).json()
    assert body["error"]["code"] in ("bad_request", "snapshot_unreadable")


def test_a_capture_of_a_different_page_is_refused(client, server):
    previous = snapshot_of(client, server)
    previous["source"]["url"] = "https://somewhere-else.example.com/other"
    previous["source"]["final_url"] = "https://somewhere-else.example.com/other"
    body = client.post(
        "/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": previous}
    ).json()
    assert body["error"]["code"] == "snapshot_mismatch"


def test_an_edited_capture_is_still_compared_against_its_own_fingerprint(client, server):
    """A tampered capture must not produce changes attributed to the real page."""
    previous = snapshot_of(client, server)
    previous["content_sha256"] = "0" * 64
    response = client.post(
        "/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": previous}
    )
    body = response.json()
    if response.status_code == 200:
        # Evidence is verified against the fingerprint it cites, so nothing
        # unverifiable can survive into the result.
        assert body["counts"]["total"] == 0
    else:
        assert body["error"]["code"] in ("snapshot_unreadable", "snapshot_mismatch")


def test_a_deeply_nested_payload_cannot_crash_the_service(client, server):
    hostile: object = {"a": 1}
    for _ in range(400):
        hostile = {"a": hostile}
    response = client.post("/v1/web/compare", json={"url": server.url("/page"), "previous_snapshot": hostile})
    assert response.status_code in (400, 413)
    assert "error" in response.json()


def test_an_oversized_body_is_refused_before_parsing(client, server):
    padding = "x" * (MAX_SNAPSHOT_BYTES + 1024)
    response = client.post(
        "/v1/web/compare",
        content=f'{{"url": "{server.url("/page")}", "previous_snapshot": "{padding}"}}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "page_too_large"


def test_a_body_that_is_not_json_is_refused(client):
    response = client.post(
        "/v1/web/snapshot", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


# ---------------------------------------------------------------- security


def test_the_web_endpoints_require_credentials(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())

    for path in ("/v1/web/snapshot", "/v1/web/compare"):
        assert secured.post(path, json={"url": server.url("/page")}).status_code == 401
        assert (
            secured.post(
                path,
                json={"url": server.url("/page")},
                headers={"Authorization": "Bearer wrong"},
            ).status_code
            == 403
        )

    allowed = secured.post(
        "/v1/web/snapshot",
        json={"url": server.url("/page")},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert allowed.status_code == 200


def test_no_response_ever_contains_the_secret(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())
    headers = {"Authorization": f"Bearer {SECRET}"}

    responses = [
        secured.post("/v1/web/snapshot", json={"url": server.url("/page")}, headers=headers),
        secured.post("/v1/web/snapshot", json={"url": "file:///etc/passwd"}, headers=headers),
        secured.post("/v1/web/compare", json={"url": server.url("/page")}, headers=headers),
        secured.get("/healthz"),
    ]
    for response in responses:
        assert SECRET not in response.text
        assert SECRET not in str(dict(response.headers))


def test_errors_never_leak_internal_detail(client, server):
    for payload in ({"url": "file:///etc/passwd"}, {"url": server.url("/missing")}):
        text = client.post("/v1/web/snapshot", json=payload).text
        for leak in ("Traceback", "/home/", "diffnexa_engine/", '.py"', "lxml", "socket."):
            assert leak not in text, f"{leak!r} leaked into an error response"


def test_health_is_unchanged_and_still_public(client):
    body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert set(body) == {"status", "engine_version", "limits", "requires_auth", "authenticated", "ai"}
    # AI Change Analyst adds only a yes/no: no provider, model or key.
    assert body["ai"] == {"available": False}
