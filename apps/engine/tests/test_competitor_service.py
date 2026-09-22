"""The engine's Competitor Monitor endpoint.

Everything runs offline against the local stub server. The endpoint reuses the
webpage fetcher, extraction, comparison, evidence and errors; these check that
the signal travels with each change, that the per-signal counts add up to the
changes found, and that nothing the comparison found is replaced or hidden.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.competitor import CompetitorSignal
from diffnexa_engine.web import robots

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.stub_server import StubServer  # noqa: E402

SECRET = "competitor-test-secret-value"


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
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    return TestClient(build_app())


def capture(client, server, path="/competitor"):
    response = client.post("/v1/web/snapshot", json={"url": server.url(path)})
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


def compare(client, server, baseline, path="/competitor"):
    return client.post(
        "/v1/competitor/compare", json={"url": server.url(path), "previous_snapshot": baseline}
    )


def edit(server, old: bytes, new: bytes) -> None:
    assert old in server.competitor_html, old
    server.competitor_html = server.competitor_html.replace(old, new)


# ---------------------------------------------------------------- comparison


def test_an_unchanged_page_reports_no_changes(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert body["counts"]["meaningful"] == 0
    assert body["changes"] == []
    assert body["competitor"]["changedSignals"] == []
    assert all(signal["changeCount"] == 0 for signal in body["competitor"]["signals"])


def test_a_price_change_is_reported_with_its_signal(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")

    body = compare(client, server, baseline).json()

    assert body["counts"]["meaningful"] == 1
    change = body["changes"][0]
    assert (change["oldValue"], change["newValue"]) == ("$9", "$12")
    assert change["competitorSignal"]["signal"] == CompetitorSignal.PRICING.value
    assert change["competitorSignal"]["summary"] == "Touches Pricing & Commercial"
    assert change["competitorSignal"]["matchedText"] == "$12"
    assert body["competitor"]["changedSignals"] == [CompetitorSignal.PRICING.value]


def test_every_change_keeps_every_existing_field(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")

    web = client.post(
        "/v1/web/compare", json={"url": server.url("/competitor"), "previous_snapshot": baseline}
    ).json()
    competitor = compare(client, server, baseline).json()

    assert len(web["changes"]) == len(competitor["changes"])
    for plain, extended in zip(web["changes"], competitor["changes"], strict=True):
        assert {key: value for key, value in extended.items() if key != "competitorSignal"} == plain
    assert competitor["counts"] == web["counts"]


def test_a_mixed_edit_reaches_several_signals_and_the_counts_add_up(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")
    edit(server, b"<li>Gantt charts</li>", b"<li>Gantt charts</li><li>Time tracking</li>")
    edit(server, b">Start free trial<", b">Book a demo<")
    edit(server, b"for teams</h1>", b"for growing teams</h1>")
    edit(server, b"<title>Acme Pricing</title>", b"<title>Acme Pricing and Plans</title>")
    edit(server, b"acme.example.com/blog", b"acme.example.com/news")

    body = compare(client, server, baseline).json()
    changed = set(body["competitor"]["changedSignals"])
    assert changed == {
        CompetitorSignal.PRICING.value,
        CompetitorSignal.FEATURES.value,
        CompetitorSignal.MESSAGING.value,
        CompetitorSignal.CTA.value,
        CompetitorSignal.SEO.value,
        CompetitorSignal.LINKS.value,
    }

    meaningful = [change for change in body["changes"] if not change["isNoise"]]
    assert sum(signal["changeCount"] for signal in body["competitor"]["signals"]) == len(meaningful)
    grouped = sorted(cid for signal in body["competitor"]["signals"] for cid in signal["changeIds"])
    assert grouped == sorted(change["id"] for change in meaningful)
    for change in body["changes"]:
        assert change["competitorSignal"] is not None, "every change has a signal"
        assert change["evidence"], "and keeps its evidence"


def test_every_signal_in_the_taxonomy_is_reported_in_order(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert [signal["id"] for signal in body["competitor"]["signals"]] == [s.value for s in CompetitorSignal]
    assert body["competitor"]["signalsVersion"]


def test_the_wording_never_judges_the_change(client, server):
    baseline = capture(client, server)
    edit(server, b"$29 per month", b"$49 per month")
    body = compare(client, server, baseline).text.lower()
    for judgement in (
        "important change",
        "critical change",
        "major competitor move",
        "threat",
        "risk",
        "opportunity",
        "strategic move",
        "aggressive",
        "winning",
        "losing",
    ):
        assert judgement not in body


# ---------------------------------------------------------------- errors


def test_a_baseline_for_another_page_is_refused(client, server):
    baseline = capture(client, server)
    baseline["source"]["url"] = "https://elsewhere.example.com/pricing"
    baseline["source"]["final_url"] = "https://elsewhere.example.com/pricing"
    response = compare(client, server, baseline)
    assert response.json()["error"]["code"] == "snapshot_mismatch"


def test_a_policy_or_website_baseline_is_accepted(client, server):
    """A capture is a capture: baselines from the other web tools work unchanged."""
    baseline = capture(client, server)
    web = client.post(
        "/v1/web/compare", json={"url": server.url("/competitor"), "previous_snapshot": baseline}
    )
    policy = client.post(
        "/v1/policy/compare", json={"url": server.url("/competitor"), "previous_snapshot": baseline}
    )
    competitor = compare(client, server, baseline)
    assert web.status_code == policy.status_code == competitor.status_code == 200


@pytest.mark.parametrize("payload", [{"nope": 1}, "not a capture", [], {"schema_version": "1"}])
def test_a_file_that_is_not_a_capture_is_refused(client, server, payload):
    body = compare(client, server, payload).json()
    assert body["error"]["code"] == "snapshot_unreadable"


def test_a_blocked_address_is_refused(client, server):
    baseline = capture(client, server)
    body = client.post(
        "/v1/competitor/compare",
        json={"url": "http://169.254.169.254/latest/meta-data/", "previous_snapshot": baseline},
    ).json()
    assert body["error"]["code"] == "url_not_allowed"


def test_a_non_web_scheme_is_refused(client, server):
    body = client.post(
        "/v1/competitor/compare",
        json={"url": "file:///etc/passwd", "previous_snapshot": capture(client, server)},
    ).json()
    assert body["error"]["code"] == "url_not_allowed"


def test_an_unreachable_page_is_reported(client, server):
    baseline = capture(client, server)
    body = compare(client, server, baseline, path="/missing").json()
    assert body["error"]["code"] in ("url_unreachable", "snapshot_mismatch")


def test_a_malformed_request_is_refused(client):
    assert client.post("/v1/competitor/compare", json={}).json()["error"]["code"] in (
        "bad_request",
        "snapshot_unreadable",
    )
    response = client.post(
        "/v1/competitor/compare", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400


def test_errors_never_leak_internal_detail(client, server):
    text = client.post(
        "/v1/competitor/compare",
        json={"url": "file:///etc/passwd", "previous_snapshot": capture(client, server)},
    ).text
    for leak in ("Traceback", "/home/", "diffnexa_engine/", "lxml"):
        assert leak not in text


def test_labels_sent_by_a_client_are_ignored(client, server):
    """Page type and competitor name are the reader's; they cannot change the result."""
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")
    plain = compare(client, server, baseline).json()
    labelled = client.post(
        "/v1/competitor/compare",
        json={
            "url": server.url("/competitor"),
            "previous_snapshot": baseline,
            "page_type": "changelog",
            "competitor": "Someone Else",
        },
    ).json()
    plain.pop("processingMs")
    labelled.pop("processingMs")
    assert plain == labelled


# ---------------------------------------------------------------- security


def test_the_endpoint_requires_credentials(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())

    assert secured.post("/v1/competitor/compare", json={}).status_code == 401
    wrong = secured.post("/v1/competitor/compare", json={}, headers={"Authorization": "Bearer wrong"})
    assert wrong.status_code == 403


def test_no_response_contains_the_secret(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())
    headers = {"Authorization": f"Bearer {SECRET}"}

    snapshot = secured.post("/v1/web/snapshot", json={"url": server.url("/competitor")}, headers=headers)
    baseline = snapshot.json()["snapshot"]
    responses = [
        secured.post(
            "/v1/competitor/compare",
            json={"url": server.url("/competitor"), "previous_snapshot": baseline},
            headers=headers,
        ),
        secured.post("/v1/competitor/compare", json={}, headers=headers),
        secured.post("/v1/competitor/compare", json={}),
    ]
    for response in responses:
        assert SECRET not in response.text
