"""The Competitor Monitor golden suite.

Each pair is two versions of a realistic competitor page, plus a written
statement of what really changed and the one signal each change must receive.
A pair fails if an expected change is missed, an unexpected one is reported, a
change gets the wrong signal, a forbidden signal appears, a signal quotes text
the comparison did not prove, or the signal groups do not add up to the changes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from diffnexa_engine.competitor.api import serialize_competitor_comparison
from diffnexa_engine.competitor.classify import classify_changes
from diffnexa_engine.competitor.signals import CompetitorSignal
from diffnexa_engine.golden.competitor import discover_competitor_pairs, score_competitor_pair
from diffnexa_engine.web.compare import compare_snapshots_verbose

COMPETITOR_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "competitor-pairs"
PAIRS = discover_competitor_pairs(COMPETITOR_PAIRS)

REQUIRED = {
    "price-changed",
    "plan-added",
    "feature-added",
    "cta-wording-changed",
    "main-heading-changed",
    "metadata-changed",
    "ordinary-content-changed",
    "ordinary-link-changed",
    "no-change",
    "mixed-release",
}


def test_the_corpus_covers_the_agreed_ground():
    names = {pair.name for pair in PAIRS}
    assert REQUIRED <= names, f"missing: {sorted(REQUIRED - names)}"
    assert len(PAIRS) >= 20


def test_every_signal_is_exercised_by_at_least_one_pair():
    """A signal no pair exercises is a claim with nothing behind it."""
    covered = {expected.signal for pair in PAIRS for expected in pair.spec.expected_changes}
    assert covered == set(CompetitorSignal), sorted(s.value for s in set(CompetitorSignal) - covered)


def test_the_corpus_has_negative_cases():
    no_change = [pair for pair in PAIRS if not pair.spec.expected_changes]
    forbidding = [pair for pair in PAIRS if pair.spec.forbidden_signals]
    assert len(no_change) >= 2, "pages where nothing a reader sees changed"
    assert len(forbidding) >= 10, "precision needs as much proof as recall"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_competitor_golden_pair(pair):
    score, _before, _after, _classification = score_competitor_pair(pair)

    assert score.missed == [], f"expected changes not found: {score.missed}"
    assert score.wrong_signals == [], f"wrong signals: {score.wrong_signals}"
    assert score.forbidden_signals == [], f"forbidden signals: {score.forbidden_signals}"
    assert score.untraceable_signals == [], f"signals not traceable: {score.untraceable_signals}"
    assert score.partition_errors == [], f"groups do not add up: {score.partition_errors}"
    assert score.noise_leakage == [], f"noise reported as content: {score.noise_leakage}"
    assert score.evidence_completeness == 1.0, f"untraceable evidence: {score.evidence_issues}"
    assert score.dropped_untraceable == 0
    assert len(score.false_positives) <= score.max_unexpected_changes, score.false_positives
    assert score.passed


def _response(pair) -> str:
    _score, before, after, _classification = score_competitor_pair(pair)
    outcome = compare_snapshots_verbose(before, after)
    classification = classify_changes(outcome.result.changes, after, before)
    return json.dumps(serialize_competitor_comparison(outcome, classification, 0), sort_keys=True)


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_the_response_is_byte_stable(pair):
    """The same two captures always produce exactly the same response."""
    first = _response(pair)
    assert all(_response(pair) == first for _ in range(2))
