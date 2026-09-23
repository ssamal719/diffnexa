"""The golden suite for Excel Compare.

Each pair is two real workbooks (before.xlsx, after.xlsx) saved by a spreadsheet
application, and a hand-written statement of what really changed: each change,
the group it belongs to, and the sheet and cell a reader will be taken to — on
both sides when a row or column moved the cell. Some pairs instead hold a
damaged, unsupported or hostile file and state the refusal it must produce.

Scored on the response the website receives. Metrics, matching the other suites:

    recall                 expected changes found / expected changes
    false_positives        reported changes matching nothing expected
    noise_leakage          reported changes quoting text the spec forbids
    evidence_completeness  share of changes whose evidence traces into both workbooks

and every structural check must pass: each change in its expected group and at
its expected place, and the groups adding up to exactly the changes found.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import ChangeCategory, ChangeKind
from diffnexa_engine.contracts.xlsx_traceability import verify_xlsx_traceability
from diffnexa_engine.xlsx.api import serialize_excel_comparison
from diffnexa_engine.xlsx.compare import compare_xlsx
from diffnexa_engine.xlsx.errors import ExcelError, ExcelErrorCode
from diffnexa_engine.xlsx.extract import extract_xlsx

GroupId = Literal["values", "formulas", "structure", "links"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpectedExcelChange(_Strict):
    group: GroupId
    kind: ChangeKind | None = None
    category: ChangeCategory | None = None
    subtype: str | None = None
    sheet: str
    #: The place a reader is taken to (revised side, or original if removed).
    ref: str | None = None
    original_ref: str | None = None
    revised_ref: str | None = None
    old: str | None = None
    new: str | None = None
    delta: str | None = None
    match: Literal["exact", "contains"] = "exact"
    note: str | None = None

    def describe(self) -> str:
        where = f"{self.sheet} · {self.ref}" if self.ref else self.sheet
        kind = self.kind.value if self.kind else "change"
        return f"{self.group} {kind} at {where}: {self.old!r} -> {self.new!r}"


class ExpectedError(_Strict):
    side: Literal["original", "revised"]
    code: ExcelErrorCode


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class ExcelGoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    expected_changes: list[ExpectedExcelChange] = []
    expected_error: ExpectedError | None = None
    must_not_report: list[MustNotReport] = []
    max_unexpected_changes: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _one_kind_of_expectation(self) -> ExcelGoldenSpec:
        if self.expected_error is not None and self.expected_changes:
            raise ValueError("a pair expects either a refusal or changes, not both")
        return self


class ExcelSpecError(Exception):
    pass


@dataclass(frozen=True)
class ExcelGoldenPair:
    name: str
    directory: Path
    spec: ExcelGoldenSpec
    before: Path
    after: Path


def load_excel_spec(path: Path) -> ExcelGoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ExcelSpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise ExcelSpecError(f"{path}: expected a YAML mapping")
    try:
        spec = ExcelGoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise ExcelSpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise ExcelSpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec


def discover_excel_pairs(root: Path) -> list[ExcelGoldenPair]:
    if not root.exists():
        return []
    pairs: list[ExcelGoldenPair] = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        before, after = directory / "before.xlsx", directory / "after.xlsx"
        missing = [p.name for p in (spec_path, before, after) if not p.exists()]
        if missing:
            raise ExcelSpecError(f"{directory}: missing {', '.join(missing)}")
        pairs.append(ExcelGoldenPair(directory.name, directory, load_excel_spec(spec_path), before, after))
    return pairs


# ---------------------------------------------------------------- scoring


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    left, right = normalize(expected), normalize(reported)
    return left == right if mode == "exact" else left in right


def change_matches(expected: ExpectedExcelChange, change: dict[str, Any]) -> bool:
    """Whether a reported change is this expected one. Group and place are checked separately."""
    if expected.kind is not None and change["kind"] != expected.kind.value:
        return False
    if expected.category is not None and change["category"] != expected.category.value:
        return False
    if expected.subtype is not None and change["subtype"] != expected.subtype:
        return False
    if change["sheet"] != expected.sheet:
        return False
    if not _value_matches(expected.old, change["oldValue"], expected.match):
        return False
    if not _value_matches(expected.new, change["newValue"], expected.match):
        return False
    return expected.delta is None or change["delta"] == expected.delta


@dataclass
class ExcelPairScore:
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
    wrong_places: list[str] = field(default_factory=list)
    partition_errors: list[str] = field(default_factory=list)
    refusal_errors: list[str] = field(default_factory=list)

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
            and not self.wrong_places
            and not self.partition_errors
            and not self.refusal_errors
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def _score_refusal(pair: ExcelGoldenPair, expected: ExpectedError) -> ExcelPairScore:
    score = ExcelPairScore(expected_total=1)
    found: tuple[str, ExcelErrorCode] | None = None
    for side, path in (("original", pair.before), ("revised", pair.after)):
        try:
            extract_xlsx(path.read_bytes())
        except ExcelError as exc:
            found = (side, exc.code)
            break
    if found == (expected.side, expected.code):
        score.matched = 1
    else:
        score.missed.append(f"refusal {expected.code.value} on the {expected.side} workbook")
        score.refusal_errors.append(f"got {found!r}")
    return score


def score_excel_pair(pair: ExcelGoldenPair) -> tuple[ExcelPairScore, dict[str, Any] | None]:
    if pair.spec.expected_error is not None:
        return _score_refusal(pair, pair.spec.expected_error), None

    before = extract_xlsx(pair.before.read_bytes())
    after = extract_xlsx(pair.after.read_bytes())
    outcome = compare_xlsx(before, after)
    payload = serialize_excel_comparison(outcome, processing_ms=0)
    changes = payload["changes"]

    score = ExcelPairScore(
        expected_total=len(pair.spec.expected_changes),
        max_unexpected_changes=pair.spec.max_unexpected_changes,
        dropped_untraceable=outcome.diagnostics.dropped_untraceable,
        reported_meaningful=len(changes),
    )

    issues = verify_xlsx_traceability(outcome.result.changes, before, after)
    score.evidence_issues = [f"{issue.change_id}: {issue.message}" for issue in issues]
    if changes:
        bad = {issue.change_id for issue in issues}
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
        places = (
            ("ref", expected.ref, hit["ref"]),
            ("original", expected.original_ref, (hit["original"] or {}).get("ref")),
            ("revised", expected.revised_ref, (hit["revised"] or {}).get("ref")),
        )
        for label, wanted, got in places:
            if wanted is not None and wanted != got:
                score.wrong_places.append(f"{hit['id']}: {label} expected {wanted}, got {got}")

    grouped = sorted(change_id for group in payload["groups"] for change_id in group["changeIds"])
    if grouped != sorted(change["id"] for change in changes):
        score.partition_errors.append(f"groups {grouped} != changes {sorted(c['id'] for c in changes)}")

    forbidden = [normalize(item.text) for item in pair.spec.must_not_report]
    for change in changes:
        if change["id"] in used:
            continue
        values = (change["oldValue"], change["newValue"], change["label"])
        texts = [normalize(value) for value in values if value]
        hit_text = next((f for f in forbidden if any(f in text for text in texts)), None)
        if hit_text is not None:
            score.noise_leakage.append(f"{change['id']}: reported forbidden text {hit_text!r}")
        else:
            score.false_positives.append(
                f"{change['id']}: {change['kind']} {change['category']} at "
                f"{change['sheet']} · {change['ref']} {change['oldValue']!r} -> {change['newValue']!r}"
            )
    return score, payload


__all__ = [
    "ExcelGoldenPair",
    "ExcelGoldenSpec",
    "ExcelPairScore",
    "ExcelSpecError",
    "ExpectedExcelChange",
    "change_matches",
    "discover_excel_pairs",
    "load_excel_spec",
    "score_excel_pair",
]
