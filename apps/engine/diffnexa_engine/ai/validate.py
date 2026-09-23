"""The deterministic check every AI reply must pass before anyone sees it.

The model is asked for a strict JSON object. This module decides, without any
AI, what of that reply may be shown:

1. The reply must be one JSON object of the agreed shape. Anything else — prose,
   a truncated object, the wrong types — and the whole reply is refused.
2. Every statement must cite changes by ID, and every cited ID must be one of
   the changes that were actually sent in this request. A reply that cites a
   change that does not exist has invented a change; the whole reply is
   refused, because nothing else in it can be trusted either.
3. Each explanation must cite at least one evidence reference, and each must
   belong to the change it explains.
4. What the statement says must be traceable to the cited facts:
   - every number in it appears in those facts (or is the plain difference
     between two numbers the facts state);
   - every quotation in it appears in those facts;
   - it makes no legal, financial, safety or motive judgement, no ranking and
     no recommendation of its own (such words may appear only inside a
     quotation of the documents, verified word for word);
   - it does not show internal change IDs to the reader.
   A statement that fails is withheld (not shown) and counted, and the rest of
   the reply is kept.

These checks are a safety net under a carefully instructed model, not a proof
of meaning. They make the failures that matter most — an invented change, an
invented figure, an invented quotation, a legal verdict — impossible to show.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from diffnexa_engine.ai.facts import ChangeFacts

Significance = Literal["important", "notable", "minor", "unclear"]


class _Reply(BaseModel):
    # Unknown keys are ignored rather than trusted: nothing outside this shape
    # is ever read, so nothing outside it can reach the reader.
    model_config = ConfigDict(extra="ignore", frozen=True)


class SummarySentence(_Reply):
    text: str = Field(min_length=1, max_length=500)
    change_ids: tuple[str, ...] = Field(min_length=1, max_length=40)


class ChangeExplanation(_Reply):
    change_id: str = Field(min_length=1, max_length=64)
    significance: Significance
    explanation: str = Field(min_length=1, max_length=800)
    why_it_may_matter: str = Field(min_length=1, max_length=500)
    evidence_refs: tuple[str, ...] = Field(default=(), max_length=20)


class AnalystReply(_Reply):
    summary: tuple[SummarySentence, ...] = Field(default=(), max_length=8)
    changes: tuple[ChangeExplanation, ...] = Field(default=(), max_length=100)


class InvalidReply(Exception):
    """The whole reply is refused. `reason` is a short code, never reply text."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class ValidatedBatch:
    summary: list[SummarySentence] = field(default_factory=list)
    explanations: list[ChangeExplanation] = field(default_factory=list)
    #: Why statements were withheld: reason code -> count.
    withheld: dict[str, int] = field(default_factory=dict)

    def withhold(self, reason: str) -> None:
        self.withheld[reason] = self.withheld.get(reason, 0) + 1


# ---------------------------------------------------------------- parsing


_FENCE = re.compile(r"^\s*```(?:json)?\s*\n(.*)\n\s*```\s*$", re.DOTALL)


def parse_reply(text: str) -> AnalystReply:
    """The reply as the agreed object, or InvalidReply."""
    fenced = _FENCE.match(text)
    body = fenced.group(1) if fenced else text
    try:
        data = json.loads(body)
    except (ValueError, RecursionError):
        raise InvalidReply("not_json") from None
    if not isinstance(data, dict):
        raise InvalidReply("not_an_object")
    try:
        return AnalystReply.model_validate(data)
    except ValidationError:
        raise InvalidReply("wrong_shape") from None


# ---------------------------------------------------------------- grounding material


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def material_of(changes: list[ChangeFacts]) -> str:
    """Everything the comparison states about these changes, as one searchable text."""
    parts: list[str] = []
    for change in changes:
        parts += [change.type_label, change.category, change.location]
        parts += [value for value in (change.label, change.original, change.revised, change.delta) if value]
        parts += list(change.signals) + list(change.details)
        for item in change.evidence:
            parts.append(item.location)
            if item.excerpt:
                parts.append(item.excerpt)
    return normalise(" \n ".join(parts))


_NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[Decimal]:
    found: set[Decimal] = set()
    for match in _NUMBER.finditer(text):
        raw = match.group(0).rstrip(",").replace(",", "")
        try:
            found.add(Decimal(raw).normalize())
        except InvalidOperation:
            continue
    return found


def allowed_numbers(changes: list[ChangeFacts], extra: set[int] | None = None) -> set[Decimal]:
    """Numbers a statement about these changes may use.

    Those the facts state, plus the plain difference between an original and a
    revised number of the same change ("from ₹2,000 to ₹2,520" allows 520).
    """
    allowed = _numbers(material_of(changes))
    for change in changes:
        before = sorted(_numbers(normalise(change.original or "")))[:25]
        after = sorted(_numbers(normalise(change.revised or "")))[:25]
        for a in before:
            for b in after:
                allowed.add(abs(b - a).normalize())
    allowed |= {Decimal(value) for value in (extra or set())}
    return allowed


_QUOTED = re.compile(r'"([^"]{3,300})"')

#: Judgements AI Change Analyst may never make on its own authority.
_JUDGEMENTS = [
    r"risk score",
    r"\b\d{1,3}\s*/\s*100\b",
    r"\b(?:high|low|medium)[- ]risk\b",
    r"\blegal risk\b",
    r"\blegally (?:risky|binding|unfavou?rable|invalid|valid|enforceable)\b",
    r"\b(?:un)?enforceable\b",
    r"\bviolat(?:e|es|ed|ing|ion|ions)\b",
    r"\b(?:illegal|unlawful|non-?compliant|non-?compliance)\b",
    r"\bin breach\b",
    r"\bunfair\b",
    r"\b(?:unfavou?rable|disadvantageous)\b",
    r"\bweakens? (?:your|their|the user'?s?|customers'?) rights\b",
    r"\b(?:dangerous|harmful|malicious|fraud(?:ulent)?|scam)\b",
    r"\b(?:better|worse|good|bad|great|poor) (?:deal|price|value|offer|choice|option|pricing)\b",
    r"\bbest (?:price|deal|value|option)\b",
    r"\bbuy (?:this|it|now)\b",
    r"\b(?:you|users?|customers?|applicants?|readers?|we) should\b",
    r"\bshould (?:accept|reject|sign|buy|avoid|switch|not)\b",
    r"\b(?:we|i) (?:would )?recommend\b",
    r"\brecommend(?:s|ed)? (?:that|you)\b",
    r"\b(?:our|my) recommendation\b",
    r"\bprobably (?:because|to|wants?|intends?)\b",
    r"\b(?:company|employer|competitor|vendor|author|organi[sz]ation|business)(?:'s)? "
    r"(?:wants?|intends?|is trying|are trying|plans? to|aims? to|hopes? to)\b",
    r"\bin order to (?:attract|increase|boost|hide|mislead|maximi[sz]e)\b",
    r"\bbecoming (?:more|less) (?:expensive|competitive)\b",
    r"\b(?:market (?:leader|winner)|outperform\w*|beats? (?:the )?competition)\b",
    r"\bwill (?:increase|decrease|reduce|boost|raise|lower) (?:revenue|profits?|sales|costs?|income)\b",
]
_JUDGEMENT = re.compile("|".join(f"(?:{pattern})" for pattern in _JUDGEMENTS))


def _mentions(identifier: str, text: str) -> bool:
    return re.search(rf"(?<![\w.-]){re.escape(identifier.lower())}(?![\w-])", text) is not None


def statement_problem(text: str, material: str, numbers: set[Decimal], hidden_ids: set[str]) -> str | None:
    """Why this statement may not be shown, or None if it may.

    A judgement word ("illegal", "risk score") may appear only inside a quotation
    verified word for word against the documents: "The added text says
    "this clause is illegal"" reports the document; "This clause is illegal"
    would be the analyst's own verdict, and a document cannot license it — not
    even by containing an instruction to say it.
    """
    plain = normalise(text)
    for identifier in hidden_ids:
        if _mentions(identifier, plain) and not _mentions(identifier, material):
            return "shows_internal_id"
    quotes: list[tuple[int, int]] = []
    for match in _QUOTED.finditer(plain):
        if normalise(match.group(1)) not in material:
            return "unverified_quotation"
        quotes.append((match.start(), match.end()))
    if not _numbers(plain) <= numbers:
        return "unverified_number"
    for match in _JUDGEMENT.finditer(plain):
        if not any(start <= match.start() and match.end() <= end for start, end in quotes):
            return "unsupported_judgement"
    return None


# ---------------------------------------------------------------- the reply as a whole


def validate_reply(
    text: str, batch: list[ChangeFacts], *, total_changes: int, eligible_changes: int
) -> ValidatedBatch:
    """What of this reply may be shown for this batch of changes.

    Raises InvalidReply when the reply as a whole cannot be trusted.
    """
    reply = parse_reply(text)
    by_id = {change.id: change for change in batch}
    cited = {cid for sentence in reply.summary for cid in sentence.change_ids}
    cited |= {item.change_id for item in reply.changes}
    if cited - set(by_id):
        raise InvalidReply("unknown_change_id")

    refs = {item.ref for change in batch for item in change.evidence}
    hidden = set(by_id) | refs
    counts = {total_changes, eligible_changes, len(batch)}
    outcome = ValidatedBatch()

    for sentence in reply.summary:
        changes = [by_id[cid] for cid in dict.fromkeys(sentence.change_ids)]
        problem = statement_problem(
            sentence.text, material_of(changes), allowed_numbers(changes, counts), hidden
        )
        if problem:
            outcome.withhold(problem)
        else:
            outcome.summary.append(sentence)

    seen: set[str] = set()
    for item in reply.changes:
        if item.change_id in seen:
            outcome.withhold("duplicate_explanation")
            continue
        seen.add(item.change_id)
        change = by_id[item.change_id]
        own_refs = {evidence.ref for evidence in change.evidence}
        if not item.evidence_refs:
            outcome.withhold("missing_evidence_reference")
            continue
        if not set(item.evidence_refs) <= own_refs:
            outcome.withhold("invalid_evidence_reference")
            continue
        material = material_of([change])
        numbers = allowed_numbers([change], counts)
        problem = statement_problem(item.explanation, material, numbers, hidden) or statement_problem(
            item.why_it_may_matter, material, numbers, hidden
        )
        if problem:
            outcome.withhold(problem)
            continue
        outcome.explanations.append(item)
    return outcome


__all__ = [
    "AnalystReply",
    "ChangeExplanation",
    "InvalidReply",
    "Significance",
    "SummarySentence",
    "ValidatedBatch",
    "allowed_numbers",
    "material_of",
    "normalise",
    "parse_reply",
    "statement_problem",
    "validate_reply",
]
