"""Webpage comparison: the golden suite, determinism, and the accuracy rules."""

from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.contracts.changes import ChangeCategory, ChangeType, SnapshotRef
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.golden.web import discover_web_pairs, score_web_pair
from diffnexa_engine.web.compare import compare_snapshots, compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot

WEB_PAIRS = Path(__file__).resolve().parents[3] / "golden" / "web-pairs"
PAIRS = discover_web_pairs(WEB_PAIRS)

PAGE = """<html><head><title>Terms</title></head><body><main>
<h1>Terms</h1><h2>Pricing</h2>
<p>The standard plan costs 50,000 per year.</p>
<p>Delivery is scheduled for 30 June 2026.</p>
</main></body></html>"""


def snap(html: str, url: str = "https://example.com/t", **kwargs):
    return extract_snapshot(html, url=url, fetched_at="2026-01-01T00:00:00+00:00", **kwargs)


def test_the_web_golden_suite_exists():
    assert len(PAIRS) >= 22, "the golden suite must cover the agreed cases"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair.name for pair in PAIRS])
def test_web_golden_pair(pair):
    score, _before, _after = score_web_pair(pair)
    assert score.missed == [], f"missed changes: {score.missed}"
    assert score.false_positives == [] or len(score.false_positives) <= score.max_unexpected_changes
    assert score.noise_leakage == [], f"noise reported as content: {score.noise_leakage}"
    assert score.evidence_completeness == 1.0, f"untraceable evidence: {score.evidence_issues}"
    assert score.dropped_untraceable == 0
    assert score.passed


def test_every_golden_pair_has_traceable_evidence():
    for pair in PAIRS:
        score, before, after = score_web_pair(pair)
        assert score.evidence_issues == [], f"{pair.name}: {score.evidence_issues}"
        assert before.content_sha256 != "" and after.content_sha256 != ""


# ---------------------------------------------------------------- result model


def test_a_web_result_describes_snapshots_not_documents():
    result = compare_snapshots(snap(PAGE), snap(PAGE.replace("50,000", "75,000")))
    assert isinstance(result.old_document, SnapshotRef)
    assert isinstance(result.new_document, SnapshotRef)
    assert result.old_document.url == "https://example.com/t"
    assert result.old_document.node_count > 0
    assert not hasattr(result.old_document, "page_count")


def test_the_result_fingerprints_both_snapshots():
    before, after = snap(PAGE), snap(PAGE.replace("50,000", "75,000"))
    result = compare_snapshots(before, after)
    assert result.old_document.sha256 == before.content_sha256
    assert result.new_document.sha256 == after.content_sha256


# ---------------------------------------------------------------- accuracy rules


def test_an_unchanged_page_reports_nothing():
    assert compare_snapshots(snap(PAGE), snap(PAGE)).changes == ()


def test_every_change_carries_evidence():
    before, after = snap(PAGE), snap(PAGE.replace("50,000", "75,000"))
    result = compare_snapshots(before, after)
    assert result.changes
    for change in result.changes:
        assert change.evidence
        for item in change.evidence:
            assert item.scope in ("node", "document")
            assert item.snapshot_sha256
    assert verify_web_traceability(result.changes, before, after) == []


def test_values_reuse_the_existing_safeguards():
    """A year is not a percentage rise, and a percentage has no percentage."""
    year = compare_snapshots(
        snap(PAGE.replace("30 June 2026", "reviewed in 2026")),
        snap(PAGE.replace("30 June 2026", "reviewed in 2027")),
    )
    change = next(c for c in year.changes if c.category is ChangeCategory.NUMBER)
    assert change.delta == "+1"

    percent = compare_snapshots(
        snap(PAGE.replace("50,000 per year", "10% per year")),
        snap(PAGE.replace("50,000 per year", "12% per year")),
    )
    change = next(c for c in percent.changes if c.category is ChangeCategory.NUMBER)
    assert change.delta == "+2"


def test_no_importance_is_invented():
    result = compare_snapshots(snap(PAGE), snap(PAGE.replace("50,000", "75,000")))
    assert all(change.rule_importance is None for change in result.changes)
    assert result.annotations == ()


def test_extraction_warnings_stay_available():
    shell = '<html><body><div id="root"></div><script>window.__NEXT_DATA__={}</script></body></html>'
    outcome = compare_snapshots_verbose(snap(shell), snap(shell))
    assert outcome.diagnostics.needs_javascript
    assert any("browser" in note for note in outcome.diagnostics.notes)


def test_one_changed_cell_does_not_rewrite_the_table():
    table = """<html><body><main><h1>Plans</h1><table>
<thead><tr><th>Plan</th><th>Price</th><th>Users</th></tr></thead>
<tbody><tr><td>Standard</td><td>50,000</td><td>25</td></tr>
<tr><td>Premium</td><td>90,000</td><td>100</td></tr></tbody></table></main></body></html>"""
    result = compare_snapshots(snap(table), snap(table.replace("<td>90,000</td>", "<td>95,000</td>")))
    cells = [c for c in result.changes if c.subtype == "table_cell"]
    assert len(cells) == 1
    assert (cells[0].old_value, cells[0].new_value) == ("90,000", "95,000")
    assert cells[0].label == "Premium · Price"


def test_a_tracking_parameter_is_not_a_link_change():
    page = '<html><body><main><h1>H</h1><p>See <a href="{href}">the guide</a> here.</p></main></body></html>'
    before = snap(page.format(href="https://example.com/g?utm_source=email"))
    after = snap(page.format(href="https://example.com/g?fbclid=abc"))
    assert [c for c in compare_snapshots(before, after).changes if c.category is ChangeCategory.LINK] == []


def test_a_real_link_change_is_reported():
    page = '<html><body><main><h1>H</h1><p>See <a href="{href}">the guide</a> here.</p></main></body></html>'
    before = snap(page.format(href="https://example.com/guide"))
    after = snap(page.format(href="https://example.com/handbook"))
    links = [c for c in compare_snapshots(before, after).changes if c.category is ChangeCategory.LINK]
    assert len(links) == 1 and links[0].change_type is ChangeType.LINK_CHANGED


# ---------------------------------------------------------------- determinism


def test_the_same_snapshots_always_compare_identically():
    before, after = snap(PAGE), snap(PAGE.replace("50,000", "75,000"))
    first = compare_snapshots(before, after)
    second = compare_snapshots(before, after)
    assert first == second
    assert first.model_dump_json() == second.model_dump_json()


def test_every_golden_pair_compares_deterministically():
    for pair in PAIRS:
        before = extract_snapshot(pair.before.read_text(), url=pair.spec.url)
        after = extract_snapshot(pair.after.read_text(), url=pair.spec.url)
        first = compare_snapshots(before, after).model_dump_json()
        second = compare_snapshots(before, after).model_dump_json()
        assert first == second, f"{pair.name} compared differently on a second run"


def test_the_fetch_time_does_not_affect_the_comparison():
    morning = extract_snapshot(PAGE, url="https://e.com/", fetched_at="2026-01-01T09:00:00+00:00")
    evening = extract_snapshot(PAGE, url="https://e.com/", fetched_at="2026-09-09T21:00:00+00:00")
    changed = extract_snapshot(PAGE.replace("50,000", "75,000"), url="https://e.com/")
    assert (
        compare_snapshots(morning, changed).model_dump_json()
        == compare_snapshots(evening, changed).model_dump_json()
    )
