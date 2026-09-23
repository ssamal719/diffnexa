"""The DOCX Compare golden suite.

Each pair is two real Word documents and a hand-written statement of what really
changed, the group each change belongs to and where its evidence must point. A
pair fails if an expected change is missed, anything else is reported, a change
lands in the wrong group, its evidence points somewhere else, or the groups do
not add up to the changes found.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from diffnexa_engine.golden.docx import discover_docx_pairs, score_docx_pair

DOCX_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "docx-pairs"
PAIRS = discover_docx_pairs(DOCX_PAIRS)


def test_the_corpus_covers_the_agreed_ground():
    names = {pair.name for pair in PAIRS}
    for required in (
        "no-change",
        "formatting-only",
        "paragraph-added",
        "paragraph-removed",
        "paragraph-reworded",
        "heading-added",
        "heading-renamed",
        "heading-level-changed",
        "list-item-added",
        "list-item-removed",
        "list-item-edited",
        "numbered-list-insert",
        "table-added",
        "table-removed",
        "table-row-added",
        "table-row-removed",
        "table-cell-number",
        "table-cell-date",
        "table-column-added",
        "numeric-change",
        "date-change",
        "several-values-one-paragraph",
        "link-changed",
        "title-changed",
        "mixed-revision",
    ):
        assert required in names, required
    assert len(PAIRS) >= 25


def test_every_group_is_exercised_by_at_least_one_pair():
    covered = {expected.group for pair in PAIRS for expected in pair.spec.expected_changes}
    assert covered == {"text", "headings", "lists", "tables", "numbers", "dates", "structure", "other"}


def test_every_expected_change_states_where_its_evidence_is():
    for pair in PAIRS:
        for expected in pair.spec.expected_changes:
            assert expected.locations, f"{pair.name}: {expected.describe()} has no location"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_docx_golden_pair(pair):
    score, _payload = score_docx_pair(pair)
    assert score.missed == [], score.missed
    assert score.false_positives == [], score.false_positives
    assert score.noise_leakage == [], score.noise_leakage
    assert score.wrong_groups == [], score.wrong_groups
    assert score.wrong_locations == [], score.wrong_locations
    assert score.partition_errors == [], score.partition_errors
    assert score.evidence_issues == [], score.evidence_issues
    assert score.evidence_completeness == 1.0
    assert score.passed


@pytest.mark.parametrize("pair", PAIRS[:5], ids=[pair.name for pair in PAIRS[:5]])
def test_scoring_is_deterministic(pair):
    first = score_docx_pair(pair)[1]
    second = score_docx_pair(pair)[1]
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
