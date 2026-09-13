"""The Policy and Terms Monitor's API shape.

There is exactly one new engine endpoint, and this builds its response. Capturing
a policy page is the same operation as capturing any page, so it reuses the
existing webpage endpoint rather than gaining a duplicate under a new name.

The response is the webpage comparison, unchanged, with a `policy` section added
beside it. The changes themselves keep every field they already had, and each
gains the topics it touches. Nothing is removed, reordered or hidden: a change
with no topic appears exactly as it does in Website Change Detector.

Three statuses are reported for every topic in the taxonomy, and the difference
between them matters:

* `changed` — at least one change touches this part of the agreement.
* `present` — this part exists in the page, and nothing in it changed.
* `not_found` — no wording for this part was recognised in the page.

Reporting `present` when only `not_found` is true would tell a reader their
liability clause is unchanged when in fact none was found. They are kept apart.
"""

from __future__ import annotations

from typing import Any

from diffnexa_engine.policy.classify import PolicyClassification, describe_signal_for_reader
from diffnexa_engine.policy.signals import TOPICS_BY_ID, ClauseTopic
from diffnexa_engine.web.api import serialize_web_comparison
from diffnexa_engine.web.compare import WebComparisonOutcome


def _topic_status(classification: PolicyClassification, topic: ClauseTopic) -> str:
    presence = classification.presence[topic]
    if presence.changed > 0:
        return "changed"
    return "present" if presence.found_in_document else "not_found"


def _signal_payload(classification: PolicyClassification, change_id: str) -> list[dict[str, Any]]:
    """The topics a change touches, each with the phrase that produced it.

    The matched phrase travels with the topic so a reader can see why it was
    suggested and disagree. A topic without it would be an assertion.
    """
    return [
        {
            "topic": signal.topic.value,
            "label": signal.label,
            "source": signal.source.value,
            "matchedText": signal.matched_text,
            "summary": describe_signal_for_reader(signal),
        }
        for signal in classification.signals_for_change(change_id)
    ]


def serialize_policy_comparison(
    outcome: WebComparisonOutcome,
    classification: PolicyClassification,
    processing_ms: int,
) -> dict[str, Any]:
    """The webpage comparison, with clause topics alongside it."""
    payload = serialize_web_comparison(outcome, processing_ms)

    for change in payload["changes"]:
        # Additive: every existing field is untouched.
        change["policyTopics"] = _signal_payload(classification, change["id"])

    topics = [
        {
            "id": topic.value,
            "label": TOPICS_BY_ID[topic].label,
            "blurb": TOPICS_BY_ID[topic].blurb,
            "status": _topic_status(classification, topic),
            "changeCount": classification.presence[topic].changed,
            "sections": list(classification.presence[topic].sections),
        }
        for topic in ClauseTopic
    ]

    payload["policy"] = {
        "signalsVersion": classification.signals_version,
        "topics": topics,
        "changedTopics": [topic.value for topic in classification.changed_topics()],
        "classifiedChanges": classification.classified_count,
        "unclassifiedChanges": len(payload["changes"]) - classification.classified_count,
    }
    return payload


__all__ = ["serialize_policy_comparison"]
