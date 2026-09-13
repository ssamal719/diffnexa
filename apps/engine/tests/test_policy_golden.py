"""The policy golden suite.

Each pair is two realistic policy pages plus a written statement of what changed
and which part of the agreement each change belongs to. A pair fails if an
expected change is missed, an unexpected one is reported, an expected topic is
absent, a forbidden topic is assigned, or a topic rests on text the comparison
did not prove.

The negative pairs matter most. A monitor that labels a news article's mention
of arbitration as an arbitration clause teaches its reader to distrust every
label it shows.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.golden.policy import (
    discover_policy_pairs,
    score_policy_pair,
)
from diffnexa_engine.policy.signals import ClauseTopic

POLICY_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "policy-pairs"
PAIRS = discover_policy_pairs(POLICY_PAIRS)


def test_the_corpus_exists_and_is_substantial():
    assert len(PAIRS) >= 25, "the policy corpus must cover the agreed ground"


def test_every_topic_is_covered_by_at_least_one_pair():
    """A topic no pair exercises is a claim with nothing behind it."""
    covered = {
        topic for pair in PAIRS for expected in pair.spec.expected_changes for topic in expected.topics
    }
    assert covered == set(ClauseTopic), f"not covered: {sorted(t.value for t in set(ClauseTopic) - covered)}"


def test_the_corpus_has_negative_cases():
    """Pairs that must produce no topics, or none at all."""
    negatives = [
        pair
        for pair in PAIRS
        if pair.spec.forbidden_topics
        or any(expected.expect_no_topic for expected in pair.spec.expected_changes)
    ]
    assert len(negatives) >= 6, "precision needs as much proof as recall"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_policy_golden_pair(pair):
    score, _before, _after, _classification = score_policy_pair(pair)

    assert score.missed == [], f"expected changes not found: {score.missed}"
    assert score.missing_topics == [], f"expected topics not assigned: {score.missing_topics}"
    assert score.topic_false_positives == [], f"topics wrongly assigned: {score.topic_false_positives}"
    assert score.noise_leakage == [], f"noise reported as content: {score.noise_leakage}"
    assert score.presence_errors == [], f"presence claims wrong: {score.presence_errors}"
    assert score.untraceable_topics == [], f"topics not traceable: {score.untraceable_topics}"
    assert score.evidence_completeness == 1.0, f"untraceable evidence: {score.evidence_issues}"
    assert score.dropped_untraceable == 0
    assert len(score.false_positives) <= score.max_unexpected_changes, score.false_positives
    assert score.passed


def test_every_reported_change_keeps_its_evidence():
    for pair in PAIRS:
        score, before, after, _classification = score_policy_pair(pair)
        assert score.evidence_issues == [], f"{pair.name}: {score.evidence_issues}"
        assert before.content_sha256 and after.content_sha256


def test_every_assigned_topic_rests_on_proven_text():
    """The strongest guarantee: no topic can come from text nobody can check."""
    for pair in PAIRS:
        score, _before, _after, _classification = score_policy_pair(pair)
        assert score.untraceable_topics == [], f"{pair.name}: {score.untraceable_topics}"


def test_classification_is_deterministic_across_the_corpus():
    for pair in PAIRS:
        first = score_policy_pair(pair)[3]
        second = score_policy_pair(pair)[3]
        assert first.by_change == second.by_change, f"{pair.name} classified differently"
        assert first.presence == second.presence


def test_comparison_output_is_byte_stable_across_the_corpus():
    from diffnexa_engine.web.compare import compare_snapshots
    from diffnexa_engine.web.extract import extract_snapshot

    for pair in PAIRS:
        before = extract_snapshot(pair.before.read_text(), url=pair.spec.url)
        after = extract_snapshot(pair.after.read_text(), url=pair.spec.url)
        first = compare_snapshots(before, after).model_dump_json()
        second = compare_snapshots(before, after).model_dump_json()
        assert first == second, f"{pair.name} compared differently on a second run"
