"""The built-in examples behind "Try example" in the web monitoring tools.

An example must be a genuine comparison: the same extraction and comparison as
a real check, on two pages whose changes are written down in a golden pair.
These tests hold the example pages to their golden pairs, run each example
through its tool's endpoint, and make sure an example never fetches anything.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.examples import EXAMPLE_TOOLS, example_comparison, example_snapshots
from diffnexa_engine.examples.pages import PAGES
from diffnexa_engine.golden.competitor import discover_competitor_pairs, score_competitor_pair
from diffnexa_engine.golden.policy import discover_policy_pairs, score_policy_pair
from diffnexa_engine.golden.price import discover_price_pairs, score_price_pair
from diffnexa_engine.golden.web import discover_web_pairs, score_web_pair
from diffnexa_engine.web import api as web_api

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

GOLDEN = Path(__file__).resolve().parents[3] / "golden"
SECRET = "examples-test-secret"

DISCOVER = {
    "web": (discover_web_pairs, score_web_pair),
    "policy": (discover_policy_pairs, score_policy_pair),
    "competitor": (discover_competitor_pairs, score_competitor_pair),
    "price": (discover_price_pairs, score_price_pair),
}


@pytest.mark.parametrize("tool", EXAMPLE_TOOLS)
def test_each_example_page_is_its_golden_pair_byte_for_byte(tool):
    page = PAGES[tool]
    pair = GOLDEN / page["pair"]
    assert page["before"] == (pair / "before.html").read_text(encoding="utf-8")
    assert page["after"] == (pair / "after.html").read_text(encoding="utf-8")


@pytest.mark.parametrize("tool", EXAMPLE_TOOLS)
def test_each_example_pair_passes_the_golden_suite(tool):
    discover, score = DISCOVER[tool]
    folder = GOLDEN / PAGES[tool]["pair"]
    [pair] = [pair for pair in discover(folder.parent) if pair.name == folder.name]
    assert score(pair)[0].passed


@pytest.mark.parametrize("tool", EXAMPLE_TOOLS)
def test_an_example_is_a_real_comparison_with_changes(tool):
    before, outcome = example_comparison(tool)
    assert before.source.url == PAGES[tool]["url"]
    assert outcome.result.changes, "an example with nothing to show would explain nothing"
    assert outcome.diagnostics.dropped_untraceable == 0
    # The same two pages every time.
    again = example_snapshots(tool)
    assert again[0].model_dump() == before.model_dump()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)

    def no_network(*_args, **_kwargs):  # an example must never fetch
        raise AssertionError("an example fetched a page")

    monkeypatch.setattr(web_api, "fetch", no_network)
    return TestClient(build_app())


@pytest.mark.parametrize(
    ("tool", "extra"),
    [
        ("web", None),
        ("policy", "policyTopics"),
        ("competitor", "competitorSignal"),
        ("price", "priceCategory"),
    ],
)
def test_each_endpoint_serves_its_example_without_fetching(client, tool, extra):
    response = client.post(
        f"/v1/{tool}/compare",
        json={"example": True},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    _before, outcome = example_comparison(tool)
    assert body["counts"]["total"] == len(outcome.result.changes)
    if extra:
        assert any(extra in change for change in body["changes"]), f"{tool} changes carry no {extra}"


def test_an_example_ignores_any_address_or_baseline_sent_with_it(client):
    response = client.post(
        "/v1/web/compare",
        json={"example": True, "url": "http://127.0.0.1/secret", "previous_snapshot": {"not": "a snapshot"}},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert response.status_code == 200
    assert response.json()["documents"]["revised"]["url"] == PAGES["web"]["url"]


@pytest.mark.parametrize("value", ["true", 1, "yes", None])
def test_only_a_literal_true_asks_for_the_example(client, value):
    response = client.post(
        "/v1/web/compare",
        json={"example": value, "url": "https://example.com/"},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    # Without the example, the request is an ordinary check with no baseline.
    assert response.status_code == 400


# ---------------------------------------------------------------- file examples served by the site

EXAMPLES = Path(__file__).resolve().parents[2] / "web" / "public" / "examples"


def test_the_pdf_example_is_the_synthetic_multiple_changes_pair(tmp_path):
    from diffnexa_engine.golden.synthetic import generate_synthetic_pairs

    generate_synthetic_pairs(tmp_path)
    pair = tmp_path / "multiple-changes"
    assert (EXAMPLES / "recruitment-notice-original.pdf").read_bytes() == (pair / "old.pdf").read_bytes()
    assert (EXAMPLES / "recruitment-notice-revised.pdf").read_bytes() == (pair / "new.pdf").read_bytes()


def test_the_excel_example_is_the_multiple_changes_golden_pair():
    pair = GOLDEN / "excel-pairs" / "multiple-changes"
    assert (EXAMPLES / "company-workbook-original.xlsx").read_bytes() == (pair / "before.xlsx").read_bytes()
    assert (EXAMPLES / "company-workbook-revised.xlsx").read_bytes() == (pair / "after.xlsx").read_bytes()
