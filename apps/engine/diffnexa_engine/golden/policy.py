"""The golden suite for the Policy and Terms Monitor.

Same idea as the PDF and webpage suites, with one addition: a pair states not
only what changed but which part of the agreement each change belongs to. So a
pair can fail in two new ways — a clause change that got no topic, or a topic
assigned where it does not belong.

The negative pairs carry the most weight. A policy monitor that labels ordinary
prose as a liability clause teaches its reader to ignore the labels, which is
worse than having none. Every pair may therefore forbid topics as well as
require them.

Metrics, matching the other suites:

    recall                 expected changes found / expected changes
    false_positives        reported changes matching nothing expected
    noise_leakage          reported changes the spec forbids
    evidence_completeness  share of changes whose evidence traces into both snapshots
    topic_recall           expected topics assigned / expected topics
    topic_false_positives  topics assigned that the spec forbids
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind, Side
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.policy.classify import PolicyClassification, classify_changes
from diffnexa_engine.policy.signals import ClauseTopic
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.snapshot import Snapshot


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpectedPolicyChange(_Strict):
    category: ChangeCategory | None = None
    kind: ChangeKind | None = None
    old: str | None = None
    new: str | None = None
    section: str | None = None
    subtype: str | None = None
    delta: str | None = None
    match: Literal["exact", "contains"] = "contains"
    #: Topics this change must be given. Empty means the change must have none.
    topics: list[ClauseTopic] = []
    #: Set when a change is expected to carry no topic at all.
    expect_no_topic: bool = False
    note: str | None = None

    @model_validator(mode="after")
    def _identifiable(self) -> ExpectedPolicyChange:
        if self.old is None and self.new is None and self.section is None:
            raise ValueError("an expected change needs a value or a section to identify it")
        if self.topics and self.expect_no_topic:
            raise ValueError("a change cannot both expect topics and expect none")
        return self

    def describe(self) -> str:
        parts = [self.category.value if self.category else "change"]
        if self.section:
            parts.append(f"in '{self.section}'")
        if self.old is not None or self.new is not None:
            parts.append(f"{self.old!r} -> {self.new!r}")
        if self.topics:
            parts.append(f"touching {', '.join(topic.value for topic in self.topics)}")
        return " ".join(parts)


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class PolicyGoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    url: str = "https://example.com/terms"
    expected_changes: list[ExpectedPolicyChange] = []
    must_not_report: list[MustNotReport] = []
    #: Topics that must not be assigned to any change in this pair.
    forbidden_topics: list[ClauseTopic] = []
    #: Topics the document contains but where nothing changed.
    present_unchanged_topics: list[ClauseTopic] = []
    #: Topics that must not be found in the document at all.
    absent_topics: list[ClauseTopic] = []
    max_unexpected_changes: int = Field(default=0, ge=0)


class PolicySpecError(Exception):
    pass


@dataclass(frozen=True)
class PolicyGoldenPair:
    name: str
    directory: Path
    spec: PolicyGoldenSpec
    before: Path
    after: Path


def load_policy_spec(path: Path) -> PolicyGoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise PolicySpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise PolicySpecError(f"{path}: expected a YAML mapping")
    try:
        spec = PolicyGoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise PolicySpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise PolicySpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec


def discover_policy_pairs(root: Path) -> list[PolicyGoldenPair]:
    if not root.exists():
        return []
    pairs: list[PolicyGoldenPair] = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        before, after = directory / "before.html", directory / "after.html"
        missing = [p.name for p in (spec_path, before, after) if not p.exists()]
        if missing:
            raise PolicySpecError(f"{directory}: missing {', '.join(missing)}")
        pairs.append(PolicyGoldenPair(directory.name, directory, load_policy_spec(spec_path), before, after))
    return pairs


# ---------------------------------------------------------------- scoring


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    left, right = normalize(expected), normalize(reported)
    return left == right if mode == "exact" else left in right


def change_matches(expected: ExpectedPolicyChange, change: Change) -> bool:
    if expected.category is not None and change.category is not expected.category:
        return False
    if expected.kind is not None and change.kind is not expected.kind:
        return False
    if expected.subtype is not None and change.subtype != expected.subtype:
        return False
    if not _value_matches(expected.old, change.old_value, expected.match):
        return False
    if not _value_matches(expected.new, change.new_value, expected.match):
        return False
    if expected.delta is not None and change.delta != expected.delta:
        return False
    if expected.section is not None:
        label = normalize(change.label or "")
        sections = {normalize(part) for item in change.evidence for part in item.section_path}
        if normalize(expected.section) != label and normalize(expected.section) not in sections:
            return False
    return True


@dataclass
class PolicyPairScore:
    expected_total: int
    matched: int = 0
    missed: list[str] = field(default_factory=list)
    reported_meaningful: int = 0
    false_positives: list[str] = field(default_factory=list)
    noise_leakage: list[str] = field(default_factory=list)
    evidence_issues: list[str] = field(default_factory=list)
    evidence_completeness: float = 1.0
    dropped_untraceable: int = 0
    max_unexpected_changes: int = 0

    expected_topics: int = 0
    matched_topics: int = 0
    missing_topics: list[str] = field(default_factory=list)
    topic_false_positives: list[str] = field(default_factory=list)
    presence_errors: list[str] = field(default_factory=list)
    untraceable_topics: list[str] = field(default_factory=list)

    @property
    def recall(self) -> float:
        return 1.0 if self.expected_total == 0 else self.matched / self.expected_total

    @property
    def topic_recall(self) -> float:
        return 1.0 if self.expected_topics == 0 else self.matched_topics / self.expected_topics

    @property
    def passed(self) -> bool:
        return (
            self.matched == self.expected_total
            and not self.noise_leakage
            and self.evidence_completeness == 1.0
            and self.dropped_untraceable == 0
            and not self.missing_topics
            and not self.topic_false_positives
            and not self.presence_errors
            and not self.untraceable_topics
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def _topic_phrase_is_traceable(
    change: Change,
    classification: PolicyClassification,
    snapshots: dict[Side, Snapshot],
) -> list[str]:
    """Every topic must rest on text the comparison already proved."""
    problems: list[str] = []
    available = [str(change.old_value), str(change.new_value), str(change.label)]
    for evidence in change.evidence:
        available.append(evidence.excerpt or "")
        available.append(" ".join(evidence.section_path))
        if evidence.node_id and evidence.side in snapshots:
            node = snapshots[evidence.side].node_index().get(evidence.node_id)
            if node is not None:
                available.append(node.text)
    haystack = " ".join(available).casefold()

    for signal in classification.signals_for_change(change.id):
        if signal.matched_text.casefold() not in haystack:
            problems.append(
                f"{change.id}: topic {signal.topic.value} rests on {signal.matched_text!r}, "
                "which is not in the compared text"
            )
    return problems


def score_policy_pair(
    pair: PolicyGoldenPair,
) -> tuple[PolicyPairScore, Snapshot, Snapshot, PolicyClassification]:
    before = extract_snapshot(
        pair.before.read_text(encoding="utf-8"),
        url=pair.spec.url,
        fetched_at="2026-01-01T00:00:00+00:00",
    )
    after = extract_snapshot(
        pair.after.read_text(encoding="utf-8"),
        url=pair.spec.url,
        fetched_at="2026-02-01T00:00:00+00:00",
    )
    outcome = compare_snapshots_verbose(before, after)
    result = outcome.result
    classification = classify_changes(result.changes, after, before)
    snapshots = {Side.OLD: before, Side.NEW: after}

    score = PolicyPairScore(
        expected_total=len(pair.spec.expected_changes),
        max_unexpected_changes=pair.spec.max_unexpected_changes,
        dropped_untraceable=outcome.diagnostics.dropped_untraceable,
        expected_topics=sum(len(expected.topics) for expected in pair.spec.expected_changes),
    )

    issues = verify_web_traceability(result.changes, before, after)
    score.evidence_issues = [f"{issue.change_id}: {issue.message}" for issue in issues]
    if result.changes:
        bad = {issue.change_id for issue in issues}
        score.evidence_completeness = (len(result.changes) - len(bad)) / len(result.changes)

    meaningful = [change for change in result.changes if change.noise_reason is None]
    score.reported_meaningful = len(meaningful)

    # Match expected changes, then check the topics on whatever matched.
    used: set[str] = set()
    for expected in pair.spec.expected_changes:
        hit = next((c for c in meaningful if c.id not in used and change_matches(expected, c)), None)
        if hit is None:
            score.missed.append(expected.describe())
            continue
        used.add(hit.id)
        score.matched += 1

        assigned = set(classification.topics_for(hit.id))
        for topic in expected.topics:
            if topic in assigned:
                score.matched_topics += 1
            else:
                score.missing_topics.append(
                    f"{hit.id}: expected {topic.value}, got {sorted(t.value for t in assigned) or 'nothing'}"
                )
        if expected.expect_no_topic and assigned:
            score.topic_false_positives.append(
                f"{hit.id}: expected no topic, got {sorted(t.value for t in assigned)}"
            )

    # Topics forbidden anywhere in this pair.
    forbidden = set(pair.spec.forbidden_topics)
    for change in meaningful:
        wrong = forbidden & set(classification.topics_for(change.id))
        for topic in sorted(wrong, key=lambda item: item.value):
            score.topic_false_positives.append(f"{change.id}: forbidden topic {topic.value}")
        score.untraceable_topics.extend(_topic_phrase_is_traceable(change, classification, snapshots))

    # Unexpected changes, split into forbidden text and ordinary surprises.
    forbidden_text = [normalize(item.text) for item in pair.spec.must_not_report]
    for change in meaningful:
        if change.id in used:
            continue
        texts = [normalize(value) for value in (change.old_value, change.new_value, change.label) if value]
        texts += [normalize(item.excerpt) for item in change.evidence if item.excerpt]
        hit = next((f for f in forbidden_text if any(f in text for text in texts)), None)
        if hit is not None:
            score.noise_leakage.append(f"{change.id}: reported forbidden text {hit!r}")
        else:
            score.false_positives.append(
                f"{change.id}: {change.kind.value} {change.category.value} "
                f"{change.old_value!r} -> {change.new_value!r}"
            )

    # Presence claims.
    for topic in pair.spec.present_unchanged_topics:
        presence = classification.presence[topic]
        if not presence.found_in_document:
            score.presence_errors.append(f"{topic.value} should be present in the document")
        elif presence.changed != 0:
            score.presence_errors.append(f"{topic.value} should have no changes, has {presence.changed}")
    for topic in pair.spec.absent_topics:
        if classification.presence[topic].found_in_document:
            score.presence_errors.append(f"{topic.value} should not be found in the document")

    return score, before, after, classification
