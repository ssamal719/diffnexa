import json

import pytest

from diffnexa_engine.golden.baseline import (
    PairMetrics,
    find_regressions,
    load_baseline,
    write_baseline,
)

GOOD = {"recall": 1.0, "false_positives": 0.0, "noise_leakage": 0.0, "evidence_completeness": 1.0}


def test_no_regression_when_equal():
    base = {"a": PairMetrics(True, dict(GOOD))}
    assert find_regressions(base, {"a": PairMetrics(True, dict(GOOD))}) == ([], [])


@pytest.mark.parametrize(
    "now, text",
    [
        (PairMetrics(True, {**GOOD, "recall": 0.5}), "recall fell"),
        (PairMetrics(True, {**GOOD, "false_positives": 2.0}), "false positives rose"),
        (PairMetrics(True, {**GOOD, "noise_leakage": 1.0}), "noise leakage rose"),
        (PairMetrics(True, {**GOOD, "evidence_completeness": 0.9}), "evidence completeness fell"),
        (PairMetrics(False, dict(GOOD)), "extraction checks"),
        (PairMetrics(True, None), "not scored now"),
    ],
)
def test_regressions_detected(now, text):
    regressions, _ = find_regressions({"a": PairMetrics(True, dict(GOOD))}, {"a": now})
    assert any(text in r for r in regressions)


def test_improvement_is_not_a_regression():
    base = {"a": PairMetrics(True, {**GOOD, "recall": 0.5, "false_positives": 3.0})}
    assert find_regressions(base, {"a": PairMetrics(True, dict(GOOD))})[0] == []


def test_removed_pair_is_a_regression_and_new_pair_is_reported():
    regressions, new = find_regressions({"a": PairMetrics(True, None)}, {"b": PairMetrics(True, None)})
    assert any("no longer in the suite" in r for r in regressions)
    assert new == ["b"]


def test_write_requires_reason_and_logs_it(tmp_path):
    path, log = tmp_path / "baseline.json", tmp_path / "CHANGES.md"
    with pytest.raises(ValueError):
        write_baseline(path, {"a": PairMetrics(True, None)}, "short", log)
    write_baseline(path, {"a": PairMetrics(True, None)}, "Added the first real pair.", log)
    assert json.loads(path.read_text())["pairs"]["a"] == {"extraction_passed": True, "comparison": None}
    assert "Added the first real pair." in log.read_text()
    assert load_baseline(path) == {"a": PairMetrics(True, None)}


def test_missing_baseline_is_empty(tmp_path):
    assert load_baseline(tmp_path / "nope.json") == {}
