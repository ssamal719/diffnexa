"""The accuracy ratchet.

golden/baseline.json records the last accepted score for every pair. A run that
makes any pair worse fails. The baseline can only be moved with an explicit
written reason, which is appended to golden/BASELINE_CHANGES.md.

Regressions:
    * extraction checks passed before and fail now
    * comparison recall went down
    * false positives or noise leakage went up
    * evidence completeness went down
    * a pair that was scored is no longer scored
    * a pair in the baseline disappeared from the suite
New pairs are reported but are not regressions.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

BASELINE_VERSION = 1


@dataclass(frozen=True)
class PairMetrics:
    extraction_passed: bool
    comparison: dict[str, float] | None  # None until a comparator exists

    def to_json(self) -> dict[str, Any]:
        return {"extraction_passed": self.extraction_passed, "comparison": self.comparison}

    @staticmethod
    def from_json(data: dict[str, Any]) -> PairMetrics:
        return PairMetrics(bool(data["extraction_passed"]), data.get("comparison"))


def load_baseline(path: Path) -> dict[str, PairMetrics]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != BASELINE_VERSION:
        raise ValueError(f"{path}: unsupported baseline version {data.get('version')!r}")
    return {name: PairMetrics.from_json(m) for name, m in data.get("pairs", {}).items()}


def find_regressions(
    baseline: dict[str, PairMetrics], current: dict[str, PairMetrics]
) -> tuple[list[str], list[str]]:
    """Return (regressions, new_pairs)."""
    regressions: list[str] = []
    for name, before in sorted(baseline.items()):
        now = current.get(name)
        if now is None:
            regressions.append(f"{name}: pair is in the baseline but no longer in the suite")
            continue
        if before.extraction_passed and not now.extraction_passed:
            regressions.append(f"{name}: extraction checks used to pass and now fail")
        b, n = before.comparison, now.comparison
        if b is None:
            continue
        if n is None:
            regressions.append(f"{name}: comparison was scored before and is not scored now")
            continue
        if n["recall"] < b["recall"]:
            regressions.append(f"{name}: recall fell from {b['recall']:.3f} to {n['recall']:.3f}")
        if n["false_positives"] > b["false_positives"]:
            regressions.append(
                f"{name}: false positives rose from {b['false_positives']:g} to {n['false_positives']:g}"
            )
        if n["noise_leakage"] > b["noise_leakage"]:
            regressions.append(
                f"{name}: noise leakage rose from {b['noise_leakage']:g} to {n['noise_leakage']:g}"
            )
        if n["evidence_completeness"] < b["evidence_completeness"]:
            regressions.append(
                f"{name}: evidence completeness fell from {b['evidence_completeness']:.3f} "
                f"to {n['evidence_completeness']:.3f}"
            )
    new_pairs = sorted(set(current) - set(baseline))
    return regressions, new_pairs


def write_baseline(path: Path, current: dict[str, PairMetrics], reason: str, log_path: Path) -> None:
    reason = reason.strip()
    if len(reason) < 10:
        raise ValueError("a baseline update needs a written reason of at least 10 characters")
    payload = {
        "version": BASELINE_VERSION,
        "pairs": {name: current[name].to_json() for name in sorted(current)},
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if not log_path.exists():
        log_path.write_text(
            "# Golden baseline changes\n\nEvery change to golden/baseline.json, with its reason.\n",
            encoding="utf-8",
        )
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n## {date.today().isoformat()}\n\n{reason}\n")
