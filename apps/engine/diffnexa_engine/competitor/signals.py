"""The signal categories a competitor's webpage change can belong to.

Someone watching a competitor's pricing or product page wants to know, at a
glance, whether the change was to a price, a plan, a feature, a button or just
ordinary wording. This module holds the fixed vocabulary for that answer and the
deterministic patterns that recognise it.

What it deliberately does **not** do is interpret. "Touches Pricing &
Commercial" is an observation about where a change sits, and it is either true
or it is not. Whether the change is a threat, an opportunity or a strategic
move is a judgement about a competitor's intent, and nothing here has any basis
for one. No word in this module ranks, scores or characterises a change.

Three rules keep the signals honest:

* **Structure first.** Plans, features and the page's main message are
  recognised from the page's own headings, tables and links, not by guessing
  what a sentence means.
* **Phrases, not words.** A single common word is never a signal on its own
  where a phrase is available: "billed annually", not "annual".
* **Every signal is explainable.** Each one records the exact text that
  produced it, so a reader can see why it was suggested and disagree.

The categories and patterns are data, versioned together. When they change, the
version changes, so a result records the rules that produced it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.compare.values import CURRENCY_SYMBOLS, CURRENCY_WORDS

COMPETITOR_SIGNALS_VERSION = "2026.09.1"


class CompetitorSignal(StrEnum):
    """The nine places a change on a competitor's page can sit.

    The order is the order a reader sees them in. Every change gets exactly
    one, and a change that fits none of the first eight is `OTHER` — an honest
    "not recognised", never a guess.
    """

    PRICING = "pricing_commercial"
    FEATURES = "product_features"
    MESSAGING = "messaging_positioning"
    PLANS = "plans_packaging"
    CTA = "calls_to_action"
    CONTENT = "content_sections"
    LINKS = "links_destinations"
    SEO = "seo_metadata"
    OTHER = "other"


class SignalBasis(StrEnum):
    """What kind of evidence produced a signal. Shown to the reader as the reason."""

    METADATA_FIELD = "metadata_field"  # the page title, description or canonical link
    LINK_TEXT = "link_text"  # a link whose words are a call to action
    MONEY_VALUE = "money_value"  # a changed value that is an amount of money
    PRICING_WORDING = "pricing_wording"  # pricing words in or right beside the change
    PRICE_COLUMN = "price_column"  # a table cell under a price heading
    MAIN_HEADING = "main_heading"  # the page's main heading itself
    INTRO = "intro"  # the opening text directly under the main heading
    HEADING_TEXT = "heading_text"  # a changed heading whose own words name the category
    SECTION_HEADING = "section_heading"  # the heading of the section the change sits in
    TABLE_HEADER = "table_header"  # a table column or row named for plans
    CHANGED_WORDING = "changed_wording"  # the changed words themselves name a feature
    LINK = "link"  # an ordinary link
    SECTION = "section"  # ordinary content in a named section of the page
    NONE = "none"  # nothing recognised


@dataclass(frozen=True)
class SignalRules:
    signal: CompetitorSignal
    label: str
    blurb: str


# Labels and blurbs describe what a category covers. None says whether a change
# in it is good, bad, important or aggressive: that is not something a page
# comparison can know.
SIGNAL_RULES: tuple[SignalRules, ...] = (
    SignalRules(
        CompetitorSignal.PRICING,
        "Pricing & Commercial",
        "Prices, amounts of money, billing periods, trials and other commercial wording.",
    ),
    SignalRules(
        CompetitorSignal.FEATURES,
        "Product & Features",
        "Content in sections the page itself calls features, integrations, products or what's new.",
    ),
    SignalRules(
        CompetitorSignal.MESSAGING,
        "Messaging & Positioning",
        "The page's main heading and the opening text directly beneath it.",
    ),
    SignalRules(
        CompetitorSignal.PLANS,
        "Plans & Packaging",
        "Plans and tiers named in the page's headings and tables, and what is listed under them.",
    ),
    SignalRules(
        CompetitorSignal.CTA,
        "Calls to Action",
        "Links whose words ask the visitor to act, such as Start free, Sign up or Book a demo.",
    ),
    SignalRules(
        CompetitorSignal.CONTENT,
        "Content & Sections",
        "Other headings and wording in the named sections of the page.",
    ),
    SignalRules(
        CompetitorSignal.LINKS,
        "Links & Destinations",
        "Links that were added, removed or now point somewhere else.",
    ),
    SignalRules(
        CompetitorSignal.SEO,
        "SEO & Metadata",
        "The page title, meta description and canonical link that search engines read.",
    ),
    SignalRules(
        CompetitorSignal.OTHER,
        "Other",
        "Changes that none of the categories above clearly describes.",
    ),
)

RULES_BY_SIGNAL: dict[CompetitorSignal, SignalRules] = {rules.signal: rules for rules in SIGNAL_RULES}


def _phrases(*patterns: str) -> re.Pattern[str]:
    """One pattern matching any phrase, on word boundaries, in any letter case."""
    return re.compile(r"(?<![\w])(?:" + "|".join(patterns) + r")(?![\w])", re.IGNORECASE)


# An amount of money as the value parser recognises it: a currency symbol or
# code followed by a number. Built from the parser's own constants so the two
# can never disagree about what a currency is.
MONEY = re.compile(
    rf"(?:[{CURRENCY_SYMBOLS}]|{CURRENCY_WORDS})\s*\d[\d,]*(?:\.\d+)?",
    re.IGNORECASE,
)

# Words that make a number commercial. They are looked for in the changed
# words and in the few words right beside them, never across a whole
# paragraph, so "5 projects" in a sentence that also mentions a price is not
# claimed as a price.
PRICING_PHRASES = _phrases(
    r"per (?:month|year|annum|user|seat|member|agent|license|licence)",
    r"a (?:month|year)",
    r"[\d.,]+\s?/\s?(?:mo|month|yr|year|user|seat)",
    r"billed (?:monthly|annually|yearly|quarterly)",
    r"(?:monthly|annual|yearly) (?:billing|plan price|price|fee|subscription)",
    r"free trial",
    r"(?:\d+[- ])?day trial",
    r"money[- ]back(?: guarantee)?",
    r"discount(?:s|ed)?",
    r"\d+\s?% off",
    r"off (?:the )?(?:first|annual|monthly)",
    r"one[- ]time (?:fee|payment|purchase)",
    r"(?:setup|set-up|onboarding) fee",
    r"no credit card(?: required)?",
    r"cancel any ?time",
    r"pricing",
    r"prices?",
    r"free forever",
)

# Column or row headings in a table that name a price.
PRICE_HEADERS = _phrases(
    r"prices?",
    r"pricing",
    r"costs?",
    r"fees?",
    r"per month",
    r"per year",
    r"monthly",
    r"annual(?:ly)?",
    r"amount",
)

# Headings that name plans. "Pricing" is here and not in the pricing signal,
# because a pricing section is where plans are laid out; a price itself is only
# claimed from a value or pricing words, never from a heading.
PLAN_HEADINGS = _phrases(
    r"plans?",
    r"tiers?",
    r"editions?",
    r"pricing",
)

# Headings that name the product and its features.
FEATURE_HEADINGS = _phrases(
    r"features?",
    r"capabilit(?:y|ies)",
    r"integrations?",
    r"what['’]?s new",
    r"changelog",
    r"release notes",
    r"products?",
    r"what['’]?s included",
    r"specifications?",
    r"tech(?:nical)? specs?",
)

# Changed wording that itself announces a feature, wherever it sits.
FEATURE_PHRASES = _phrases(
    r"new feature",
    r"now supports?",
    r"now available",
    r"now includes?",
    r"integrates? with",
    r"integration with",
    r"added support for",
)

# Link text that asks the visitor to act. Matched only against the words of a
# link, and only short ones: a link is the DOM's own evidence that the words are
# something to click, and a long link is a sentence, not a button.
CTA_PHRASES = _phrases(
    r"start (?:a |your |for )?free(?: trial)?",
    r"start (?:now|today|building|your trial|trial)",
    r"get started(?: free| for free| now| today)?",
    r"get (?:it )?(?:for )?free",
    r"try (?:\S+ )?(?:free|now|it)",
    r"free trial",
    r"sign ?up(?: free| for free| now)?",
    r"register(?: now)?",
    r"create (?:a |an |your |free )?(?:free )?account",
    r"buy(?: it)? now",
    r"add to cart",
    r"subscribe(?: now)?",
    r"upgrade(?: now)?",
    r"contact sales",
    r"talk to (?:sales|an expert|our team)",
    r"(?:request|book|schedule|get) (?:a |your |free )?(?:free )?(?:demo|quote|call)",
    r"(?:see|watch) (?:a |the )?demo",
    r"learn more",
    r"join (?:now|free|today|for free)",
    r"download(?: now| free| for free)?",
    r"choose (?:this )?plan",
    r"select (?:this )?plan",
    r"(?:see|view|compare) (?:pricing|plans)",
)

# A plan's own button, "Choose Enterprise" or "Select Pro plan". Only ever
# matched against the whole of a link's words, because "choose" alone starts
# many ordinary phrases.
PLAN_CHOICE = re.compile(r"(?:choose|select|pick|get) (?:the |this |your )?[\w+-]+(?: plan)?", re.IGNORECASE)

# A call to action is a few words. Anything longer is prose that happens to be
# a link, and is reported as an ordinary link.
MAX_CTA_WORDS = 8


def find(pattern: re.Pattern[str], text: str | None) -> str | None:
    """The first match of the pattern in the text, as written in the text."""
    if not text:
        return None
    # Matched case-insensitively on the text itself rather than on a lowered
    # copy, so the phrase is returned exactly as the page spells it.
    found = pattern.search(normalize(text))
    if not found:
        return None
    return found.group(0).strip() or None


def find_money(text: str | None) -> str | None:
    if not text:
        return None
    found = MONEY.search(normalize(text))
    return found.group(0).strip() if found else None


def cta_phrase(link_text: str | None) -> str | None:
    """The call-to-action phrase in a link's words, or None if it is not one."""
    cleaned = normalize(link_text or "")
    if not cleaned or len(cleaned.split()) > MAX_CTA_WORDS:
        return None
    found = find(CTA_PHRASES, cleaned)
    if found:
        return found
    return cleaned if PLAN_CHOICE.fullmatch(cleaned) else None


def signal_label(signal: CompetitorSignal) -> str:
    return RULES_BY_SIGNAL[signal].label


def signal_blurb(signal: CompetitorSignal) -> str:
    return RULES_BY_SIGNAL[signal].blurb


__all__ = [
    "COMPETITOR_SIGNALS_VERSION",
    "CTA_PHRASES",
    "CompetitorSignal",
    "FEATURE_HEADINGS",
    "FEATURE_PHRASES",
    "MAX_CTA_WORDS",
    "MONEY",
    "PLAN_CHOICE",
    "PLAN_HEADINGS",
    "PRICE_HEADERS",
    "PRICING_PHRASES",
    "RULES_BY_SIGNAL",
    "SIGNAL_RULES",
    "SignalBasis",
    "SignalRules",
    "cta_phrase",
    "find",
    "find_money",
    "signal_blurb",
    "signal_label",
]
