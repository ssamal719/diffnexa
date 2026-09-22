"""Competitor Monitor.

Recognises which part of a competitor's webpage a change belongs to — a price,
a plan, a feature, a button, the main message — so a reader can see at a glance
what kind of thing moved.

It reports where a change sits, never what it means. Whether a competitor's
change is significant, or what they intend by it, is not something a comparison
of two captures of a page can know.
"""

from diffnexa_engine.competitor.classify import (
    ChangeSignal,
    CompetitorClassification,
    classify_change,
    classify_changes,
    describe_reason,
    describe_signal_for_reader,
)
from diffnexa_engine.competitor.signals import (
    COMPETITOR_SIGNALS_VERSION,
    CompetitorSignal,
    SignalBasis,
    signal_blurb,
    signal_label,
)

__all__ = [
    "COMPETITOR_SIGNALS_VERSION",
    "ChangeSignal",
    "CompetitorClassification",
    "CompetitorSignal",
    "SignalBasis",
    "classify_change",
    "classify_changes",
    "describe_reason",
    "describe_signal_for_reader",
    "signal_blurb",
    "signal_label",
]
