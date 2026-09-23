"""The AI Change Analyst golden corpus, and the shared wording of its errors.

Every case in golden/ai-cases must pass: grounded explanations shown, ungrounded
statements withheld, invented changes refused, failures contained. The corpus
must keep covering each situation the product promises to handle.
"""

from __future__ import annotations

import json

import pytest

from diffnexa_engine.ai.errors import AI_MESSAGES, AIErrorCode
from diffnexa_engine.golden.ai_cases import discover_ai_cases, displayed_text, run_case, score_ai_case

from .helpers.ai_results import REPO

CASES = discover_ai_cases(REPO / "golden" / "ai-cases")
BY_NAME = {case.name: case for case in CASES}

#: The situations the corpus must always include (the V1 brief's list).
REQUIRED = {
    "no-changes": "no changes",
    "one-wording-change": "one wording change",
    "multiple-wording-changes": "multiple wording changes",
    "numeric-change": "numeric change",
    "date-change": "date change",
    "added-content": "added content",
    "removed-content": "removed content",
    "policy-topic-change": "policy topic change",
    "price-change": "price change",
    "link-change": "link change",
    "table-change": "table change",
    "excel-value-change": "Excel value change",
    "excel-formula-change": "Excel formula change",
    "docx-change": "DOCX change",
    "multiple-simultaneous-changes": "multiple simultaneous changes",
    "large-change-set": "large change set",
    "empty-comparison": "empty comparison",
    "provider-failure": "AI provider failure",
    "invalid-json": "invalid AI JSON",
    "hallucinated-change": "AI hallucination attempt",
    "prompt-injection-verdict": "prompt injection in document text",
}


def test_the_corpus_covers_every_required_situation():
    assert set(REQUIRED) <= set(BY_NAME)
    assert len(CASES) >= 30


def test_the_corpus_covers_every_tool():
    assert {case.spec.tool for case in CASES} == {
        "pdf",
        "web",
        "policy",
        "competitor",
        "price",
        "docx",
        "excel",
    }


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
def test_every_golden_case_passes(case):
    score, _analysis = score_ai_case(case, REPO)
    assert score.passed, (score.missed, score.false_positives, score.noise_leakage, score.evidence_issues)
    assert score.evidence_completeness == 1.0


def test_an_invented_change_id_never_reaches_the_reader():
    for name in ("hallucinated-change", "prompt-injection-new-change"):
        analysis, error, _provider, _facts = run_case(BY_NAME[name], REPO)
        assert analysis is None and error == "ai_invalid"


def test_ungrounded_statements_are_withheld_and_counted():
    expected = {
        "invented-figure": {"unverified_number": 1},
        "invented-quotation": {"unverified_quotation": 1},
        "invalid-evidence-reference": {"invalid_evidence_reference": 1},
        "internal-id-shown": {"shows_internal_id": 1},
        "policy-topic-change": {"unsupported_judgement": 1},
        "price-change": {"unsupported_judgement": 1},
        "competitor-change": {"unsupported_judgement": 1},
        "prompt-injection-verdict": {"unsupported_judgement": 1, "unverified_number": 1},
    }
    for name, reasons in expected.items():
        analysis, _error, _provider, _facts = run_case(BY_NAME[name], REPO)
        assert analysis["withheld"]["reasons"] == reasons, name
        text = displayed_text(analysis).lower()
        for phrase in BY_NAME[name].spec.expect.must_not_display:
            assert phrase.lower() not in text


def test_the_same_case_always_gives_the_same_analysis():
    for name in ("numeric-change", "large-change-set", "price-change"):
        first, _, _, _ = run_case(BY_NAME[name], REPO)
        second, _, _, _ = run_case(BY_NAME[name], REPO)
        first["usage"].pop("ms"), second["usage"].pop("ms")
        assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_ai_error_wording_matches_the_shared_contract():
    contract = json.loads((REPO / "packages" / "contracts" / "errors.json").read_text(encoding="utf-8"))
    assert contract["ai_messages"] == {code.value: message for code, message in AI_MESSAGES.items()}
    assert (
        AI_MESSAGES[AIErrorCode.INVALID]
        == "AI analysis could not be validated against the comparison evidence."
    )
