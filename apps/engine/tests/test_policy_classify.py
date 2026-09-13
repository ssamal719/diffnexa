"""Attaching clause topics to changes the comparison engine already found.

The rules this layer must never break, in order of importance:

1. It cannot hide a change. Classification is additional information, never a
   filter, and a change with no topic is reported exactly as before.
2. It cannot invent a topic. Where the wording does not clearly indicate one,
   nothing is claimed.
3. It cannot judge. "Touches Data Retention" says where a change sits; whether
   that change is good or bad for the reader is a legal opinion this product
   does not offer.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.contracts.changes import Side
from diffnexa_engine.policy.classify import (
    classify_change,
    classify_changes,
    describe_evidence,
    describe_signal_for_reader,
)
from diffnexa_engine.policy.signals import CLAUSE_SIGNALS_VERSION, ClauseTopic
from diffnexa_engine.web.compare import compare_snapshots
from diffnexa_engine.web.extract import extract_snapshot

POLICY = """<html><head><title>Privacy Policy</title></head><body><main>
<h1>Privacy Policy</h1>
<h2>Data retention</h2>
<p>We retain your personal information for 12 months after your account closes.</p>
<h2>Cancellation and termination</h2>
<p>You may cancel your subscription by giving 30 days notice.</p>
<h2>Fees and charges</h2>
<p>The subscription fee is 500 per year, charged annually in advance.</p>
<h2>Governing law</h2>
<p>This agreement is governed by the laws of England and Wales.</p>
<h2>Our team</h2>
<p>The company was founded in 2011 and employs 400 people.</p>
</main></body></html>"""


def snap(html: str, url: str = "https://example.com/privacy"):
    return extract_snapshot(html, url=url, fetched_at="2026-01-01T00:00:00+00:00")


def compare(before_html: str, after_html: str):
    before, after = snap(before_html), snap(after_html)
    result = compare_snapshots(before, after)
    return result, classify_changes(result.changes, after, before)


def topics_of(classification, change_id) -> set[ClauseTopic]:
    return set(classification.topics_for(change_id))


# ---------------------------------------------------------------- it never hides


def test_every_change_is_recorded_whether_or_not_it_has_a_topic():
    result, classification = compare(POLICY, POLICY.replace("employs 400", "employs 520"))
    assert result.changes, "the engine still finds the change"
    for change in result.changes:
        assert change.id in classification.by_change


def test_a_change_with_no_topic_is_still_a_change():
    """A staff count is not a clause, and the change is reported all the same."""
    result, classification = compare(POLICY, POLICY.replace("employs 400", "employs 520"))
    change = next(c for c in result.changes if c.new_value == "520")
    assert classification.topics_for(change.id) == ()
    assert change in result.changes


def test_classification_does_not_alter_the_comparison():
    before, after = snap(POLICY), snap(POLICY.replace("12 months", "24 months"))
    plain = compare_snapshots(before, after)
    classify_changes(plain.changes, after, before)
    again = compare_snapshots(before, after)
    assert plain.model_dump_json() == again.model_dump_json()


def test_the_count_of_changes_is_unaffected():
    edited = POLICY.replace("12 months", "24 months").replace("employs 400", "employs 520")
    result, classification = compare(POLICY, edited)
    assert len(classification.by_change) == len(result.changes)


# ---------------------------------------------------------------- it classifies


def test_a_retention_change_touches_data_retention():
    result, classification = compare(POLICY, POLICY.replace("12 months", "24 months"))
    change = next(c for c in result.changes if c.new_value == "24")
    assert ClauseTopic.DATA_RETENTION in topics_of(classification, change.id)


def test_a_notice_period_change_touches_cancellation():
    """The clue is the sentence around the number, not the number itself."""
    result, classification = compare(POLICY, POLICY.replace("30 days", "60 days"))
    change = next(c for c in result.changes if c.new_value == "60")
    assert ClauseTopic.CANCELLATION in topics_of(classification, change.id)


def test_a_fee_change_touches_fees():
    result, classification = compare(POLICY, POLICY.replace("fee is 500", "fee is 750"))
    change = next(c for c in result.changes if c.new_value == "750")
    assert ClauseTopic.FEES_AND_PRICING in topics_of(classification, change.id)


def test_reworded_text_is_classified_by_its_section():
    edited = POLICY.replace(
        "This agreement is governed by the laws of England and Wales.",
        "This agreement is governed by the laws of Ireland.",
    )
    result, classification = compare(POLICY, edited)
    change = next(c for c in result.changes if c.new_value and "Ireland" in str(c.new_value))
    assert ClauseTopic.GOVERNING_LAW in topics_of(classification, change.id)


def test_a_change_can_touch_more_than_one_topic():
    before = POLICY.replace(
        "You may cancel your subscription by giving 30 days notice.",
        "You may cancel your subscription by giving 30 days notice. No refunds are given.",
    )
    after = before.replace("No refunds are given.", "No refunds are given after 14 days.")
    result, classification = compare(before, after)
    change = result.changes[0]
    assert {ClauseTopic.CANCELLATION, ClauseTopic.REFUNDS} & topics_of(classification, change.id)


def test_an_unrelated_change_stays_unclassified():
    result, classification = compare(POLICY, POLICY.replace("founded in 2011", "founded in 2009"))
    for change in result.changes:
        assert classification.topics_for(change.id) == ()


# ---------------------------------------------------------------- topic presence


def test_a_topic_present_but_unchanged_is_distinguished_from_one_not_found():
    """Two very different statements the report must not confuse."""
    _result, classification = compare(POLICY, POLICY.replace("12 months", "24 months"))

    governing = classification.presence[ClauseTopic.GOVERNING_LAW]
    assert governing.found_in_document is True
    assert governing.changed == 0

    warranties = classification.presence[ClauseTopic.WARRANTIES]
    assert warranties.found_in_document is False
    assert warranties.changed == 0


def test_presence_records_where_a_topic_was_found():
    _result, classification = compare(POLICY, POLICY)
    retention = classification.presence[ClauseTopic.DATA_RETENTION]
    assert retention.found_in_document
    assert any("retention" in section.lower() for section in retention.sections)


def test_every_topic_appears_in_presence():
    _result, classification = compare(POLICY, POLICY)
    assert set(classification.presence) == set(ClauseTopic)


def test_changed_topics_are_listed_in_taxonomy_order():
    edited = POLICY.replace("12 months", "24 months").replace("30 days", "60 days")
    _result, classification = compare(POLICY, edited)
    changed = classification.changed_topics()
    assert set(changed) == {ClauseTopic.CANCELLATION, ClauseTopic.DATA_RETENTION}
    assert list(changed) == [topic for topic in ClauseTopic if topic in set(changed)]


def test_nothing_is_claimed_about_presence_without_a_snapshot():
    result, _ = compare(POLICY, POLICY.replace("12 months", "24 months"))
    classification = classify_changes(result.changes)
    untouched = classification.presence[ClauseTopic.GOVERNING_LAW]
    assert untouched.found_in_document is False, "no document was examined, so nothing is claimed"


# ---------------------------------------------------------------- evidence


def test_a_topic_keeps_the_phrase_that_produced_it():
    result, classification = compare(POLICY, POLICY.replace("12 months", "24 months"))
    change = next(c for c in result.changes if c.new_value == "24")
    signal = classification.signals_for_change(change.id)[0]
    assert signal.matched_text
    assert describe_evidence(signal).startswith(("the section heading", "the wording"))


def test_every_matched_phrase_comes_from_text_the_comparison_proved():
    """Classification reads existing evidence; it can never introduce any.

    The phrase behind a topic must be findable in the change's own values, its
    evidence excerpts, its heading path, or the text of a node the evidence
    cites. Anything else would mean the topic came from somewhere unverified.
    """
    before, after = snap(POLICY), snap(POLICY.replace("12 months", "24 months"))
    result = compare_snapshots(before, after)
    classification = classify_changes(result.changes, after, before)
    snapshots = {Side.OLD: before, Side.NEW: after}

    checked = 0
    for change in result.changes:
        available = [str(change.old_value), str(change.new_value), str(change.label)]
        for evidence in change.evidence:
            available.append(evidence.excerpt or "")
            available.append(" ".join(evidence.section_path))
            if evidence.node_id:
                node = snapshots[evidence.side].node_index().get(evidence.node_id)
                if node is not None:
                    available.append(node.text)
        haystack = " ".join(available).casefold()

        for signal in classification.signals_for_change(change.id):
            assert signal.matched_text.casefold() in haystack, (
                f"{signal.matched_text!r} was not in anything the comparison proved"
            )
            checked += 1

    assert checked > 0, "the test proved nothing if no signal was examined"


def test_a_change_citing_no_node_still_classifies_from_its_own_words():
    result, _ = compare(POLICY, POLICY.replace("laws of England and Wales", "laws of Ireland"))
    change = next(c for c in result.changes if "Ireland" in str(c.new_value))
    assert classify_change(change) != ()


# ---------------------------------------------------------------- wording


def test_the_reader_facing_wording_states_location_not_judgement():
    result, classification = compare(POLICY, POLICY.replace("12 months", "24 months"))
    change = next(c for c in result.changes if c.new_value == "24")
    signal = classification.signals_for_change(change.id)[0]
    wording = describe_signal_for_reader(signal)

    assert wording.startswith("Touches ")
    for judgement in ("risk", "unfavorable", "unfavourable", "weaken", "significant", "violation"):
        assert judgement not in wording.lower()


@pytest.mark.parametrize("topic", list(ClauseTopic))
def test_no_topic_produces_judgemental_wording(topic):
    from diffnexa_engine.policy.signals import TOPICS_BY_ID, ClauseSignal, SignalSource

    signal = ClauseSignal(topic, SignalSource.HEADING, "example")
    wording = describe_signal_for_reader(signal)
    assert wording == f"Touches {TOPICS_BY_ID[topic].label}"


# ---------------------------------------------------------------- determinism


def test_classification_is_deterministic():
    edited = POLICY.replace("12 months", "24 months").replace("30 days", "60 days")
    result, first = compare(POLICY, edited)
    second = classify_changes(result.changes, snap(edited), snap(POLICY))

    assert first.by_change.keys() == second.by_change.keys()
    for change_id in first.by_change:
        assert first.by_change[change_id] == second.by_change[change_id]
    assert first.presence == second.presence


def test_the_signal_version_is_recorded():
    _result, classification = compare(POLICY, POLICY)
    assert classification.signals_version == CLAUSE_SIGNALS_VERSION


def test_the_baseline_side_is_read_when_supplied():
    """A removed clause has evidence only on the baseline side."""
    removed = POLICY.replace(
        "<h2>Governing law</h2>\n<p>This agreement is governed by the laws of England and Wales.</p>\n",
        "",
    )
    result, classification = compare(POLICY, removed)
    old_side = [
        change for change in result.changes if any(evidence.side is Side.OLD for evidence in change.evidence)
    ]
    assert old_side, "removing a section produces baseline-side evidence"
    assert any(classification.topics_for(change.id) for change in old_side)
