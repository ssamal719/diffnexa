"""The engine's policy endpoint.

Everything runs offline against the local stub server. The endpoint reuses the
webpage fetcher, extraction, comparison, evidence and errors; what these check
is that the classification travels with the result, and that it never replaces
or hides anything the comparison found.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.policy.signals import ClauseTopic
from diffnexa_engine.web import robots

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.stub_server import StubServer  # noqa: E402

SECRET = "p4-test-secret-value"


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


def capture(client, server, path="/policy"):
    response = client.post("/v1/web/snapshot", json={"url": server.url(path)})
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


def compare(client, server, baseline, path="/policy"):
    return client.post("/v1/policy/compare", json={"url": server.url(path), "previous_snapshot": baseline})


def topics_of(change) -> set[str]:
    return {item["topic"] for item in change["policyTopics"]}


# ---------------------------------------------------------------- capture


def test_capturing_a_policy_reuses_the_webpage_capture(client, server):
    """Capturing a policy page is capturing a page; it needs no endpoint of its own."""
    baseline = capture(client, server)
    assert baseline["metadata"]["title"] == "Terms of Service"
    assert baseline["nodes"]
    assert len(baseline["content_sha256"]) == 64


# ---------------------------------------------------------------- comparison


def test_an_unchanged_policy_reports_no_changes(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert body["counts"]["meaningful"] == 0
    assert body["policy"]["changedTopics"] == []


def test_a_retention_change_is_reported_with_its_topic(client, server):
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")

    body = compare(client, server, baseline).json()

    assert body["counts"]["meaningful"] == 1
    change = body["changes"][0]
    assert (change["oldValue"], change["newValue"]) == ("12", "24")
    assert topics_of(change) == {ClauseTopic.DATA_RETENTION.value}
    assert body["policy"]["changedTopics"] == [ClauseTopic.DATA_RETENTION.value]


def test_the_underlying_change_keeps_every_existing_field(client, server):
    """Classification is added beside the change, never in place of it."""
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")
    change = compare(client, server, baseline).json()["changes"][0]

    for field in (
        "id",
        "seq",
        "type",
        "kind",
        "category",
        "oldValue",
        "newValue",
        "delta",
        "confidence",
        "isNoise",
        "sections",
        "evidence",
    ):
        assert field in change, f"{field} was lost"
    assert change["type"] == "NUMBER_CHANGED"
    assert change["delta"]
    assert change["evidence"]


def test_an_unrelated_change_is_returned_unclassified(client, server):
    """A staff count is a real change with no clause topic, and is still reported."""
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"employs 400", b"employs 520")

    body = compare(client, server, baseline).json()

    assert body["counts"]["meaningful"] == 1
    assert body["changes"][0]["policyTopics"] == []
    assert body["policy"]["unclassifiedChanges"] == 1
    assert body["policy"]["changedTopics"] == []


def test_several_changes_carry_their_own_topics(client, server):
    baseline = capture(client, server)
    server.policy_html = (
        server.policy_html.replace(b"for 12 months", b"for 24 months")
        .replace(b"30 days", b"60 days")
        .replace(b"employs 400", b"employs 520")
    )

    body = compare(client, server, baseline).json()

    by_value = {change["newValue"]: change for change in body["changes"]}
    assert topics_of(by_value["24"]) == {ClauseTopic.DATA_RETENTION.value}
    assert topics_of(by_value["60"]) == {ClauseTopic.CANCELLATION.value}
    assert by_value["520"]["policyTopics"] == []
    assert set(body["policy"]["changedTopics"]) == {
        ClauseTopic.DATA_RETENTION.value,
        ClauseTopic.CANCELLATION.value,
    }


# ---------------------------------------------------------------- topic status


def test_three_topic_statuses_are_reported_and_kept_apart(client, server):
    """'Nothing changed here' and 'this was not found' are different statements."""
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")

    topics = {item["id"]: item for item in compare(client, server, baseline).json()["policy"]["topics"]}

    assert topics[ClauseTopic.DATA_RETENTION.value]["status"] == "changed"
    assert topics[ClauseTopic.GOVERNING_LAW.value]["status"] == "present"
    assert topics[ClauseTopic.WARRANTIES.value]["status"] == "not_found"


def test_every_topic_in_the_taxonomy_is_reported(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert {item["id"] for item in body["policy"]["topics"]} == {t.value for t in ClauseTopic}
    for item in body["policy"]["topics"]:
        assert item["label"] and item["blurb"]
        assert item["status"] in ("changed", "present", "not_found")


def test_the_signal_version_is_reported(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert body["policy"]["signalsVersion"]


# ---------------------------------------------------------------- traceability


def test_every_topic_carries_the_phrase_that_produced_it(client, server):
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")

    change = compare(client, server, baseline).json()["changes"][0]
    signal = change["policyTopics"][0]

    assert signal["matchedText"]
    assert signal["source"] in ("heading", "text")
    assert signal["summary"].startswith("Touches ")
    assert change["evidence"], "the change keeps its own evidence"
    assert change["sections"], "and the section it came from"


def test_the_wording_never_judges_the_change(client, server):
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"30 days", b"60 days")
    body = compare(client, server, baseline).text.lower()

    for judgement in (
        "high risk",
        "unfavourable",
        "unfavorable",
        "weakens",
        "legally significant",
        "compliance violation",
        "you should",
    ):
        assert judgement not in body


# ---------------------------------------------------------------- errors


def test_a_baseline_for_another_page_is_refused(client, server):
    baseline = capture(client, server)
    baseline["source"]["url"] = "https://elsewhere.example.com/terms"
    baseline["source"]["final_url"] = "https://elsewhere.example.com/terms"
    body = compare(client, server, baseline).json()
    assert body["error"]["code"] == "snapshot_mismatch"


@pytest.mark.parametrize("payload", [{"nope": 1}, "not a capture", [], {"schema_version": "1"}])
def test_a_file_that_is_not_a_capture_is_refused(client, server, payload):
    body = compare(client, server, payload).json()
    assert body["error"]["code"] == "snapshot_unreadable"


def test_a_blocked_address_is_refused(client, server):
    baseline = capture(client, server)
    body = client.post(
        "/v1/policy/compare",
        json={"url": "http://169.254.169.254/latest/meta-data/", "previous_snapshot": baseline},
    ).json()
    assert body["error"]["code"] == "url_not_allowed"


def test_an_unreachable_page_is_reported(client, server):
    baseline = capture(client, server)
    body = compare(client, server, baseline, path="/missing").json()
    assert body["error"]["code"] in ("url_unreachable", "snapshot_mismatch")


def test_a_page_that_is_not_html_is_reported(client, server):
    baseline = capture(client, server)
    body = compare(client, server, baseline, path="/plain").json()
    assert body["error"]["code"] in ("url_not_html", "snapshot_mismatch")


def test_a_malformed_request_is_refused(client):
    assert client.post("/v1/policy/compare", json={}).json()["error"]["code"] in (
        "bad_request",
        "snapshot_unreadable",
    )
    response = client.post(
        "/v1/policy/compare", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400


def test_errors_never_leak_internal_detail(client, server):
    text = client.post(
        "/v1/policy/compare",
        json={"url": "file:///etc/passwd", "previous_snapshot": capture(client, server)},
    ).text
    for leak in ("Traceback", "/home/", "diffnexa_engine/", "lxml"):
        assert leak not in text


# ---------------------------------------------------------------- security


def test_the_policy_endpoint_requires_credentials(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())

    assert secured.post("/v1/policy/compare", json={}).status_code == 401
    assert (
        secured.post("/v1/policy/compare", json={}, headers={"Authorization": "Bearer wrong"}).status_code
        == 403
    )


def test_no_policy_response_contains_the_secret(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())
    headers = {"Authorization": f"Bearer {SECRET}"}

    baseline = secured.post("/v1/web/snapshot", json={"url": server.url("/policy")}, headers=headers).json()[
        "snapshot"
    ]
    responses = [
        secured.post(
            "/v1/policy/compare",
            json={"url": server.url("/policy"), "previous_snapshot": baseline},
            headers=headers,
        ),
        secured.post("/v1/policy/compare", json={}, headers=headers),
    ]
    for response in responses:
        assert SECRET not in response.text


# ---------------------------------------------------------------- determinism


def test_the_same_comparison_returns_the_same_classification(client, server):
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")

    first = compare(client, server, baseline).json()
    second = compare(client, server, baseline).json()

    assert first["policy"] == second["policy"]
    assert [c["policyTopics"] for c in first["changes"]] == [c["policyTopics"] for c in second["changes"]]


def test_the_webpage_endpoint_is_unchanged_by_all_this(client, server):
    """Website Change Detector must not gain policy fields."""
    baseline = capture(client, server)
    server.policy_html = server.policy_html.replace(b"for 12 months", b"for 24 months")

    body = client.post(
        "/v1/web/compare",
        json={"url": server.url("/policy"), "previous_snapshot": baseline},
    ).json()

    assert "policy" not in body
    assert all("policyTopics" not in change for change in body["changes"])
    assert body["counts"]["meaningful"] == 1
