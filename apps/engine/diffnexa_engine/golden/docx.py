"""The golden suite for DOCX Compare.

Each pair is two real Word documents (before.docx, after.docx) and a
hand-written statement of what really changed: the change, the group a reader
will find it under, and where in the document its evidence must point
("Table 1, row 2, column 2", "Heading 1, paragraph 7").

Scored on the response the website receives, so what is checked is what a user
sees. Metrics, matching the other suites:

    recall                 expected changes found / expected changes
    false_positives        reported changes matching nothing expected
    noise_leakage          reported changes quoting text the spec forbids
    evidence_completeness  share of changes whose evidence traces into both documents

and every structural check must pass: each expected change in its expected
group, its evidence at each expected location, every piece of evidence located,
and the groups adding up to exactly the changes found.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import ChangeCategory, ChangeKind
from diffnexa_engine.contracts.docx_traceability import verify_docx_traceability
from diffnexa_engine.docx.api import GROUPS, serialize_docx_comparison
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.docx.extract import extract_docx

GroupId = Literal["text", "headings", "lists", "tables", "numbers", "dates", "structure", "other"]
assert set(GroupId.__args__) == {group_id for group_id, _label in GROUPS}  # type: ignore[attr-defined]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpectedDocxChange(_Strict):
    group: GroupId
    kind: ChangeKind | None = None
    category: ChangeCategory | None = None
    subtype: str | None = None
    old: str | None = None
    new: str | None = None
    delta: str | None = None
    match: Literal["exact", "contains"] = "contains"
    #: Places the change's evidence must point to, as the reader sees them.
    locations: list[str] = []
    #: The page the change's evidence must give in each version, when the files record their pages.
    #: Taken from a rendering of the documents, never from DiffNexa's own output.
    old_page: int | None = Field(default=None, ge=1)
    new_page: int | None = Field(default=None, ge=1)
    note: str | None = None

    @model_validator(mode="after")
    def _identifiable(self) -> ExpectedDocxChange:
        if self.old is None and self.new is None:
            raise ValueError("an expected change needs an old or a new value to identify it")
        return self

    def describe(self) -> str:
        return f"{self.group} {self.kind.value if self.kind else 'change'} {self.old!r} -> {self.new!r}"


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class DocxGoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    expected_changes: list[ExpectedDocxChange] = []
    must_not_report: list[MustNotReport] = []
    max_unexpected_changes: int = Field(default=0, ge=0)


class DocxSpecError(Exception):
    pass


@dataclass(frozen=True)
class DocxGoldenPair:
    name: str
    directory: Path
    spec: DocxGoldenSpec
    before: Path
    after: Path


def load_docx_spec(path: Path) -> DocxGoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise DocxSpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise DocxSpecError(f"{path}: expected a YAML mapping")
    try:
        spec = DocxGoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise DocxSpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise DocxSpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec


def discover_docx_pairs(root: Path) -> list[DocxGoldenPair]:
    if not root.exists():
        return []
    pairs: list[DocxGoldenPair] = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        before, after = directory / "before.docx", directory / "after.docx"
        missing = [p.name for p in (spec_path, before, after) if not p.exists()]
        if missing:
            raise DocxSpecError(f"{directory}: missing {', '.join(missing)}")
        pairs.append(DocxGoldenPair(directory.name, directory, load_docx_spec(spec_path), before, after))
    return pairs


# ---------------------------------------------------------------- scoring


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    left, right = normalize(expected), normalize(reported)
    return left == right if mode == "exact" else left in right


def change_matches(expected: ExpectedDocxChange, change: dict[str, Any]) -> bool:
    """Whether a reported change is this expected one. The group is checked separately."""
    if expected.kind is not None and change["kind"] != expected.kind.value:
        return False
    if expected.category is not None and change["category"] != expected.category.value:
        return False
    if expected.subtype is not None and change["subtype"] != expected.subtype:
        return False
    if not _value_matches(expected.old, change["oldValue"], expected.match):
        return False
    if not _value_matches(expected.new, change["newValue"], expected.match):
        return False
    return expected.delta is None or change["delta"] == expected.delta


@dataclass
class DocxPairScore:
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

    wrong_groups: list[str] = field(default_factory=list)
    wrong_locations: list[str] = field(default_factory=list)
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
            and not self.wrong_groups
            and not self.wrong_locations
            and not self.partition_errors
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def score_docx_pair(pair: DocxGoldenPair) -> tuple[DocxPairScore, dict[str, Any]]:
    before = extract_docx(pair.before.read_bytes())
    after = extract_docx(pair.after.read_bytes())
    outcome = compare_docx(before, after)
    payload = serialize_docx_comparison(outcome, processing_ms=0)
    changes = payload["changes"]

    score = DocxPairScore(
        expected_total=len(pair.spec.expected_changes),
        max_unexpected_changes=pair.spec.max_unexpected_changes,
        dropped_untraceable=outcome.diagnostics.dropped_untraceable,
        reported_meaningful=len(changes),
    )

    issues = verify_docx_traceability(outcome.result.changes, before, after)
    score.evidence_issues = [f"{issue.change_id}: {issue.message}" for issue in issues]
    for change in changes:
        for item in change["evidence"]:
            if not item["location"]:
                score.evidence_issues.append(f"{change['id']}: evidence without a location")
    if changes:
        bad = {issue.change_id for issue in issues} | {
            change["id"] for change in changes if any(not item["location"] for item in change["evidence"])
        }
        score.evidence_completeness = (len(changes) - len(bad)) / len(changes)

    used: set[str] = set()
    for expected in pair.spec.expected_changes:
        hit = next((c for c in changes if c["id"] not in used and change_matches(expected, c)), None)
        if hit is None:
            score.missed.append(expected.describe())
            continue
        used.add(hit["id"])
        score.matched += 1
        if hit["group"] != expected.group:
            score.wrong_groups.append(f"{hit['id']}: expected group {expected.group}, got {hit['group']}")
        cited = {item["location"] for item in hit["evidence"]}
        for location in expected.locations:
            if location not in cited:
                score.wrong_locations.append(
                    f"{hit['id']}: no evidence at {location!r} (cited {sorted(cited)})"
                )
        for side, page in (("old", expected.old_page), ("new", expected.new_page)):
            if page is None:
                continue
            given = sorted({item.get("page") or 0 for item in hit["evidence"] if item["side"] == side})
            if given != [page]:
                score.wrong_locations.append(
                    f"{hit['id']}: expected {side} page {page}, evidence gives {given}"
                )

    # The groups a reader sees must be exactly the changes found.
    grouped = sorted(change_id for group in payload["groups"] for change_id in group["changeIds"])
    if grouped != sorted(change["id"] for change in changes):
        score.partition_errors.append(f"groups {grouped} != changes {sorted(c['id'] for c in changes)}")

    forbidden_text = [normalize(item.text) for item in pair.spec.must_not_report]
    for change in changes:
        if change["id"] in used:
            continue
        texts = [
            normalize(value) for value in (change["oldValue"], change["newValue"], change["label"]) if value
        ]
        texts += [normalize(item["excerpt"]) for item in change["evidence"] if item["excerpt"]]
        hit_text = next((f for f in forbidden_text if any(f in text for text in texts)), None)
        if hit_text is not None:
            score.noise_leakage.append(f"{change['id']}: reported forbidden text {hit_text!r}")
        else:
            score.false_positives.append(
                f"{change['id']}: {change['kind']} {change['category']} "
                f"{change['oldValue']!r} -> {change['newValue']!r}"
            )

    return score, payload


__all__ = [
    "DocxGoldenPair",
    "DocxGoldenSpec",
    "DocxPairScore",
    "DocxSpecError",
    "ExpectedDocxChange",
    "change_matches",
    "discover_docx_pairs",
    "load_docx_spec",
    "score_docx_pair",
]
