"""End-to-end: the synthetic suite runs, reports honestly, and the ratchet works."""

import json

from diffnexa_engine.golden.baseline import find_regressions
from diffnexa_engine.golden.loader import discover_pairs
from diffnexa_engine.golden.runner import run_suite

from .helpers.oracle import oracle_result

EXPECTED_PAIRS = {
    "identical-notice",
    "reflowed-paragraph",
    "vacancy-number-change",
    "deadline-date-change",
    "indian-number-format",
    "inserted-page",
    "moved-paragraph",
    "eligibility-wording-change",
    "scanned-page",
    "rotated-page",
}


def test_all_synthetic_pairs_present(synthetic_dir):
    assert {p.name for p in discover_pairs(synthetic_dir)} == EXPECTED_PAIRS


def test_extraction_checks_pass_without_comparator(synthetic_dir, tmp_path):
    suite = run_suite(discover_pairs(synthetic_dir), comparator=None, report_dir=tmp_path)
    failures = {p.name: p.extraction_failures for p in suite.pairs if not p.extraction_passed}
    assert failures == {}
    # Without a comparison engine, nothing may be reported as "passed" for comparison.
    assert all(p.comparison_status == "not_available" and p.score is None for p in suite.pairs)
    assert all(p.metrics().comparison is None for p in suite.pairs)
    summary = (tmp_path / "summary.md").read_text()
    assert "Not run yet" in summary and "PASS" in summary
    results = json.loads((tmp_path / "results.json").read_text())
    assert len(results["pairs"]) == len(EXPECTED_PAIRS)
    assert (tmp_path / "index.html").exists()
    assert (tmp_path / "pairs" / "rotated-page" / "old.extraction.html").exists()


def test_extraction_failure_is_reported(synthetic_dir, tmp_path):
    pair = next(p for p in discover_pairs(synthetic_dir) if p.name == "vacancy-number-change")
    wrong = pair.spec.model_copy(deep=True)
    wrong.extraction.new.must_contain[0].text = "Total Vacancies: 999"
    broken = type(pair)(pair.name, pair.directory, wrong, pair.old_pdf, pair.new_pdf)
    suite = run_suite([broken])
    assert not suite.pairs[0].extraction_passed
    assert "does not contain" in suite.pairs[0].extraction_failures[0]


def _spec_lookup(pairs):
    """Map (old sha256, new sha256) -> spec, so a test comparator knows which pair it is on."""
    import hashlib

    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    return {(sha(p.old_pdf), sha(p.new_pdf)): p.spec for p in pairs}


def test_comparator_scores_and_ratchet_catches_regression(synthetic_dir):
    pairs = discover_pairs(synthetic_dir)
    lookup = _spec_lookup(pairs)

    def perfect(old, new):
        return oracle_result(lookup[(old.source.sha256, new.source.sha256)], old, new)

    good = run_suite(pairs, comparator=perfect)
    assert good.comparison_failures == 0
    assert all(p.comparison_status == "scored" for p in good.pairs)
    baseline = good.metrics()

    def forgetful(old, new):
        spec = lookup[(old.source.sha256, new.source.sha256)]
        return oracle_result(spec.model_copy(update={"expected_changes": []}), old, new)

    worse = run_suite(pairs, comparator=forgetful)
    assert worse.comparison_failures > 0
    regressions, _ = find_regressions(baseline, worse.metrics())
    assert any("recall fell" in r for r in regressions)


def test_crashing_comparator_is_a_failure(synthetic_dir):
    def broken(old, new):
        raise RuntimeError("engine crashed")

    suite = run_suite(discover_pairs(synthetic_dir)[:1], comparator=broken)
    assert suite.pairs[0].comparison_status == "error" and suite.comparison_failures == 1
