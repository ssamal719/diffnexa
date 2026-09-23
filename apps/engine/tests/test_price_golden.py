"""The Price Monitor golden suite.

Each pair is two versions of a realistic pricing or product page, plus a written
statement of what really changed and the one category each change must receive.
A pair fails if an expected change is missed, an unexpected one is reported, a
change gets the wrong category, a forbidden category appears, a category quotes
text the comparison did not prove, or the groups do not add up to the changes.

The negative pairs are the point: "10 users", "a 14-day trial", "99.9% uptime",
a customer count and a warranty length must never be labelled as prices.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from diffnexa_engine.golden.price import discover_price_pairs, score_price_pair
from diffnexa_engine.price.api import serialize_price_comparison
from diffnexa_engine.price.classify import classify_changes
from diffnexa_engine.price.signals import PriceCategory
from diffnexa_engine.web.compare import compare_snapshots_verbose

PRICE_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "price-pairs"
PAIRS = discover_price_pairs(PRICE_PAIRS)

PRICE_LIKE = {
    PriceCategory.PRICE,
    PriceCategory.DISCOUNT,
    PriceCategory.ORIGINAL,
    PriceCategory.CURRENCY,
    PriceCategory.BILLING,
}


def test_the_corpus_covers_the_agreed_ground():
    names = {pair.name for pair in PAIRS}
    for required in (
        "no-change",
        "saas-price-changed",
        "product-price-pound",
        "product-price-euro",
        "rupee-offer-price",
        "rupee-inr-code",
        "currency-note-changed",
        "currency-symbol-changed",
        "starter-period-changed",
        "sale-price-changed",
        "original-price-changed",
        "plan-renamed",
        "product-out-of-stock",
        "availability-contact-sales",
        "pricing-table-cell",
        "users-limit-not-a-price",
        "trial-length-not-a-price",
        "uptime-not-a-price",
        "ordinary-number-not-a-price",
        "ordinary-changes-visible",
        "cloudflare-email-token",
        "mixed-release",
    ):
        assert required in names, required
    assert len(PAIRS) >= 25


def test_every_category_is_exercised_by_at_least_one_pair():
    covered = {expected.price_category for pair in PAIRS for expected in pair.spec.expected_changes}
    assert covered == set(PriceCategory), sorted(c.value for c in set(PriceCategory) - covered)


def test_negative_pairs_forbid_every_price_category():
    negatives = [pair for pair in PAIRS if PRICE_LIKE <= set(pair.spec.forbidden_categories)]
    assert len(negatives) >= 5, "false prices need as much proof as real ones"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_price_golden_pair(pair):
    score, _before, _after, _classification = score_price_pair(pair)
    assert score.missed == [], f"expected changes not found: {score.missed}"
    assert score.wrong_categories == [], f"wrong categories: {score.wrong_categories}"
    assert score.forbidden_categories == [], f"forbidden categories: {score.forbidden_categories}"
    assert score.untraceable_categories == [], f"not traceable: {score.untraceable_categories}"
    assert score.partition_errors == [], f"groups do not add up: {score.partition_errors}"
    assert score.noise_leakage == [], f"noise reported as content: {score.noise_leakage}"
    assert score.evidence_completeness == 1.0, f"untraceable evidence: {score.evidence_issues}"
    assert score.dropped_untraceable == 0
    assert len(score.false_positives) <= score.max_unexpected_changes, score.false_positives
    assert score.passed


def _response(pair) -> str:
    _score, before, after, _classification = score_price_pair(pair)
    outcome = compare_snapshots_verbose(before, after)
    classification = classify_changes(outcome.result.changes, after, before)
    return json.dumps(serialize_price_comparison(outcome, classification, 0), sort_keys=True)


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_the_response_is_byte_stable(pair):
    first = _response(pair)
    assert all(_response(pair) == first for _ in range(2))
