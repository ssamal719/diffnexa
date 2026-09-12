"""The golden suite for webpage comparison.

Same idea as the PDF suite, same four metrics, different source material: a pair
is two saved HTML files plus a written statement of what really changed between
them. The scorer answers the only question that matters — did we find what was
there, and nothing that was not.

    recall                 expected changes found / expected changes
    false_positives        reported changes matching nothing expected
    noise_leakage          reported changes the spec forbids
    evidence_completeness  share of changes whose evidence traces into both snapshots

A pair passes only with full recall, no noise leakage, fully traceable evidence,
and no more false positives than the spec explicitly allows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.snapshot import Snapshot


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpectedWebChange(_Strict):
    category: ChangeCategory
    kind: ChangeKind | None = None
    old: str | None = None
    new: str | None = None
    # The nearest heading, which is how a webpage says "where".
    section: str | None = None
    subtype: str | None = None
    delta: str | None = None
    match: Literal["exact", "contains"] = "exact"
    note: str | None = None

    @model_validator(mode="after")
    def _identifiable(self) -> ExpectedWebChange:
        if self.old is None and self.new is None and self.section is None:
            raise ValueError("an expected change needs a value or a section to identify it")
        return self

    def describe(self) -> str:
        parts = [self.category.value]
        if self.kind:
            parts.append(self.kind.value)
        if self.section:
            parts.append(f"in '{self.section}'")
        if self.old is not None or self.new is not None:
            parts.append(f"{self.old!r} -> {self.new!r}")
        return " ".join(parts)


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class WebGoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    url: str = "https://example.com/page"
    expected_changes: list[ExpectedWebChange] = []
    must_not_report: list[MustNotReport] = []
    max_unexpected_changes: int = Field(default=0, ge=0)


class WebSpecError(Exception):
    pass


@dataclass(frozen=True)
class WebGoldenPair:
    name: str
    directory: Path
    spec: WebGoldenSpec
    before: Path
    after: Path


def load_web_spec(path: Path) -> WebGoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise WebSpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise WebSpecError(f"{path}: expected a YAML mapping")
    try:
        spec = WebGoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise WebSpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise WebSpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec


def discover_web_pairs(root: Path) -> list[WebGoldenPair]:
    if not root.exists():
        return []
    pairs: list[WebGoldenPair] = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        before, after = directory / "before.html", directory / "after.html"
        missing = [p.name for p in (spec_path, before, after) if not p.exists()]
        if missing:
            raise WebSpecError(f"{directory}: missing {', '.join(missing)}")
        pairs.append(WebGoldenPair(directory.name, directory, load_web_spec(spec_path), before, after))
    return pairs


# ---------------------------------------------------------------- scoring


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    left, right = normalize(expected), normalize(reported)
    return left == right if mode == "exact" else left in right


def change_matches(expected: ExpectedWebChange, change: Change) -> bool:
    if change.category is not expected.category:
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
class WebPairScore:
    expected_total: int
    matched: int = 0
    missed: list[str] = field(default_factory=list)
    reported_meaningful: int = 0
    reported_noise: int = 0
    false_positives: list[str] = field(default_factory=list)
    noise_leakage: list[str] = field(default_factory=list)
    evidence_issues: list[str] = field(default_factory=list)
    evidence_completeness: float = 1.0
    dropped_untraceable: int = 0
    max_unexpected_changes: int = 0

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
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def score_web_pair(pair: WebGoldenPair) -> tuple[WebPairScore, Snapshot, Snapshot]:
    before = extract_snapshot(
        pair.before.read_text(encoding="utf-8"), url=pair.spec.url, fetched_at="2026-01-01T00:00:00+00:00"
    )
    after = extract_snapshot(
        pair.after.read_text(encoding="utf-8"), url=pair.spec.url, fetched_at="2026-02-01T00:00:00+00:00"
    )
    outcome = compare_snapshots_verbose(before, after)
    result = outcome.result

    score = WebPairScore(
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
    score.reported_noise = len(result.changes) - len(meaningful)

    used: set[str] = set()
    ordered = meaningful + [c for c in result.changes if c.noise_reason is not None]
    for expected in pair.spec.expected_changes:
        hit = next((c for c in ordered if c.id not in used and change_matches(expected, c)), None)
        if hit is None:
            score.missed.append(expected.describe())
        else:
            used.add(hit.id)
            score.matched += 1

    forbidden = [normalize(item.text) for item in pair.spec.must_not_report]
    for change in meaningful:
        if change.id in used:
            continue
        texts = [normalize(value) for value in (change.old_value, change.new_value, change.label) if value]
        texts += [normalize(item.excerpt) for item in change.evidence if item.excerpt]
        hit = next((f for f in forbidden if any(f in text for text in texts)), None)
        if hit is not None:
            score.noise_leakage.append(f"{change.id}: reported forbidden text {hit!r}")
        else:
            score.false_positives.append(
                f"{change.id}: {change.kind.value} {change.category.value} "
                f"{change.old_value!r} -> {change.new_value!r}"
            )

    return score, before, after
