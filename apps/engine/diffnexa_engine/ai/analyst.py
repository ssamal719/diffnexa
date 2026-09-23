"""AI Change Analyst: explaining changes the deterministic comparison already proved.

    comparison result (sealed by the website)
        → facts (adapters.py): the changes, their IDs, evidence and classifications
        → selection and batches (here): deterministic, stated, never silent
        → prompt (prompt.py) → provider (providers.py)
        → validation (validate.py): only grounded statements survive
        → the analysis below: comparison facts and AI text side by side, labelled

The analyst never creates, alters or removes a change. It reads facts and
returns text keyed by the IDs the comparison gave. The comparison result itself
is not modified — the website keeps showing it exactly as it was.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from diffnexa_engine.ai.config import AIConfig
from diffnexa_engine.ai.errors import AIAnalysisError, AIErrorCode
from diffnexa_engine.ai.facts import AnalysisFacts, ChangeFacts
from diffnexa_engine.ai.prompt import build_prompt, change_record
from diffnexa_engine.ai.providers import AIAnalysisProvider, ProviderError, ProviderRequest
from diffnexa_engine.ai.validate import ChangeExplanation, InvalidReply, SummarySentence, validate_reply

#: Counts and timings only. Never a prompt, a reply, a value or an excerpt.
log = logging.getLogger("diffnexa.ai")

#: Rough cap on the facts sent in one call, so one batch cannot become enormous.
MAX_BATCH_CHARS = 60_000
MAX_SUMMARY_SENTENCES = 6

LIMITATION = (
    "AI Change Analyst explains changes detected by DiffNexa's deterministic comparison. It does "
    "not independently verify facts, determine legal meaning, or replace professional review."
)

#: Categories whose changes are explained first when not every change can be.
_FIRST = {"number", "date", "identifier", "price", "formula", "link", "table", "page", "layout"}


class DailyBudget:
    """How many analyses this engine will run per UTC day, for everyone together.

    Held in memory: it resets when the engine restarts. It is a cost ceiling on
    top of the website's per-visitor limits, not an accounting system.
    """

    def __init__(self, limit: int, today: Callable[[], str] | None = None) -> None:
        self.limit = limit
        self._today = today or (lambda: datetime.now(UTC).date().isoformat())
        self._day = ""
        self._used = 0
        self._lock = threading.Lock()

    def take(self) -> bool:
        with self._lock:
            day = self._today()
            if day != self._day:
                self._day, self._used = day, 0
            if self._used >= self.limit:
                return False
            self._used += 1
            return True


@dataclass
class _BatchResult:
    batch: list[ChangeFacts]
    summary: list[SummarySentence] = field(default_factory=list)
    explanations: list[ChangeExplanation] = field(default_factory=list)
    withheld: dict[str, int] = field(default_factory=dict)
    failure: str | None = None  # timeout | failure | truncated | refused | invalid:<reason>
    input_tokens: int = 0
    output_tokens: int = 0


def select_changes(facts: AnalysisFacts, limit: int) -> tuple[list[ChangeFacts], bool]:
    """The changes to explain, in reading order, and whether a selection was needed.

    When there are more than `limit`, the choice is deterministic and stated:
    changes carrying a classification, and changes to numbers, dates, links,
    tables, formulas and structure, come first; then the rest in reading order.
    """
    eligible = list(facts.eligible)
    if len(eligible) <= limit:
        return eligible, False

    def priority(change: ChangeFacts) -> tuple[int, int]:
        first = bool(change.signals) or change.category in _FIRST
        return (0 if first else 1, change.order)

    chosen = sorted(eligible, key=priority)[:limit]
    return sorted(chosen, key=lambda change: change.order), True


def make_batches(changes: list[ChangeFacts], size: int) -> list[list[ChangeFacts]]:
    batches: list[list[ChangeFacts]] = []
    current: list[ChangeFacts] = []
    chars = 0
    for change in changes:
        cost = len(str(change_record(change)))
        if current and (len(current) >= size or chars + cost > MAX_BATCH_CHARS):
            batches.append(current)
            current, chars = [], 0
        current.append(change)
        chars += cost
    if current:
        batches.append(current)
    return batches


def _run_batch(
    facts: AnalysisFacts,
    batch: list[ChangeFacts],
    part: int,
    parts: int,
    provider: AIAnalysisProvider,
    config: AIConfig,
) -> _BatchResult:
    outcome = _BatchResult(batch=batch)
    prompt = build_prompt(facts, batch, part=part, parts=parts)
    request = ProviderRequest(
        system=prompt.system,
        user=prompt.user,
        max_output_tokens=config.max_output_tokens,
        timeout_seconds=config.timeout_seconds,
    )
    try:
        reply = provider.analyze(request)
    except ProviderError as error:
        outcome.failure = error.kind
        return outcome
    except Exception:  # noqa: BLE001 - a provider bug must never break the request
        outcome.failure = "failure"
        return outcome
    outcome.input_tokens = reply.input_tokens or 0
    outcome.output_tokens = reply.output_tokens or 0
    try:
        validated = validate_reply(
            reply.text,
            batch,
            total_changes=facts.total_changes,
            eligible_changes=len(facts.eligible),
        )
    except InvalidReply as error:
        outcome.failure = f"invalid:{error.reason}"
        return outcome
    outcome.summary = validated.summary
    outcome.explanations = validated.explanations
    outcome.withheld = validated.withheld
    return outcome


def _comparison_view(change: ChangeFacts) -> dict[str, Any]:
    """What the comparison says about a change, shown beside the AI text and labelled as such."""
    return {
        "type": change.type_label,
        "kind": change.kind,
        "category": change.category,
        "location": change.location,
        "original": change.original,
        "revised": change.revised,
        "difference": change.delta,
        "signals": list(change.signals),
        "details": list(change.details),
        "evidence": [
            {"ref": item.ref, "side": item.side, "location": item.location, "excerpt": item.excerpt}
            for item in change.evidence
        ],
    }


def _failure_code(failures: list[str]) -> AIErrorCode:
    if all(item == "timeout" for item in failures):
        return AIErrorCode.TIMEOUT
    if any(item.startswith("invalid:") for item in failures):
        return AIErrorCode.INVALID
    return AIErrorCode.FAILED


def analyze_facts(
    facts: AnalysisFacts,
    provider: AIAnalysisProvider,
    config: AIConfig,
    *,
    engine_version: str,
) -> dict[str, Any]:
    """Explain the facts, or raise AIAnalysisError when nothing can be shown.

    A comparison with no changes, or only changes the comparison classed as
    noise, is answered without calling any provider.
    """
    started = time.perf_counter()
    eligible = facts.eligible
    noise = facts.total_changes - len(eligible)
    base: dict[str, Any] = {
        "engineVersion": engine_version,
        "tool": facts.tool,
        "provider": {"name": provider.name, "model": provider.model},
        "unchanged": list(facts.unchanged),
        "limitations": [LIMITATION, *facts.tool_notes],
    }

    if not eligible:
        base.update(
            status="nothing_to_explain",
            coverage={
                "totalChanges": facts.total_changes,
                "excludedNoise": noise,
                "eligible": 0,
                "analyzed": 0,
                "notAnalyzedIds": [],
                "prioritised": False,
            },
            summary=[],
            changes=[],
            references={},
            withheld={"statements": 0, "reasons": {}},
            usage={"providerCalls": 0, "inputTokens": 0, "outputTokens": 0, "ms": 0},
        )
        return base

    chosen, prioritised = select_changes(facts, config.max_changes)
    batches = make_batches(chosen, config.batch_size)
    workers = min(len(batches), 3)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_run_batch, facts, batch, index, len(batches), provider, config)
            for index, batch in enumerate(batches, start=1)
        ]
        results = [future.result() for future in futures]

    failures = [result.failure for result in results if result.failure]
    succeeded = [result for result in results if not result.failure]
    elapsed = int((time.perf_counter() - started) * 1000)
    input_tokens = sum(result.input_tokens for result in results)
    output_tokens = sum(result.output_tokens for result in results)

    log.info(
        "ai analysis tool=%s changes=%d eligible=%d chosen=%d batches=%d failed=%d "
        "input_tokens=%d output_tokens=%d ms=%d",
        facts.tool,
        facts.total_changes,
        len(eligible),
        len(chosen),
        len(batches),
        len(failures),
        input_tokens,
        output_tokens,
        elapsed,
    )

    if not succeeded:
        raise AIAnalysisError(_failure_code([item for item in failures if item]), ",".join(failures))

    explained: dict[str, ChangeExplanation] = {}
    summary: list[SummarySentence] = []
    withheld: dict[str, int] = {}
    for result in succeeded:
        for item in result.explanations:
            explained[item.change_id] = item
        summary.extend(result.summary)
        for reason, count in result.withheld.items():
            withheld[reason] = withheld.get(reason, 0) + count

    if not explained and not summary:
        # Every statement failed its check: nothing grounded is left to show.
        raise AIAnalysisError(AIErrorCode.INVALID, "every statement was withheld")

    by_id = {change.id: change for change in facts.changes}
    items = []
    for change in sorted((by_id[cid] for cid in explained), key=lambda item: item.order):
        explanation = explained[change.id]
        items.append(
            {
                "changeId": change.id,
                "comparison": _comparison_view(change),
                "analysis": {
                    "significance": explanation.significance,
                    "explanation": explanation.explanation,
                    "whyItMayMatter": explanation.why_it_may_matter,
                    "evidenceRefs": list(dict.fromkeys(explanation.evidence_refs)),
                },
            }
        )

    shown_summary = summary[:MAX_SUMMARY_SENTENCES]
    cited = {cid for sentence in shown_summary for cid in sentence.change_ids} | set(explained)
    references = {
        change.id: {"type": change.type_label, "location": change.location}
        for change in facts.changes
        if change.id in cited
    }
    not_analyzed = [change.id for change in eligible if change.id not in explained]
    base.update(
        status="complete" if not not_analyzed and not failures else "partial",
        coverage={
            "totalChanges": facts.total_changes,
            "excludedNoise": noise,
            "eligible": len(eligible),
            "analyzed": len(explained),
            "notAnalyzedIds": not_analyzed,
            "prioritised": prioritised,
        },
        summary=[
            {"text": sentence.text, "changeIds": list(dict.fromkeys(sentence.change_ids))}
            for sentence in shown_summary
        ],
        changes=items,
        # How the comparison names every change cited above, for "View change" links.
        references=references,
        withheld={"statements": sum(withheld.values()), "reasons": withheld},
        usage={
            "providerCalls": len(batches),
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "ms": elapsed,
        },
    )
    return base


__all__ = [
    "LIMITATION",
    "MAX_BATCH_CHARS",
    "DailyBudget",
    "analyze_facts",
    "make_batches",
    "select_changes",
]
