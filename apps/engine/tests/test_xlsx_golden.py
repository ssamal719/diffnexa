"""The Excel Compare golden suite.

Each pair is two real workbooks saved by a spreadsheet application and a
hand-written statement of what really changed, the group each change belongs to
and the sheet and cell a reader is taken to — or, for damaged, unsupported and
hostile files, the refusal that must be given.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from diffnexa_engine.golden.excel import discover_excel_pairs, score_excel_pair

EXCEL_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "excel-pairs"
PAIRS = discover_excel_pairs(EXCEL_PAIRS)


def test_the_corpus_covers_the_agreed_ground():
    names = {pair.name for pair in PAIRS}
    for required in (
        "no-change",
        "text-change",
        "number-change",
        "date-change",
        "formula-change",
        "added-cell",
        "removed-cell",
        "added-row",
        "removed-row",
        "added-column",
        "removed-column",
        "added-sheet",
        "removed-sheet",
        "sheet-rename",
        "multiple-changes",
        "multiple-sheets",
        "blank-rows-inserted",
        "formula-result",
        "dates",
        "currency",
        "percentages",
        "large-workbook",
        "malformed-workbook",
        "unsupported-xls",
        "unsupported-xlsm",
        "security-zip-bomb",
        "security-path-traversal",
        "security-external-entity",
    ):
        assert required in names, required
    assert len(PAIRS) >= 25


def test_every_group_is_exercised():
    covered = {expected.group for pair in PAIRS for expected in pair.spec.expected_changes}
    assert covered == {"values", "formulas", "structure", "links"}


def test_every_expected_change_names_its_place():
    for pair in PAIRS:
        for expected in pair.spec.expected_changes:
            assert expected.sheet, f"{pair.name}: {expected.describe()}"
            if expected.subtype not in ("sheet", "sheet_rename", "sheet_order"):
                assert expected.ref, f"{pair.name}: {expected.describe()} has no cell"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_excel_golden_pair(pair):
    score, _payload = score_excel_pair(pair)
    assert score.missed == [], score.missed
    assert score.false_positives == [], score.false_positives
    assert score.noise_leakage == [], score.noise_leakage
    assert score.wrong_groups == [], score.wrong_groups
    assert score.wrong_places == [], score.wrong_places
    assert score.partition_errors == [], score.partition_errors
    assert score.refusal_errors == [], score.refusal_errors
    assert score.evidence_issues == [], score.evidence_issues
    assert score.evidence_completeness == 1.0
    assert score.passed


@pytest.mark.parametrize("name", ["multiple-changes", "large-workbook", "added-row"])
def test_scoring_is_deterministic(name):
    pair = next(p for p in PAIRS if p.name == name)
    first = score_excel_pair(pair)[1]
    second = score_excel_pair(pair)[1]
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
