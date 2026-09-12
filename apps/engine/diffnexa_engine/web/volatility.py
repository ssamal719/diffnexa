"""Recognising webpage volatility: real differences that are not real changes.

A page can differ from itself. "Updated 4 minutes ago" changes every minute, a
view counter ticks, a copyright year rolls over, a consent banner survives
extraction on one capture and not the other. All of those are genuine textual
differences, and none of them is what a person means by "what changed".

Three rules govern everything here:

* **Mark, never delete.** A volatile change keeps its evidence and its values
  and gains a `noise_reason` explaining the judgement. The interface hides it by
  default; the user can still see it, and can see why. Silently dropping content
  that might have mattered is the one failure this product cannot afford.
* **Both sides must match the pattern.** A change is only volatile if the old
  value *and* the new value are the same kind of volatile thing. "Updated 4
  minutes ago" becoming "Updated 2 hours ago" is volatility; "Updated 4 minutes
  ago" becoming "This page is no longer maintained" is a real change.
* **Structure over vocabulary.** Where a pattern could appear in legitimate
  writing — a cookie policy says "we use cookies" — the rule also requires the
  structural signal that separates furniture from content: a short, whole node
  that appeared or disappeared, rather than an edit inside a paragraph.

No learning, no scoring, no comparison across multiple captures. Every rule is a
pattern with a stated reason, and every rule has a test proving what it does and
a test proving what it does not.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlsplit

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.contracts.changes import Change, ChangeCategory, ChangeKind

# ---------------------------------------------------------------- patterns

# "4 minutes ago", "about 2 hours ago", "just now", "yesterday"
RELATIVE_TIME = re.compile(
    r"\b(?:just now|moments? ago|yesterday|today"
    r"|(?:about\s+|around\s+|over\s+|almost\s+)?\d+\s*"
    r"(?:second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago)\b",
    re.IGNORECASE,
)

# "Last updated:", "Last checked", "Last modified on", "Page updated"
FRESHNESS_LABEL = re.compile(
    r"\b(?:last\s+(?:updated|checked|modified|reviewed|refreshed)"
    r"|(?:page|content|data|prices?)\s+(?:updated|refreshed)"
    r"|updated\s+(?:on|at)|generated\s+(?:on|at))\b",
    re.IGNORECASE,
)

# A copyright line, whose year turns over on 1 January everywhere at once.
COPYRIGHT_LINE = re.compile(
    r"^\s*(?:copyright\s*|\(c\)\s*|©\s*)+\s*\d{4}(?:\s*[-–—]\s*\d{4})?\b", re.IGNORECASE
)

# Counters attached to a unit that only ever counts interface activity.
COUNTER = re.compile(
    r"\b\d[\d,.\s]*\+?\s*"
    r"(?:views?|reads?|readers?|comments?|replies|shares?|likes?|followers?"
    r"|people\s+(?:are\s+)?(?:viewing|watching|reading)|online\s+now|in\s+stock\s+now)\b",
    re.IGNORECASE,
)

# A consent banner's own sentences. Used only with the structural guard below.
CONSENT_SENTENCE = re.compile(
    r"\b(?:we\s+use\s+cookies|this\s+(?:site|website)\s+uses\s+cookies"
    r"|accept\s+(?:all\s+)?cookies|manage\s+(?:your\s+)?cookie\s+preferences"
    r"|by\s+continuing\s+to\s+(?:use|browse)|cookie\s+settings"
    r"|we\s+value\s+your\s+privacy)\b",
    re.IGNORECASE,
)

# A consent remnant is a short, whole block that appeared or vanished. A policy
# page discussing cookies is neither short nor added wholesale.
CONSENT_MAX_WORDS = 25

# A moment in time: a date, a time, or a month name followed by a number. Used
# to check that a freshness line differs only in when it was written.
MOMENT = re.compile(
    r"\d[\d:/.\-]*"
    r"|\b(?:january|february|march|april|may|june|july|august|september|october"
    r"|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b"
    r"|\b(?:am|pm|utc|gmt|bst|est|ist)\b",
    re.IGNORECASE,
)

# Clock times, which change on pages that print when they were rendered.
CLOCK_TIME = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b", re.IGNORECASE)

# Parameters that identify a session or defeat a cache, never the page.
OPAQUE_PARAMETERS = frozenset(
    {
        "sid",
        "sessid",
        "sessionid",
        "session_id",
        "phpsessid",
        "jsessionid",
        "cachebuster",
        "cb",
        "_",
        "ts",
        "timestamp",
        "nocache",
        "rand",
        "r",
        "v",
    }
)

# Reasons, written once so the interface and the tests use the same words.
REASON_RELATIVE_TIME = "A relative timestamp, which changes on its own as time passes."
REASON_FRESHNESS = "A 'last updated' line, which changes whenever the page is republished."
REASON_COPYRIGHT = "A copyright year, which changes for every page on the site at once."
REASON_COUNTER = "An interface counter, which changes as people use the page."
REASON_CONSENT = "A cookie or consent notice, which appears and disappears independently of content."
REASON_CLOCK = "A clock time printed on the page, which changes on every capture."
REASON_OPAQUE_LINK = "The link's destination is the same; only a session or cache parameter differs."


def _both(old: str | None, new: str | None, pattern: re.Pattern[str]) -> bool:
    """True when the pattern holds on both sides, so the kind of thing is unchanged."""
    return bool(old and new and pattern.search(old) and pattern.search(new))


def _text_without(value: str, pattern: re.Pattern[str]) -> str:
    return normalize(pattern.sub(" ", value)).casefold()


def _same_apart_from(old: str, new: str, pattern: re.Pattern[str]) -> bool:
    """True when removing the volatile part leaves the two sides identical.

    This is the safeguard that keeps real edits visible. "Updated 2 hours ago"
    and "Updated 5 hours ago" are the same sentence around a moving part; if any
    other word differs, the change is reported normally.
    """
    return _text_without(old, pattern) == _text_without(new, pattern)


def _link_difference_is_opaque(old_href: str | None, new_href: str | None) -> bool:
    """True when two links point at the same place and differ only in plumbing."""
    if not old_href or not new_href:
        return False
    old_parts, new_parts = urlsplit(old_href), urlsplit(new_href)
    if (old_parts.scheme, old_parts.netloc, old_parts.path) != (
        new_parts.scheme,
        new_parts.netloc,
        new_parts.path,
    ):
        return False

    def meaningful(query: str) -> list[tuple[str, str]]:
        return sorted(
            (key, value)
            for key, value in parse_qsl(query, keep_blank_values=True)
            if key.lower() not in OPAQUE_PARAMETERS
        )

    if meaningful(old_parts.query) != meaningful(new_parts.query):
        return False
    # Something must actually differ, or this is not a change at all.
    return old_parts.query != new_parts.query


def volatility_reason(change: Change, context: tuple[str, str] | None = None) -> str | None:
    """Why this change is volatile rather than meaningful, or None.

    `context` is the full text of the block each side of the change came from.
    It matters: comparison reports the words that differ, so a ticking clock
    arrives here as "4" becoming "2". Only the sentence around it — "Updated 4
    minutes ago" — shows what kind of thing that is. Without the context no rule
    can fire, which is the safe direction to fail.
    """
    if change.noise_reason is not None:
        return None

    old, new = change.old_value, change.new_value
    old_text, new_text = context if context else (old, new)

    if change.category is ChangeCategory.LINK and change.kind is ChangeKind.MODIFIED:
        return REASON_OPAQUE_LINK if _link_difference_is_opaque(old, new) else None

    # A consent remnant is a whole short block arriving or leaving, not an edit.
    if change.kind in (ChangeKind.ADDED, ChangeKind.REMOVED):
        text = new_text or old_text or ""
        if (
            CONSENT_SENTENCE.search(text)
            and len(text.split()) <= CONSENT_MAX_WORDS
            and change.category is ChangeCategory.TEXT
        ):
            return REASON_CONSENT
        return None

    if change.kind is not ChangeKind.MODIFIED or not (old and new):
        return None

    if not (old_text and new_text):
        return None

    # Each rule needs the same kind of volatile thing on both sides, and needs
    # every other word around it to be unchanged.
    for pattern, reason in (
        (RELATIVE_TIME, REASON_RELATIVE_TIME),
        (COUNTER, REASON_COUNTER),
    ):
        if _both(old_text, new_text, pattern) and _same_apart_from(old_text, new_text, pattern):
            return reason

    if _both(old_text, new_text, COPYRIGHT_LINE) and _same_apart_from(
        old_text, new_text, re.compile(r"\d{4}")
    ):
        return REASON_COPYRIGHT

    if _both(old_text, new_text, FRESHNESS_LABEL) and _same_apart_from(old_text, new_text, MOMENT):
        return REASON_FRESHNESS

    if _both(old_text, new_text, CLOCK_TIME) and _same_apart_from(old_text, new_text, CLOCK_TIME):
        return REASON_CLOCK

    return None


def mark_volatile(
    changes: tuple[Change, ...], contexts: dict[str, tuple[str, str]] | None = None
) -> tuple[Change, ...]:
    """Return the same changes, with volatile ones explained.

    Nothing is removed and no value is altered. Only `noise_reason` is set, so
    every change keeps its evidence and can still be shown on request.
    """
    contexts = contexts or {}
    marked: list[Change] = []
    for change in changes:
        reason = volatility_reason(change, contexts.get(change.id))
        marked.append(change.model_copy(update={"noise_reason": reason}) if reason else change)
    return tuple(marked)
