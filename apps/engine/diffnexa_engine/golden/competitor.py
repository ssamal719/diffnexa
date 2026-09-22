"""The golden suite for Competitor Monitor.

Same idea as the webpage and policy suites, with one addition: a pair states not
only what changed but which signal each change must receive. So a pair can fail
in new ways — a change given the wrong signal, a signal a pair forbids, or a
signal whose quoted text is not in the change's evidence.

The negative pairs matter as much as the positive ones. A monitor that calls an
ordinary paragraph a pricing change teaches its reader to ignore the labels.

Metrics, matching the other suites:

    recall                 expected changes found / expected changes
    false_positives        reported changes matching nothing expected
    noise_leakage          reported changes the spec forbids
    evidence_completeness  share of changes whose evidence traces into both snapshots

and, for signals, every check must pass: expected signal assigned, no forbidden
signal, every signal's quoted text present in the change's own evidence, and the
per-signal groups adding up to exactly the changes found.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.competitor.classify import CompetitorClassification, classify_changes
from diffnexa_engine.competitor.signals import CompetitorSignal
from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind, Side
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.snapshot import Snapshot


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpectedCompetitorChange(_Strict):
    category: ChangeCategory | None = None
    kind: ChangeKind | None = None
    old: str | None = None
    new: str | None = None
    section: str | None = None
    subtype: str | None = None
    delta: str | None = None
    match: Literal["exact", "contains"] = "contains"
    #: The one signal this change must receive.
    signal: CompetitorSignal
    note: str | None = None

    @model_validator(mode="after")
    def _identifiable(self) -> ExpectedCompetitorChange:
        if self.old is None and self.new is None and self.section is None:
            raise ValueError("an expected change needs a value or a section to identify it")
        return self

    def describe(self) -> str:
        parts = [self.category.value if self.category else "change"]
        if self.section:
            parts.append(f"in '{self.section}'")
        if self.old is not None or self.new is not None:
            parts.append(f"{self.old!r} -> {self.new!r}")
        parts.append(f"as {self.signal.value}")
        return " ".join(parts)


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class CompetitorGoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    url: str = "https://competitor.example.com/pricing"
    expected_changes: list[ExpectedCompetitorChange] = []
    must_not_report: list[MustNotReport] = []
    #: Signals no change in this pair may receive.
    forbidden_signals: list[CompetitorSignal] = []
    max_unexpected_changes: int = Field(default=0, ge=0)


class CompetitorSpecError(Exception):
    pass


@dataclass(frozen=True)
class CompetitorGoldenPair:
    name: str
    directory: Path
    spec: CompetitorGoldenSpec
    before: Path
    after: Path


def load_competitor_spec(path: Path) -> CompetitorGoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise CompetitorSpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise CompetitorSpecError(f"{path}: expected a YAML mapping")
    try:
        spec = CompetitorGoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise CompetitorSpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise CompetitorSpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec


def discover_competitor_pairs(root: Path) -> list[CompetitorGoldenPair]:
    if not root.exists():
        return []
    pairs: list[CompetitorGoldenPair] = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        before, after = directory / "before.html", directory / "after.html"
        missing = [p.name for p in (spec_path, before, after) if not p.exists()]
        if missing:
            raise CompetitorSpecError(f"{directory}: missing {', '.join(missing)}")
        pairs.append(
            CompetitorGoldenPair(directory.name, directory, load_competitor_spec(spec_path), before, after)
        )
    return pairs


# ---------------------------------------------------------------- scoring


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    left, right = normalize(expected), normalize(reported)
    return left == right if mode == "exact" else left in right


def change_matches(expected: ExpectedCompetitorChange, change: Change) -> bool:
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
class CompetitorPairScore:
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

    wrong_signals: list[str] = field(default_factory=list)
    forbidden_signals: list[str] = field(default_factory=list)
    untraceable_signals: list[str] = field(default_factory=list)
    partition_errors: list[str] = field(default_factory=list)

    @property
    def recall(self) -> float:
        return 1.0 if self.expected_total == 0 else self.matched / self.expected_total

    @property
    def passed(self) -> bool:
        return (
            self.matched == self.expected_total
            and not self.noise_leakage
            and self.evidence_completeness == 1.0
            and self.dropped_untraceable == 0
            and not self.wrong_signals
            and not self.forbidden_signals
            and not self.untraceable_signals
            and not self.partition_errors
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def _signal_is_traceable(
    change: Change, classification: CompetitorClassification, snapshots: dict[Side, Snapshot]
) -> str | None:
    """A signal's quoted text must be in text the comparison already proved."""
    found = classification.signal_for(change.id)
    if found is None:
        return f"{change.id}: has no signal"
    if found.signal is CompetitorSignal.OTHER:
        return None if found.matched_text == "" else f"{change.id}: Other must quote nothing"
    if not found.matched_text:
        return f"{change.id}: {found.signal.value} quotes no text"

    available = [change.old_value or "", change.new_value or "", change.label or ""]
    for evidence in change.evidence:
        available.append(evidence.excerpt or "")
        available.extend(evidence.section_path)
        if evidence.node_id and evidence.side in snapshots:
            node = snapshots[evidence.side].node_index().get(evidence.node_id)
            if node is not None:
                available.append(node.text)
    if found.matched_text not in " ".join(available):
        return f"{change.id}: {found.signal.value} rests on {found.matched_text!r}, not in the compared text"
    return None


def score_competitor_pair(
    pair: CompetitorGoldenPair,
) -> tuple[CompetitorPairScore, Snapshot, Snapshot, CompetitorClassification]:
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

    score = CompetitorPairScore(
        expected_total=len(pair.spec.expected_changes),
        max_unexpected_changes=pair.spec.max_unexpected_changes,
        dropped_untraceable=outcome.diagnostics.dropped_untraceable,
    )

    issues = verify_web_traceability(result.changes, before, after)
    score.evidence_issues = [f"{issue.change_id}: {issue.message}" for issue in issues]
    if result.changes:
        bad = {issue.change_id for issue in issues}
        score.evidence_completeness = (len(result.changes) - len(bad)) / len(result.changes)

    meaningful = [change for change in result.changes if change.noise_reason is None]
    score.reported_meaningful = len(meaningful)

    used: set[str] = set()
    for expected in pair.spec.expected_changes:
        hit = next((c for c in meaningful if c.id not in used and change_matches(expected, c)), None)
        if hit is None:
            score.missed.append(expected.describe())
            continue
        used.add(hit.id)
        score.matched += 1
        assigned = classification.signal_for(hit.id)
        if assigned is None or assigned.signal is not expected.signal:
            got = assigned.signal.value if assigned else None
            score.wrong_signals.append(f"{hit.id}: expected {expected.signal.value}, got {got}")

    forbidden = set(pair.spec.forbidden_signals)
    for change in result.changes:
        assigned = classification.signal_for(change.id)
        if assigned is not None and assigned.signal in forbidden and change.noise_reason is None:
            score.forbidden_signals.append(f"{change.id}: forbidden signal {assigned.signal.value}")
        problem = _signal_is_traceable(change, classification, snapshots)
        if problem:
            score.untraceable_signals.append(problem)

    # The groups a reader sees must be exactly the changes found: none missing,
    # none counted twice, none invented.
    grouped = sorted(cid for signal in CompetitorSignal for cid in classification.change_ids_for(signal))
    if grouped != sorted(change.id for change in meaningful):
        score.partition_errors.append(f"groups {grouped} != changes {sorted(c.id for c in meaningful)}")

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

    return score, before, after, classification


__all__ = [
    "CompetitorGoldenPair",
    "CompetitorGoldenSpec",
    "CompetitorPairScore",
    "CompetitorSpecError",
    "ExpectedCompetitorChange",
    "discover_competitor_pairs",
    "load_competitor_spec",
    "score_competitor_pair",
]
