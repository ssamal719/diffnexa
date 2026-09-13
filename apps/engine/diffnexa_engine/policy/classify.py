"""Attaching clause topics to changes the comparison engine already found.

This layer adds nothing to the comparison and takes nothing away from it. The
deterministic engine decides what changed; this decides, for each of those
changes, which part of an agreement it sits in. A change may touch one topic,
several, or none, and a change with no topic is reported exactly as it is today.

Three rules hold the layer honest:

* **It is never a filter.** Classification cannot hide a change. Anything the
  engine found is still in the result, whether or not a topic was recognised.
* **Unsure means unclassified.** Where the wording does not clearly indicate a
  topic, nothing is claimed. A guessed topic is worse than a blank, because it
  invites a reader to trust a classification that has no basis.
* **It says where, not what it means.** "Touches Data Retention" is a statement
  about location. Whether the change is good or bad for the reader is a legal
  judgement, and nothing here makes one.

The layer is kept beside the comparison result rather than inside it, so the
`Change` contract that PDF Compare and Website Change Detector both depend on is
untouched.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from diffnexa_engine.contracts.changes import Change, Side
from diffnexa_engine.policy.signals import (
    CLAUSE_SIGNALS_VERSION,
    ClauseSignal,
    ClauseTopic,
    SignalSource,
    signals_for,
)  # noqa: F401 - ClauseSignal is used in annotations below
from diffnexa_engine.web.snapshot import NodeRole, Snapshot


@dataclass(frozen=True)
class TopicPresence:
    """Whether a topic appears in the document at all, and where.

    This is what allows the report to distinguish two very different statements:
    "this agreement has a Data Retention section and none of it changed" from
    "no Data Retention wording was found in this page". Saying the first when
    only the second is true would be a claim the system has not earned.
    """

    topic: ClauseTopic
    found_in_document: bool
    sections: tuple[str, ...] = ()
    changed: int = 0


@dataclass
class PolicyClassification:
    """Clause topics for one comparison, recorded alongside its result."""

    signals_version: str = CLAUSE_SIGNALS_VERSION
    by_change: dict[str, tuple[ClauseSignal, ...]] = field(default_factory=dict)
    presence: dict[ClauseTopic, TopicPresence] = field(default_factory=dict)

    def topics_for(self, change_id: str) -> tuple[ClauseTopic, ...]:
        return tuple(signal.topic for signal in self.by_change.get(change_id, ()))

    def signals_for_change(self, change_id: str) -> tuple[ClauseSignal, ...]:
        return self.by_change.get(change_id, ())

    @property
    def classified_count(self) -> int:
        return sum(1 for signals in self.by_change.values() if signals)

    def changed_topics(self) -> tuple[ClauseTopic, ...]:
        """Topics with at least one change, in the taxonomy's own order."""
        return tuple(
            topic for topic in ClauseTopic if topic in self.presence and self.presence[topic].changed > 0
        )


def _heading_of(change: Change) -> str | None:
    """The document's own heading for where this change sits.

    Evidence carries the full heading path, which is more reliable than the
    change's label because it comes straight from the page's structure.
    """
    for evidence in change.evidence:
        if evidence.section_path:
            return " ".join(evidence.section_path)
    return change.label


def _texts_of(change: Change, snapshots: dict[Side, Snapshot] | None = None) -> list[str]:
    """Everything about this change that could indicate a topic.

    The changed values alone are usually too short to indicate anything: "30"
    becoming "60" belongs to no topic by itself, and for a value change the
    evidence excerpt is only the cited words. What identifies the clause is the
    sentence around it — "you may cancel your subscription by giving 30 days
    notice" — so where evidence names a node, the node's full text is read from
    the snapshot it came from.

    The pieces are kept separate rather than joined into one string. Joining them
    let a phrase match across the seam between two fragments — "refunds 14 our
    refund polic" was matched from a value, a label and an excerpt run together —
    and a phrase that exists nowhere in the document cannot be shown to a reader
    as the reason for a topic.

    This uses the evidence that already exists rather than adding any, so a
    classification can only ever be based on text the comparison already proved.
    """
    parts: list[str] = []
    for value in (change.old_value, change.new_value, change.label):
        if value:
            parts.append(value)

    for evidence in change.evidence:
        if evidence.excerpt:
            parts.append(evidence.excerpt)
        if snapshots and evidence.node_id:
            snapshot = snapshots.get(evidence.side)
            if snapshot is not None:
                node = snapshot.node_index().get(evidence.node_id)
                if node is not None:
                    parts.append(node.text)

    return parts


def classify_change(
    change: Change, snapshots: dict[Side, Snapshot] | None = None
) -> tuple[ClauseSignal, ...]:
    """The clause topics this change touches, or an empty tuple if none is clear.

    Each piece of text is examined on its own, and the first match for a topic
    wins. A heading match is preferred, because a heading is the document's own
    statement about what the section covers.
    """
    heading = _heading_of(change)
    found: dict[ClauseTopic, ClauseSignal] = {}

    if heading:
        for signal in signals_for("", heading=heading):
            found.setdefault(signal.topic, signal)

    for text in _texts_of(change, snapshots):
        for signal in signals_for(text):
            found.setdefault(signal.topic, signal)

    return tuple(topic_signal for topic in ClauseTopic if (topic_signal := found.get(topic)))


def _document_presence(snapshot: Snapshot) -> dict[ClauseTopic, TopicPresence]:
    """Which topics the page contains at all, and under which headings.

    Read from the current capture rather than the baseline, because the question
    a reader is asking is about the document in front of them now.
    """
    sections: dict[ClauseTopic, list[str]] = {}

    for node in snapshot.nodes:
        if node.role is NodeRole.LINK:
            continue  # a link's own words rarely describe the clause around it
        heading = " ".join(node.section_path) if node.section_path else None
        for signal in signals_for(node.text, heading=heading):
            where = node.section_path[-1] if node.section_path else None
            found = sections.setdefault(signal.topic, [])
            if where and where not in found:
                found.append(where)
            elif not where and not found:
                found.append("")

    return {
        topic: TopicPresence(
            topic=topic,
            found_in_document=topic in sections,
            sections=tuple(name for name in sections.get(topic, ()) if name),
        )
        for topic in ClauseTopic
    }


def classify_changes(
    changes: Sequence[Change] | Iterable[Change],
    current_snapshot: Snapshot | None = None,
    baseline_snapshot: Snapshot | None = None,
) -> PolicyClassification:
    """Attach clause topics to a comparison's changes.

    The changes themselves are not modified, reordered or removed. When the
    current capture is supplied, the result also records which topics appear in
    the document at all, so the report can tell "nothing changed here" apart from
    "this topic was not found".
    """
    classification = PolicyClassification()

    snapshots: dict[Side, Snapshot] = {}
    if baseline_snapshot is not None:
        snapshots[Side.OLD] = baseline_snapshot
    if current_snapshot is not None:
        snapshots[Side.NEW] = current_snapshot

    for change in changes:
        signals = classify_change(change, snapshots or None)
        # Every change is recorded, including those with no topic, so a caller
        # can see that a change was considered rather than overlooked.
        classification.by_change[change.id] = signals

    presence = (
        _document_presence(current_snapshot)
        if current_snapshot is not None
        else {topic: TopicPresence(topic=topic, found_in_document=False) for topic in ClauseTopic}
    )

    for signals in classification.by_change.values():
        for signal in signals:
            existing = presence[signal.topic]
            presence[signal.topic] = TopicPresence(
                topic=signal.topic,
                # A topic evidenced by a change is present, whether or not the
                # document scan happened to reach the same wording.
                found_in_document=True,
                sections=existing.sections,
                changed=existing.changed + 1,
            )

    classification.presence = presence
    return classification


def describe_signal_for_reader(signal: ClauseSignal) -> str:
    """Neutral wording for the interface: where the change sits, nothing more."""
    return f"Touches {signal.label}"


def describe_evidence(signal: ClauseSignal) -> str:
    """Why this topic was suggested, so a reader can judge it for themselves."""
    where = "the section heading" if signal.source is SignalSource.HEADING else "the wording"
    return f"{where} contains {signal.matched_text!r}"


__all__ = [
    "PolicyClassification",
    "TopicPresence",
    "classify_change",
    "classify_changes",
    "describe_evidence",
    "describe_signal_for_reader",
]
