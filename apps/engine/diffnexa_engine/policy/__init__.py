"""Policy and Terms Monitor.

Recognises which part of an agreement a change belongs to — fees, cancellation,
liability, data handling — so a reader can see whether anything they care about
moved.

It reports where a change sits, never what it means for the reader. That is a
legal judgement, and this product has no basis for one.
"""

from diffnexa_engine.policy.classify import (
    PolicyClassification,
    TopicPresence,
    classify_change,
    classify_changes,
    describe_evidence,
    describe_signal_for_reader,
)
from diffnexa_engine.policy.signals import (
    CLAUSE_SIGNALS_VERSION,
    ClauseSignal,
    ClauseTopic,
    SignalSource,
    describe_topic,
    signals_for,
    topic_blurb,
    topics_for,
)

__all__ = [
    "CLAUSE_SIGNALS_VERSION",
    "PolicyClassification",
    "TopicPresence",
    "classify_change",
    "classify_changes",
    "describe_evidence",
    "describe_signal_for_reader",
    "ClauseSignal",
    "ClauseTopic",
    "SignalSource",
    "describe_topic",
    "signals_for",
    "topic_blurb",
    "topics_for",
]
