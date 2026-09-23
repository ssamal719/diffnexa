"""The engine's Price Monitor endpoint.

Offline, against the local stub server. The endpoint reuses the webpage
fetcher, extraction, comparison, evidence and errors; these check that the
category travels with each change, that the per-category counts add up to the
changes found, and that nothing the comparison found is hidden.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.price import PriceCategory
from diffnexa_engine.web import robots

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

from .helpers.stub_server import StubServer  # noqa: E402

SECRET = "price-test-secret-value"


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


def capture(client, server, path="/price"):
    response = client.post("/v1/web/snapshot", json={"url": server.url(path)})
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


def compare(client, server, baseline, path="/price", **extra):
    return client.post(
        "/v1/price/compare", json={"url": server.url(path), "previous_snapshot": baseline, **extra}
    )


def edit(server, old: bytes, new: bytes) -> None:
    assert old in server.price_html, old
    server.price_html = server.price_html.replace(old, new)


def test_capturing_a_pricing_page_reuses_the_webpage_capture(client, server):
    baseline = capture(client, server)
    assert baseline["metadata"]["title"] == "Acme Pricing"
    assert baseline["nodes"]
    assert len(baseline["content_sha256"]) == 64


def test_an_unchanged_page_reports_no_changes(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert body["counts"]["meaningful"] == 0
    assert body["changes"] == []
    assert body["price"]["changedCategories"] == []
    assert all(category["changeCount"] == 0 for category in body["price"]["categories"])


def test_a_price_change_is_reported_with_its_category(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")

    body = compare(client, server, baseline).json()
    assert body["counts"]["meaningful"] == 1
    change = body["changes"][0]
    assert (change["oldValue"], change["newValue"]) == ("$9", "$12")
    assert change["priceCategory"]["category"] == PriceCategory.PRICE.value
    assert change["priceCategory"]["label"] == "Price"
    assert change["priceCategory"]["matchedText"] == "$12"
    assert body["price"]["changedCategories"] == [PriceCategory.PRICE.value]


def test_every_change_keeps_every_existing_field(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")
    web = client.post(
        "/v1/web/compare", json={"url": server.url("/price"), "previous_snapshot": baseline}
    ).json()
    price = compare(client, server, baseline).json()
    assert len(web["changes"]) == len(price["changes"])
    for plain, extended in zip(web["changes"], price["changes"], strict=True):
        assert {key: value for key, value in extended.items() if key != "priceCategory"} == plain
    assert price["counts"] == web["counts"]


def test_a_mixed_edit_reaches_several_categories_and_counts_add_up(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")
    edit(server, b"now $29", b"now $25")
    edit(server, b"Status: Available", b"Status: Contact sales")
    edit(server, b"<title>Acme Pricing</title>", b"<title>Acme Pricing 2026</title>")
    edit(server, b"/blog", b"/news")
    edit(server, b"12,000 teams", b"15,000 teams")

    body = compare(client, server, baseline).json()
    assert set(body["price"]["changedCategories"]) == {
        PriceCategory.PRICE.value,
        PriceCategory.DISCOUNT.value,
        PriceCategory.AVAILABILITY.value,
        PriceCategory.OTHER.value,
    }
    meaningful = [change for change in body["changes"] if not change["isNoise"]]
    assert sum(category["changeCount"] for category in body["price"]["categories"]) == len(meaningful)
    grouped = sorted(cid for category in body["price"]["categories"] for cid in category["changeIds"])
    assert grouped == sorted(change["id"] for change in meaningful)
    other = next(c for c in body["price"]["categories"] if c["id"] == "other")
    assert other["changeCount"] == 3, "title, link and ordinary number are all still shown"
    for change in body["changes"]:
        assert change["priceCategory"] is not None
        assert change["evidence"]


def test_page_type_and_labels_do_not_change_the_result(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$12 per month")
    plain = compare(client, server, baseline).json()
    labelled = compare(
        client, server, baseline, page_type="subscription_plan", product="GitHub Copilot"
    ).json()
    plain.pop("processingMs")
    labelled.pop("processingMs")
    assert plain == labelled


def test_every_category_is_reported_in_order(client, server):
    body = compare(client, server, capture(client, server)).json()
    assert [category["id"] for category in body["price"]["categories"]] == [c.value for c in PriceCategory]
    assert body["price"]["rulesVersion"]


def test_no_evaluative_wording_appears(client, server):
    baseline = capture(client, server)
    edit(server, b"$9 per month", b"$99 per month")
    text = compare(client, server, baseline).text.lower()
    for word in (
        "significant",
        "expensive",
        "cheapest",
        "best price",
        "better deal",
        "worse deal",
        "undercut",
    ):
        assert word not in text


def test_a_baseline_from_the_other_web_tools_is_accepted(client, server):
    baseline = capture(client, server)
    for endpoint in ("/v1/web/compare", "/v1/policy/compare", "/v1/competitor/compare", "/v1/price/compare"):
        response = client.post(endpoint, json={"url": server.url("/price"), "previous_snapshot": baseline})
        assert response.status_code == 200, endpoint


def test_a_baseline_for_another_page_is_refused(client, server):
    baseline = capture(client, server)
    baseline["source"]["url"] = "https://elsewhere.example.com/pricing"
    baseline["source"]["final_url"] = "https://elsewhere.example.com/pricing"
    assert compare(client, server, baseline).json()["error"]["code"] == "snapshot_mismatch"


@pytest.mark.parametrize("payload", [{"nope": 1}, "not a capture", [], {"schema_version": "1"}])
def test_a_file_that_is_not_a_capture_is_refused(client, server, payload):
    assert compare(client, server, payload).json()["error"]["code"] == "snapshot_unreadable"


@pytest.mark.parametrize(
    "url", ["http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "http://127.0.0.1:22/"]
)
def test_private_and_non_web_addresses_are_refused(client, server, url):
    body = client.post(
        "/v1/price/compare", json={"url": url, "previous_snapshot": capture(client, server)}
    ).json()
    assert body["error"]["code"] == "url_not_allowed"


def test_an_unreachable_page_is_reported(client, server):
    body = compare(client, server, capture(client, server), path="/missing").json()
    assert body["error"]["code"] in ("url_unreachable", "snapshot_mismatch")


def test_a_malformed_request_is_refused(client):
    assert client.post("/v1/price/compare", json={}).json()["error"]["code"] in (
        "bad_request",
        "snapshot_unreadable",
    )
    response = client.post(
        "/v1/price/compare", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400


def test_errors_never_leak_internal_detail(client, server):
    text = client.post(
        "/v1/price/compare", json={"url": "file:///etc/passwd", "previous_snapshot": capture(client, server)}
    ).text
    for leak in ("Traceback", "/home/", "diffnexa_engine/", "lxml"):
        assert leak not in text


def test_the_endpoint_requires_credentials(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())
    assert secured.post("/v1/price/compare", json={}).status_code == 401
    wrong = secured.post("/v1/price/compare", json={}, headers={"Authorization": "Bearer wrong"})
    assert wrong.status_code == 403


def test_no_response_contains_the_secret(server, monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    monkeypatch.setenv("DIFFNEXA_WEB_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("DIFFNEXA_WEB_PORTS", str(server.port))
    secured = TestClient(build_app())
    headers = {"Authorization": f"Bearer {SECRET}"}
    baseline = secured.post("/v1/web/snapshot", json={"url": server.url("/price")}, headers=headers).json()[
        "snapshot"
    ]
    for response in (
        secured.post(
            "/v1/price/compare",
            json={"url": server.url("/price"), "previous_snapshot": baseline},
            headers=headers,
        ),
        secured.post("/v1/price/compare", json={}, headers=headers),
        secured.post("/v1/price/compare", json={}),
    ):
        assert SECRET not in response.text
