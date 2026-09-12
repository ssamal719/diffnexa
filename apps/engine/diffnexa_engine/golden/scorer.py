"""Score extraction and comparison output against a golden spec.

Comparison metrics (per pair):
    recall                 expected changes found / expected changes
    false_positives        meaningful reported changes that match nothing expected
    noise_leakage          meaningful reported changes that the spec forbids
                           (on an unchanged page, or containing must-not-report text)
    evidence_completeness  share of reported changes whose evidence traces into the PDFs

"Meaningful" = the engine did not classify the change as noise (noise_reason).
A pair passes only with recall 1.0, no noise leakage, 100% traceable evidence,
and no more false positives than max_unexpected_changes allows.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from diffnexa_engine.contracts.changes import Change, ComparisonResult, Side
from diffnexa_engine.contracts.traceability import normalize_text, verify_traceability
from diffnexa_engine.golden.spec import DocumentExpectation, ExpectedChange, GoldenSpec
from diffnexa_engine.model.document import Document, TextLayerStatus

# ---------------------------------------------------------------- extraction


def check_extraction(expect: DocumentExpectation | None, doc: Document) -> list[str]:
    if expect is None:
        return []
    failures: list[str] = []
    if expect.page_count is not None and doc.page_count != expect.page_count:
        failures.append(f"expected {expect.page_count} pages, extracted {doc.page_count}")
    if expect.scanned_pages is not None:
        found = sorted(p.number for p in doc.pages if p.likely_scanned)
        if found != sorted(expect.scanned_pages):
            failures.append(f"expected scanned pages {sorted(expect.scanned_pages)}, found {found}")
    for item in expect.must_contain:
        if item.page > doc.page_count:
            failures.append(f"page {item.page} does not exist (looking for {item.text!r})")
            continue
        page = doc.page(item.page)
        if page.text_layer is not TextLayerStatus.PRESENT:
            failures.append(f"page {item.page} has no readable text (looking for {item.text!r})")
            continue
        if normalize_text(item.text) not in normalize_text(page.text()):
            failures.append(f"page {item.page} does not contain {item.text!r}")
    return failures


# ---------------------------------------------------------------- comparison


def _value_matches(expected: str | None, reported: str | None, mode: str) -> bool:
    if expected is None:
        return True
    if reported is None:
        return False
    e, r = normalize_text(expected), normalize_text(reported)
    return e == r if mode == "exact" else e in r


def change_matches(expected: ExpectedChange, change: Change) -> bool:
    if change.category is not expected.category:
        return False
    if expected.kind is not None and change.kind is not expected.kind:
        return False
    if not _value_matches(expected.old, change.old_value, expected.match):
        return False
    if not _value_matches(expected.new, change.new_value, expected.match):
        return False
    if expected.old_page is not None and expected.old_page not in change.evidence_pages(Side.OLD):
        return False
    if expected.new_page is not None and expected.new_page not in change.evidence_pages(Side.NEW):
        return False
    return True


def _texts_of(change: Change) -> list[str]:
    texts = [v for v in (change.old_value, change.new_value) if v]
    texts += [e.excerpt for e in change.evidence if e.excerpt]
    return [normalize_text(t) for t in texts]


def _only_on_unchanged_pages(change: Change, spec: GoldenSpec) -> bool:
    unchanged = {Side.OLD: set(spec.unchanged_pages.old), Side.NEW: set(spec.unchanged_pages.new)}
    located = [e for e in change.evidence if e.page is not None]
    if not located:
        return False
    return all(e.page in unchanged[e.side] for e in located)


@dataclass
class PairScore:
    expected_total: int
    matched: int
    missed: list[str] = field(default_factory=list)
    reported_meaningful: int = 0
    reported_noise: int = 0
    false_positives: list[str] = field(default_factory=list)
    noise_leakage: list[str] = field(default_factory=list)
    evidence_issues: list[str] = field(default_factory=list)
    evidence_completeness: float = 1.0
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
            and len(self.false_positives) <= self.max_unexpected_changes
        )


def score_comparison(
    spec: GoldenSpec, result: ComparisonResult, old_doc: Document, new_doc: Document
) -> PairScore:
    score = PairScore(
        expected_total=len(spec.expected_changes),
        matched=0,
        max_unexpected_changes=spec.max_unexpected_changes,
    )

    issues = verify_traceability(result, old_doc, new_doc)
    bad_ids = {i.change_id for i in issues}
    score.evidence_issues = [f"{i.change_id}: {i.message}" for i in issues]
    if result.changes:
        traced = sum(1 for c in result.changes if c.id not in bad_ids)
        score.evidence_completeness = 0.0 if "*" in bad_ids else traced / len(result.changes)
    elif "*" in bad_ids:
        score.evidence_completeness = 0.0

    meaningful = [c for c in result.changes if c.noise_reason is None]
    score.reported_meaningful = len(meaningful)
    score.reported_noise = len(result.changes) - len(meaningful)

    # One-to-one matching: each reported change satisfies at most one expectation.
    # Meaningful changes are tried before noise-classified ones.
    used: set[str] = set()
    ordered = meaningful + [c for c in result.changes if c.noise_reason is not None]
    for expected in spec.expected_changes:
        hit = next((c for c in ordered if c.id not in used and change_matches(expected, c)), None)
        if hit is None:
            score.missed.append(expected.describe())
        else:
            used.add(hit.id)
            score.matched += 1

    forbidden = [normalize_text(m.text) for m in spec.must_not_report]
    for change in meaningful:
        if change.id in used:
            continue
        texts = _texts_of(change)
        forbidden_hit = next((f for f in forbidden if any(f in t for t in texts)), None)
        if forbidden_hit is not None:
            score.noise_leakage.append(f"{change.id}: reported forbidden text {forbidden_hit!r}")
        elif _only_on_unchanged_pages(change, spec):
            score.noise_leakage.append(f"{change.id}: reported on a page that did not change")
        else:
            score.false_positives.append(
                f"{change.id}: {change.kind.value} {change.category.value} "
                f"{change.old_value!r} -> {change.new_value!r}"
            )
    return score
