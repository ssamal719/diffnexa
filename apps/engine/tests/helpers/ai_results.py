"""Real comparison results, exactly as each tool publishes them, for AI Change Analyst tests.

Every result here comes from running the deterministic engine on a golden pair
and serialising it with the same function the service uses, so the AI layer is
tested against the JSON the website really receives — never a hand-made imitation.
"""

from __future__ import annotations

import functools
import tempfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
GOLDEN = REPO / "golden"


def _web_family(kind: str, name: str) -> dict[str, Any]:
    from diffnexa_engine.web.api import serialize_web_comparison
    from diffnexa_engine.web.compare import compare_snapshots_verbose

    if kind == "web":
        from diffnexa_engine.golden.web import discover_web_pairs, score_web_pair

        pair = next(p for p in discover_web_pairs(GOLDEN / "web-pairs") if p.name == name)
        _score, before, after = score_web_pair(pair)
        return serialize_web_comparison(compare_snapshots_verbose(before, after), 0)

    module = {
        "policy": ("diffnexa_engine.golden.policy", "discover_policy_pairs", "score_policy_pair"),
        "competitor": (
            "diffnexa_engine.golden.competitor",
            "discover_competitor_pairs",
            "score_competitor_pair",
        ),
        "price": ("diffnexa_engine.golden.price", "discover_price_pairs", "score_price_pair"),
    }[kind]
    import importlib

    golden = importlib.import_module(module[0])
    pair = next(p for p in getattr(golden, module[1])(GOLDEN / f"{kind}-pairs") if p.name == name)
    _score, before, after, _ = getattr(golden, module[2])(pair)
    outcome = compare_snapshots_verbose(before, after)
    if kind == "policy":
        from diffnexa_engine.policy.api import serialize_policy_comparison
        from diffnexa_engine.policy.classify import classify_changes

        classification = classify_changes(
            outcome.result.changes, current_snapshot=after, baseline_snapshot=before
        )
        return serialize_policy_comparison(outcome, classification, 0)
    if kind == "competitor":
        from diffnexa_engine.competitor.api import serialize_competitor_comparison
        from diffnexa_engine.competitor.classify import classify_changes

        classification = classify_changes(
            outcome.result.changes, current_snapshot=after, baseline_snapshot=before
        )
        return serialize_competitor_comparison(outcome, classification, 0)
    from diffnexa_engine.price.api import serialize_price_comparison
    from diffnexa_engine.price.classify import classify_changes

    classification = classify_changes(
        outcome.result.changes, current_snapshot=after, baseline_snapshot=before
    )
    return serialize_price_comparison(outcome, classification, 0)


def _docx(name: str) -> dict[str, Any]:
    from diffnexa_engine.docx.api import serialize_docx_comparison
    from diffnexa_engine.docx.compare import compare_docx
    from diffnexa_engine.docx.extract import extract_docx

    folder = GOLDEN / "docx-pairs" / name
    before = extract_docx((folder / "before.docx").read_bytes())
    after = extract_docx((folder / "after.docx").read_bytes())
    return serialize_docx_comparison(compare_docx(before, after), 0)


def _excel(name: str) -> dict[str, Any]:
    from diffnexa_engine.xlsx.api import serialize_excel_comparison
    from diffnexa_engine.xlsx.compare import compare_xlsx
    from diffnexa_engine.xlsx.extract import extract_xlsx

    folder = GOLDEN / "excel-pairs" / name
    before = extract_xlsx((folder / "before.xlsx").read_bytes())
    after = extract_xlsx((folder / "after.xlsx").read_bytes())
    return serialize_excel_comparison(compare_xlsx(before, after), 0)


@functools.cache
def _synthetic_pdfs() -> Path:
    from diffnexa_engine.golden.synthetic import generate_synthetic_pairs

    folder = Path(tempfile.mkdtemp(prefix="diffnexa-ai-pdf-"))
    generate_synthetic_pairs(folder)
    return folder


def _pdf(name: str) -> dict[str, Any]:
    from diffnexa_engine.adapters.pdf.extract import extract_file
    from diffnexa_engine.compare import compare_documents_verbose
    from diffnexa_engine.golden.loader import discover_pairs
    from diffnexa_engine.service.app import serialize_outcome

    pair = next(p for p in discover_pairs(_synthetic_pdfs()) if p.name == name)
    outcome = compare_documents_verbose(extract_file(str(pair.old_pdf)), extract_file(str(pair.new_pdf)))
    return serialize_outcome(outcome, 0)


@functools.cache
def _cached(tool: str, name: str) -> str:
    import json

    if tool == "pdf":
        result = _pdf(name)
    elif tool == "docx":
        result = _docx(name)
    elif tool == "excel":
        result = _excel(name)
    else:
        result = _web_family(tool, name)
    return json.dumps(result, ensure_ascii=False)


def published_result(tool: str, name: str) -> dict[str, Any]:
    """A fresh copy of the tool's published result for one golden pair."""
    import json

    return json.loads(_cached(tool, name))
