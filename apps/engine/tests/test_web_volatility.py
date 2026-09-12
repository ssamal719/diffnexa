"""Volatility rules: what they catch, and what they must never catch.

The second half matters more. Marking a ticking counter as noise is a
convenience; marking a contract date as noise would hide the thing the user came
for. Every rule here therefore has a matching test proving it leaves legitimate
content alone.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind, Evidence, Side
from diffnexa_engine.web.compare import compare_snapshots
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.volatility import (
    REASON_CONSENT,
    REASON_COPYRIGHT,
    REASON_COUNTER,
    REASON_FRESHNESS,
    REASON_OPAQUE_LINK,
    REASON_RELATIVE_TIME,
    mark_volatile,
    volatility_reason,
)

PAGE = """<html><head><title>T</title></head><body><main>
<h1>Terms</h1>
<p>{volatile}</p>
<p>The standard plan costs 50,000 per year.</p>
<p>Delivery is scheduled for 30 June 2026.</p>
</main></body></html>"""


def snap(html: str):
    return extract_snapshot(html, url="https://example.com/t", fetched_at="2026-01-01T00:00:00+00:00")


def compare(before_volatile: str, after_volatile: str, after_extra=lambda html: html):
    before = snap(PAGE.format(volatile=before_volatile))
    after = snap(after_extra(PAGE.format(volatile=after_volatile)))
    return compare_snapshots(before, after)


def meaningful(result):
    return [change for change in result.changes if change.noise_reason is None]


def noise(result):
    return [change for change in result.changes if change.noise_reason is not None]


def fake(old: str, new: str, category=ChangeCategory.TEXT, kind=ChangeKind.MODIFIED) -> Change:
    evidence = tuple(
        Evidence(
            side=side,
            scope="node",
            snapshot_sha256="a" * 64,
            node_id="n1",
            token_ids=("n1-t0",),
        )
        for side in ((Side.OLD, Side.NEW) if kind is ChangeKind.MODIFIED else (Side.NEW,))
    )
    return Change(
        id="c0",
        seq=0,
        kind=kind,
        category=category,
        old_value=old if kind is not ChangeKind.ADDED else None,
        new_value=new if kind is not ChangeKind.REMOVED else None,
        evidence=evidence,
    )


# ---------------------------------------------------------------- caught


@pytest.mark.parametrize(
    "before, after, reason",
    [
        ("Updated 4 minutes ago", "Updated 3 hours ago", REASON_RELATIVE_TIME),
        ("Published just now", "Published 2 days ago", REASON_RELATIVE_TIME),
        ("Last updated: 12 March 2026", "Last updated: 19 March 2026", REASON_FRESHNESS),
        ("Last checked 09:14", "Last checked 16:42", REASON_FRESHNESS),
        ("Copyright 2025 Example Ltd", "Copyright 2026 Example Ltd", REASON_COPYRIGHT),
        ("1,204 views", "1,517 views", REASON_COUNTER),
        ("42 comments", "57 comments", REASON_COUNTER),
    ],
)
def test_volatile_text_is_marked_not_reported(before, after, reason):
    result = compare(before, after)
    assert meaningful(result) == [], "volatility must not appear as a meaningful change"
    assert noise(result), "volatility must still be visible on request"
    assert all(change.noise_reason == reason for change in noise(result))


def test_a_consent_remnant_is_marked():
    result = compare("The service is provided as described.", "We use cookies to improve your experience.")
    for change in result.changes:
        if change.new_value and "cookies" in change.new_value:
            assert change.noise_reason == REASON_CONSENT


def test_a_cache_parameter_is_not_a_destination_change():
    change = fake(
        "https://example.com/guide?cb=1111&topic=pricing",
        "https://example.com/guide?cb=9999&topic=pricing",
        category=ChangeCategory.LINK,
    )
    assert volatility_reason(change, (change.old_value, change.new_value)) == REASON_OPAQUE_LINK


# ---------------------------------------------------------------- not caught


def test_a_real_change_beside_volatile_text_is_still_reported():
    result = compare(
        "Updated 4 minutes ago",
        "Updated 3 hours ago",
        lambda html: html.replace("costs 50,000", "costs 75,000"),
    )
    real = meaningful(result)
    assert len(real) == 1
    assert (real[0].old_value, real[0].new_value) == ("50,000", "75,000")
    assert noise(result), "the timestamp is still recorded, just not as content"


def test_a_delivery_date_is_not_a_freshness_line():
    result = compare(
        "Last updated: 12 March 2026",
        "Last updated: 12 March 2026",
        lambda html: html.replace("30 June 2026", "15 July 2026"),
    )
    real = meaningful(result)
    assert [change.category for change in real] == [ChangeCategory.DATE]
    assert real[0].delta == "15 days later"


def test_a_year_inside_a_sentence_is_not_a_copyright_line():
    result = compare("The agreement runs until the end of 2027.", "The agreement runs until the end of 2029.")
    assert len(meaningful(result)) == 1


def test_something_that_happened_years_ago_is_not_a_timestamp():
    result = compare(
        "The standard was introduced 10 years ago and revised since.",
        "The standard was introduced 10 years ago and revised twice.",
    )
    assert meaningful(result), "only the wording changed, and that is content"


def test_a_cookie_policy_paragraph_is_not_a_consent_banner():
    long_policy = (
        "This policy explains how we use cookies on this site, including the advertising "
        "cookies set by our partners, and how you can manage your cookie preferences."
    )
    result = compare(long_policy, long_policy.replace("manage your cookie preferences", "withdraw consent"))
    assert meaningful(result), "an edit to a cookie policy is a content change"


def test_a_counter_whose_sentence_also_changed_is_reported():
    """Only the moving part may move; anything else means a real edit."""
    result = compare("1,204 views this week", "1,517 downloads this week")
    assert meaningful(result)


def test_a_freshness_line_replaced_by_a_statement_is_reported():
    result = compare("Last updated: 12 March 2026", "This page is no longer maintained.")
    assert meaningful(result)


def test_a_real_link_change_is_not_opaque():
    change = fake("https://example.com/guide", "https://example.com/handbook", category=ChangeCategory.LINK)
    assert volatility_reason(change, (change.old_value, change.new_value)) is None


# ---------------------------------------------------------------- behaviour


def test_nothing_is_deleted_only_explained():
    before = compare("1,204 views", "1,517 views")
    assert before.changes, "the change still exists"
    for change in before.changes:
        assert change.evidence, "evidence is untouched"
        assert change.old_value and change.new_value, "values are untouched"


def test_an_existing_reason_is_never_overwritten():
    change = fake("1,204 views", "1,517 views").model_copy(update={"noise_reason": "Set earlier"})
    assert volatility_reason(change, ("1,204 views", "1,517 views")) is None
    assert mark_volatile((change,))[0].noise_reason == "Set earlier"


def test_without_context_no_rule_fires():
    """Failing safe: a word-level change alone never looks volatile."""
    assert volatility_reason(fake("4", "2")) is None


def test_marking_is_deterministic():
    first = compare("Updated 4 minutes ago", "Updated 3 hours ago")
    second = compare("Updated 4 minutes ago", "Updated 3 hours ago")
    assert first.model_dump_json() == second.model_dump_json()
    assert [c.noise_reason for c in first.changes] == [c.noise_reason for c in second.changes]
