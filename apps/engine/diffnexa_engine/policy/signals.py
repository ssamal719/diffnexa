"""Recognising which part of an agreement a piece of text belongs to.

Someone relying on a supplier's terms does not want to read every difference
between two versions. They want to know whether anything touched the parts that
affect them: what it costs, how they get out, who is liable, what happens to
their data.

This module answers exactly one question, deterministically:

    Does this text, or the heading above it, belong to a topic a reader watches?

What it deliberately does **not** do is judge. "This change touches cancellation
terms" is an observation about where the text sits, and it is either true or it
is not. "This change weakens your right to cancel" is a legal opinion, and this
product has no basis for one. Every signal here is of the first kind.

Three rules keep the signals honest:

* **Phrases, not words.** "fee" appears in ordinary prose; "late payment fee"
  does not. Single common words are never a signal on their own.
* **Headings count for more than body text.** A heading is the document's own
  statement about what a section covers, so a match there is stronger evidence
  than the same phrase appearing mid-sentence.
* **Every match is explainable.** A signal records the phrase that produced it,
  so a reader can see why the topic was suggested and disagree with it.

The topic list and its patterns are data, versioned together. When they change,
the version changes, so a result records the rules that produced it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from diffnexa_engine.compare.normalize import normalize

CLAUSE_SIGNALS_VERSION = "2026.09.1"


class ClauseTopic(StrEnum):
    """The parts of an agreement a reader typically watches.

    This list is deliberately about *what a clause is about*, not about whether
    it is favourable. It covers the questions people actually ask of terms:
    what it costs, how I leave, who is responsible, what happens to my data,
    what I may do, and how disputes are handled.
    """

    LIABILITY = "liability"
    WARRANTIES = "warranties"
    FEES_AND_PRICING = "fees_and_pricing"
    PAYMENT_TERMS = "payment_terms"
    REFUNDS = "refunds"
    CANCELLATION = "cancellation"
    AUTO_RENEWAL = "auto_renewal"
    DATA_RETENTION = "data_retention"
    DATA_SHARING = "data_sharing"
    PRIVACY_RIGHTS = "privacy_rights"
    LICENCE_AND_IP = "licence_and_ip"
    ACCEPTABLE_USE = "acceptable_use"
    GOVERNING_LAW = "governing_law"
    DISPUTE_RESOLUTION = "dispute_resolution"


@dataclass(frozen=True)
class TopicRules:
    """What a topic is called, and the phrases that indicate it."""

    topic: ClauseTopic
    label: str
    blurb: str
    phrases: tuple[str, ...]


# Patterns are matched against normalised, lower-cased text. They are phrases
# rather than single words, because a single word such as "fees" or "data"
# appears throughout ordinary writing and would signal everything.
TOPIC_RULES: tuple[TopicRules, ...] = (
    TopicRules(
        ClauseTopic.LIABILITY,
        "Liability",
        "Who is responsible when something goes wrong, and up to what amount.",
        (
            r"limitation of liability",
            r"limit(?:ation|ed|s)? (?:of|on) (?:our |their |its )?liability",
            r"(?:shall |will )?not be liable",
            r"no liability",
            r"liability (?:is |shall be |will be )?(?:capped|limited)",
            r"indemnif(?:y|ication|ies)",
            r"hold harmless",
            r"consequential (?:loss|damages)",
            r"(?:maximum|total|aggregate|entire) (?:aggregate )?liability",
            r"liability (?:shall|will) not exceed",
        ),
    ),
    TopicRules(
        ClauseTopic.WARRANTIES,
        "Warranties",
        "What is promised about the service, and what is expressly not promised.",
        (
            r"warrant(?:y|ies) disclaimer",
            r"disclaim(?:er|s|ed)? (?:of |all |any )?warrant",
            r"as is(?:,| and| basis)",
            r"without warrant(?:y|ies)",
            r"no warrant(?:y|ies)",
            r"fitness for a particular purpose",
            r"merchantability",
        ),
    ),
    TopicRules(
        ClauseTopic.FEES_AND_PRICING,
        "Fees and pricing",
        "What the service costs and how those costs may change.",
        (
            r"fees and (?:charges|pricing|payment)",
            r"pricing (?:terms|changes|schedule)",
            r"subscription (?:fee|price|cost)",
            r"price (?:increase|change|adjustment)",
            r"(?:change|revise|update)s? (?:our |the )?(?:prices|pricing|fees)",
            r"applicable fees",
            r"service fee",
        ),
    ),
    TopicRules(
        ClauseTopic.PAYMENT_TERMS,
        "Payment terms",
        "When payment is due, how it is taken, and what happens if it is late.",
        (
            r"payment terms",
            r"due within \d+ days",
            r"late payment",
            r"overdue (?:amount|invoice|payment)",
            r"payment method",
            r"billing (?:cycle|period|date)",
            r"invoice(?:d|s)? (?:monthly|annually|in advance)",
        ),
    ),
    TopicRules(
        ClauseTopic.REFUNDS,
        "Refunds",
        "Whether money can be returned, and on what conditions.",
        (
            r"refund(?:s|able|ed)?\b(?:[^.]{0,40}(?:polic|request|issue|eligib|entitl))",
            r"no refunds?",
            r"non-refundable",
            r"money[- ]back",
            r"refund polic",
        ),
    ),
    TopicRules(
        ClauseTopic.CANCELLATION,
        "Cancellation and termination",
        "How either side ends the agreement, and with how much notice.",
        (
            r"terminat(?:e|ion|ing) (?:this |the )?(?:agreement|contract|subscription|account)",
            r"cancel(?:lation)? (?:polic|of (?:your|the) (?:subscription|account|plan))",
            r"cancel (?:your|the) (?:subscription|account|plan|order|membership)",
            r"notice (?:period )?of (?:at least )?\d+ (?:days|months)",
            r"\d+ days(?:'|’)? (?:written )?notice",
            r"right to terminate",
            r"cancellation and termination",
            r"termination and cancellation",
            r"termination of (?:the |this |your )?(?:agreement|contract|service|subscription|account)",
            r"suspend(?:ed|s)? or terminate",
        ),
    ),
    TopicRules(
        ClauseTopic.AUTO_RENEWAL,
        "Automatic renewal",
        "Whether the agreement renews by itself, and how to stop it.",
        (
            r"automatic(?:ally)? renew",
            r"auto[- ]renew(?:al|s|ed)?",
            r"renews? (?:automatically|for (?:a )?(?:further|successive))",
            r"renewal (?:term|period|date)",
            r"unless (?:you )?cancel",
        ),
    ),
    TopicRules(
        ClauseTopic.DATA_RETENTION,
        "Data retention",
        "How long information is kept, and when it is deleted.",
        (
            r"data retention",
            r"retention (?:period|polic)",
            r"retain(?:ed|s)? (?:your |personal |such )?(?:data|information|records) for",
            r"(?:delete|erase)d? (?:your |the )?(?:data|information|account) (?:after|within)",
            r"how long we (?:keep|retain|store)",
            r"stored for (?:a period of )?\d+",
        ),
    ),
    TopicRules(
        ClauseTopic.DATA_SHARING,
        "Data sharing",
        "Who else receives the information, and where it goes.",
        (
            r"data sharing",
            r"sharing (?:of )?(?:your |personal )?(?:data|information)",
            r"share(?:d|s)? (?:your |personal |such )?(?:data|information) with",
            r"third[- ]part(?:y|ies) (?:provider|processor|service|partner|recipient)",
            r"(?:sub-?)?processors?\b",
            r"(?:international|cross[- ]border) (?:data )?transfer",
            r"transfer(?:red|s)? (?:your |personal )?data (?:to|outside)",
            r"(?:your |personal )?data (?:may |will |can )?(?:be )?transferred",
            r"disclose (?:your |personal )?(?:data|information)",
            r"sell (?:your |personal )?(?:data|information)",
        ),
    ),
    TopicRules(
        ClauseTopic.PRIVACY_RIGHTS,
        "Your data rights",
        "What you can ask for: access, correction, deletion, portability, consent.",
        (
            r"right to (?:access|erasure|rectification|portability|object)",
            r"(?:your|data subject) rights",
            r"request (?:a copy of |the deletion of )?your (?:data|personal information)",
            r"withdraw (?:your )?consent",
            r"opt[- ]out of",
            r"data protection (?:officer|authority)",
        ),
    ),
    TopicRules(
        ClauseTopic.LICENCE_AND_IP,
        "Licence and ownership",
        "What rights each side grants over content and intellectual property.",
        (
            r"licen[cs]e (?:grant|to use|is granted)",
            r"grant(?:s|ed)? (?:you |us |a )*"
            r"(?:limited |non-?exclusive |worldwide |royalty-?free |perpetual )*licen[cs]e",
            r"intellectual property (?:rights|ownership)",
            r"(?:you|we) retain (?:all )?(?:ownership|rights)",
            r"your content remains yours",
            r"user[- ]generated content",
        ),
    ),
    TopicRules(
        ClauseTopic.ACCEPTABLE_USE,
        "Acceptable use",
        "What you may and may not do, and when access can be withdrawn.",
        (
            r"acceptable use",
            r"prohibited (?:use|conduct|activities|content)",
            r"you (?:must|may) not (?:use|access|attempt)",
            r"(?:violat|breach)(?:e|es|ion) of (?:these|this|our) (?:terms|policy)",
            r"suspend (?:your )?account",
            r"fair use polic",
        ),
    ),
    TopicRules(
        ClauseTopic.GOVERNING_LAW,
        "Governing law",
        "Which country's law applies and whose courts decide.",
        (
            r"governing law",
            r"governed by the laws? of",
            r"(?:exclusive |non-?exclusive )?jurisdiction of the courts",
            r"courts? of [a-z ]{3,30} shall have",
            r"venue (?:shall be|is)",
        ),
    ),
    TopicRules(
        ClauseTopic.DISPUTE_RESOLUTION,
        "Disputes",
        "How disagreements are handled, including arbitration and class actions.",
        (
            r"dispute resolution",
            r"binding arbitration",
            r"resolved by (?:binding )?arbitration",
            r"submit(?:ted)? to (?:binding )?arbitration",
            r"referred to arbitration",
            r"arbitration (?:agreement|provision|rules|shall|will)",
            r"class action (?:waiver|lawsuit)",
            r"waive(?:s|d)? (?:any |the )?right to (?:a )?(?:jury|trial|class)",
            r"mediation",
            r"informal (?:dispute )?resolution",
        ),
    ),
)

TOPICS_BY_ID: dict[ClauseTopic, TopicRules] = {rules.topic: rules for rules in TOPIC_RULES}

_COMPILED: dict[ClauseTopic, tuple[re.Pattern[str], ...]] = {
    rules.topic: tuple(re.compile(phrase, re.IGNORECASE) for phrase in rules.phrases) for rules in TOPIC_RULES
}


class SignalSource(StrEnum):
    """Where the evidence for a topic came from."""

    HEADING = "heading"
    TEXT = "text"


@dataclass(frozen=True)
class ClauseSignal:
    """One reason to think a piece of text belongs to a topic."""

    topic: ClauseTopic
    source: SignalSource
    matched_text: str

    @property
    def label(self) -> str:
        return TOPICS_BY_ID[self.topic].label

    def describe(self) -> str:
        where = "the section heading" if self.source is SignalSource.HEADING else "the text"
        return f"{self.label}: {where} mentions {self.matched_text!r}"


def _matches_in(value: str, topic: ClauseTopic) -> str | None:
    """The first phrase of this topic found in the value, or None."""
    haystack = normalize(value).casefold()
    if not haystack:
        return None
    for pattern in _COMPILED[topic]:
        found = pattern.search(haystack)
        if found:
            return found.group(0).strip()
    return None


def signals_for(text: str, heading: str | None = None) -> tuple[ClauseSignal, ...]:
    """Every topic this text or its heading indicates, in a stable order.

    A heading match is recorded in preference to a text match for the same
    topic, because a heading is the document's own statement about what the
    section covers.
    """
    found: dict[ClauseTopic, ClauseSignal] = {}

    if heading:
        for rules in TOPIC_RULES:
            matched = _matches_in(heading, rules.topic)
            if matched:
                found[rules.topic] = ClauseSignal(rules.topic, SignalSource.HEADING, matched)

    for rules in TOPIC_RULES:
        if rules.topic in found:
            continue
        matched = _matches_in(text, rules.topic)
        if matched:
            found[rules.topic] = ClauseSignal(rules.topic, SignalSource.TEXT, matched)

    # Ordered by the topic list, so the same input always produces the same
    # sequence regardless of dictionary behaviour.
    return tuple(found[rules.topic] for rules in TOPIC_RULES if rules.topic in found)


def topics_for(text: str, heading: str | None = None) -> tuple[ClauseTopic, ...]:
    """Just the topics, for callers that do not need the evidence."""
    return tuple(signal.topic for signal in signals_for(text, heading))


def describe_topic(topic: ClauseTopic) -> str:
    return TOPICS_BY_ID[topic].label


def topic_blurb(topic: ClauseTopic) -> str:
    return TOPICS_BY_ID[topic].blurb


__all__ = [
    "CLAUSE_SIGNALS_VERSION",
    "ClauseSignal",
    "ClauseTopic",
    "SignalSource",
    "TOPICS_BY_ID",
    "TOPIC_RULES",
    "describe_topic",
    "signals_for",
    "topic_blurb",
    "topics_for",
]
