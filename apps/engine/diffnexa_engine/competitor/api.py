"""The Competitor Monitor's API shape.

There is exactly one new engine endpoint, and this builds its response.
Capturing a competitor's page is the same operation as capturing any page, so it
reuses the existing webpage endpoint rather than gaining a duplicate.

The response is the webpage comparison, unchanged, with a `competitor` section
added beside it. Every change keeps every field it already had and gains one
`competitorSignal`. Nothing is removed, reordered or hidden, and because each
change has exactly one signal, the per-signal counts always add up to the number
of changes found.

Nothing about the competitor — its name, or what kind of page this is — reaches
the engine. Those are the reader's own labels, kept in their baseline file, and
they cannot influence how the page is read.
"""

from __future__ import annotations

from typing import Any

from diffnexa_engine.competitor.classify import (
    CompetitorClassification,
    describe_reason,
    describe_signal_for_reader,
)
from diffnexa_engine.competitor.signals import SIGNAL_RULES
from diffnexa_engine.web.api import serialize_web_comparison
from diffnexa_engine.web.compare import WebComparisonOutcome


def _signal_payload(classification: CompetitorClassification, change_id: str) -> dict[str, Any] | None:
    signal = classification.signal_for(change_id)
    if signal is None:
        return None
    return {
        "signal": signal.signal.value,
        "label": signal.label,
        "basis": signal.basis.value,
        "matchedText": signal.matched_text,
        "reason": describe_reason(signal),
        "summary": describe_signal_for_reader(signal),
    }


def serialize_competitor_comparison(
    outcome: WebComparisonOutcome,
    classification: CompetitorClassification,
    processing_ms: int,
) -> dict[str, Any]:
    """The webpage comparison, with one competitor signal on every change."""
    payload = serialize_web_comparison(outcome, processing_ms)

    for change in payload["changes"]:
        # Additive: every existing field is untouched.
        change["competitorSignal"] = _signal_payload(classification, change["id"])

    counts = classification.counts()
    payload["competitor"] = {
        "signalsVersion": classification.signals_version,
        "signals": [
            {
                "id": rules.signal.value,
                "label": rules.label,
                "blurb": rules.blurb,
                "changeCount": counts[rules.signal],
                "changeIds": classification.change_ids_for(rules.signal),
            }
            for rules in SIGNAL_RULES
        ],
        "changedSignals": [signal.value for signal in classification.changed_signals()],
    }
    return payload


__all__ = ["serialize_competitor_comparison"]
