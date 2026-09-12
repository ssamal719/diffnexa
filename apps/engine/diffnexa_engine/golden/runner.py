"""Run the golden suite and write the scorecard.

For each pair: extract both PDFs, check extraction expectations, and (when a
comparator is supplied) compare and score. Without a comparator, comparison is
reported as "not yet available" — never as passed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from html import escape
from pathlib import Path

from diffnexa_engine.adapters.pdf.extract import extract_file
from diffnexa_engine.contracts.comparator import Comparator
from diffnexa_engine.errors import DocumentError
from diffnexa_engine.golden.baseline import PairMetrics
from diffnexa_engine.golden.loader import GoldenPair
from diffnexa_engine.golden.scorer import PairScore, check_extraction, score_comparison
from diffnexa_engine.model.document import Document
from diffnexa_engine.reports.extraction_report import render_extraction_html


@dataclass
class PairOutcome:
    name: str
    source: str
    description: str
    extraction_failures: list[str] = field(default_factory=list)
    comparison_status: str = "not_available"  # not_available | scored | error
    comparison_error: str | None = None
    score: PairScore | None = None

    @property
    def extraction_passed(self) -> bool:
        return not self.extraction_failures

    def metrics(self) -> PairMetrics:
        comparison = None
        if self.score is not None:
            comparison = {
                "recall": round(self.score.recall, 4),
                "false_positives": float(len(self.score.false_positives)),
                "noise_leakage": float(len(self.score.noise_leakage)),
                "evidence_completeness": round(self.score.evidence_completeness, 4),
            }
        return PairMetrics(self.extraction_passed, comparison)


@dataclass
class SuiteOutcome:
    pairs: list[PairOutcome]
    comparator_available: bool

    def metrics(self) -> dict[str, PairMetrics]:
        return {p.name: p.metrics() for p in self.pairs}

    @property
    def extraction_failures(self) -> int:
        return sum(1 for p in self.pairs if not p.extraction_passed)

    @property
    def comparison_failures(self) -> int:
        return sum(
            1
            for p in self.pairs
            if p.comparison_status == "error" or (p.score is not None and not p.score.passed)
        )


def run_pair(pair: GoldenPair, comparator: Comparator | None, report_dir: Path | None) -> PairOutcome:
    outcome = PairOutcome(pair.name, pair.spec.source, pair.spec.description)
    docs: dict[str, Document] = {}
    for side, path, expect in (
        ("old", pair.old_pdf, pair.spec.extraction.old),
        ("new", pair.new_pdf, pair.spec.extraction.new),
    ):
        try:
            doc = extract_file(str(path))
        except DocumentError as exc:
            outcome.extraction_failures.append(f"{side}.pdf could not be read ({exc.code.value})")
            continue
        docs[side] = doc
        outcome.extraction_failures += [f"{side}.pdf: {f}" for f in check_extraction(expect, doc)]
        if report_dir is not None:
            target = report_dir / "pairs" / pair.name
            target.mkdir(parents=True, exist_ok=True)
            (target / f"{side}.extraction.html").write_text(
                render_extraction_html(doc, f"{pair.name} / {side}.pdf"), encoding="utf-8"
            )

    if comparator is not None and len(docs) == 2:
        try:
            result = comparator(docs["old"], docs["new"])
            outcome.score = score_comparison(pair.spec, result, docs["old"], docs["new"])
            outcome.comparison_status = "scored"
        except Exception as exc:  # a crashing comparator is a failure, not a skip
            outcome.comparison_status = "error"
            outcome.comparison_error = f"{type(exc).__name__}: {exc}"
    return outcome


def run_suite(
    pairs: list[GoldenPair], comparator: Comparator | None = None, report_dir: Path | None = None
) -> SuiteOutcome:
    if report_dir is not None:
        report_dir.mkdir(parents=True, exist_ok=True)
    suite = SuiteOutcome([run_pair(p, comparator, report_dir) for p in pairs], comparator is not None)
    if report_dir is not None:
        write_reports(suite, report_dir)
    return suite


# ---------------------------------------------------------------- reports


def _comparison_cell(p: PairOutcome) -> str:
    if p.comparison_status == "not_available":
        return "Not run yet (comparison engine arrives in Stage 3)"
    if p.comparison_status == "error":
        return f"ERROR: {p.comparison_error}"
    s = p.score
    assert s is not None
    verdict = "PASS" if s.passed else "FAIL"
    return (
        f"{verdict}: recall {s.recall:.0%}, false positives {len(s.false_positives)}, "
        f"noise leakage {len(s.noise_leakage)}, evidence {s.evidence_completeness:.0%}"
    )


def render_summary_markdown(suite: SuiteOutcome, regressions: list[str], new_pairs: list[str]) -> str:
    lines = ["## DiffNexa golden suite", ""]
    lines.append(
        f"Pairs: **{len(suite.pairs)}** · Extraction failures: **{suite.extraction_failures}** · "
        f"Comparison failures: **{suite.comparison_failures}** · "
        f"Accuracy regressions: **{len(regressions)}**"
    )
    if not suite.comparator_available:
        lines += ["", "_Comparison scoring starts in Stage 3. This run checks extraction only._"]
    lines += ["", "| Pair | Source | Extraction | Comparison |", "|---|---|---|---|"]
    for p in suite.pairs:
        extraction = "PASS" if p.extraction_passed else "FAIL: " + "; ".join(p.extraction_failures)
        lines.append(f"| {p.name} | {p.source} | {extraction} | {_comparison_cell(p)} |")
    if regressions:
        lines += ["", "### Accuracy regressions", ""] + [f"- {r}" for r in regressions]
    if new_pairs:
        lines += ["", "### New pairs (not yet in baseline)", ""] + [f"- {n}" for n in new_pairs]
    return "\n".join(lines) + "\n"


def write_reports(
    suite: SuiteOutcome,
    report_dir: Path,
    regressions: list[str] | None = None,
    new_pairs: list[str] | None = None,
) -> None:
    regressions = regressions or []
    new_pairs = new_pairs or []
    (report_dir / "summary.md").write_text(
        render_summary_markdown(suite, regressions, new_pairs), encoding="utf-8"
    )
    results = {
        "comparator_available": suite.comparator_available,
        "regressions": regressions,
        "new_pairs": new_pairs,
        "pairs": [
            {
                "name": p.name,
                "source": p.source,
                "extraction_passed": p.extraction_passed,
                "extraction_failures": p.extraction_failures,
                "comparison_status": p.comparison_status,
                "comparison_error": p.comparison_error,
                "metrics": p.metrics().to_json(),
                "missed": p.score.missed if p.score else [],
                "false_positives": p.score.false_positives if p.score else [],
                "noise_leakage": p.score.noise_leakage if p.score else [],
                "evidence_issues": p.score.evidence_issues if p.score else [],
            }
            for p in suite.pairs
        ],
    }
    (report_dir / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    rows = []
    for p in suite.pairs:
        extraction = (
            "<span class='pass'>Pass</span>"
            if p.extraction_passed
            else "<span class='fail'>Fail</span><ul>"
            + "".join(f"<li>{escape(f)}</li>" for f in p.extraction_failures)
            + "</ul>"
        )
        links = " · ".join(
            f"<a href='pairs/{escape(p.name)}/{side}.extraction.html'>{side}.pdf</a>"
            for side in ("old", "new")
            if (report_dir / "pairs" / p.name / f"{side}.extraction.html").exists()
        )
        rows.append(
            f"<tr><td><strong>{escape(p.name)}</strong><br><span class='muted'>"
            f"{escape(p.description)}</span></td><td>{escape(p.source)}</td><td>{extraction}</td>"
            f"<td>{escape(_comparison_cell(p))}</td><td>{links}</td></tr>"
        )
    reg_html = (
        "<h2>Accuracy regressions</h2><ul>" + "".join(f"<li>{escape(r)}</li>" for r in regressions) + "</ul>"
        if regressions
        else ""
    )
    note = (
        ""
        if suite.comparator_available
        else "<p class='note'>Comparison scoring starts in Stage 3. This run checks extraction only.</p>"
    )
    (report_dir / "index.html").write_text(
        "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>DiffNexa golden suite</title>"
        "<style>body{font-family:system-ui,sans-serif;color:#1b2a41;margin:2rem;max-width:80rem;line-height:1.5}"
        "table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9dee5;padding:.5rem;text-align:left;"
        "vertical-align:top}th{background:#f3f5f8}.pass{color:#166534;font-weight:600}"
        ".fail{color:#b42318;font-weight:600}.muted{color:#5b6472;font-size:.9rem}"
        ".note{background:#eef3fb;border:1px solid #c6d4ec;padding:.75rem 1rem;border-radius:6px}</style></head><body>"
        f"<h1>DiffNexa golden suite</h1><p>{len(suite.pairs)} pairs · extraction failures: "
        f"{suite.extraction_failures} · comparison failures: {suite.comparison_failures} · "
        f"regressions: {len(regressions)}</p>{note}{reg_html}"
        "<table><tr><th>Pair</th><th>Source</th><th>Extraction</th><th>Comparison</th><th>Reports</th></tr>"
        + "".join(rows)
        + "</table></body></html>",
        encoding="utf-8",
    )
