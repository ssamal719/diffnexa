"""Recognise typed values — numbers, money, percentages and dates — inside text.

This is what turns "627 was deleted and 654 was added" into one change that says
the vacancy count rose by 27. Everything here is deterministic pattern matching
against the document's own text; nothing is inferred and nothing is looked up.

Deliberate restraint:

* A percentage difference is only calculated where it is meaningful. Years,
  identifiers, phone numbers and values that changed unit or currency get an
  absolute difference or none at all — never a misleading percentage.
* A date is only reported when it parses unambiguously. `03/04/2026` is
  ambiguous between March and April, so it is compared as text, not as a date,
  unless both versions use the same unambiguous format.
* Values are only paired when they sit in the same position of an otherwise
  matching sentence. Two unrelated numbers on a page are never paired.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum

from diffnexa_engine.compare.normalize import normalize


class ValueKind(StrEnum):
    NUMBER = "number"
    MONEY = "money"
    PERCENT = "percent"
    DATE = "date"
    YEAR = "year"
    IDENTIFIER = "identifier"


CURRENCY_SYMBOLS = "₹$€£¥"
CURRENCY_WORDS = r"(?:Rs\.?|INR|USD|EUR|GBP|JPY)"

# Digit groups: plain (1234), international (1,234,567) and Indian (12,34,567).
# The whole alternation is wrapped in a non-capturing group, because this string
# is interpolated between lookarounds: without the group, "(?<!x)A|B(?!y)" binds
# each lookaround to only one branch, and "2026" matches as "202".
_NUMBER_CORE = r"(?:\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)"

_MONEY = re.compile(
    rf"(?P<symbol>[{CURRENCY_SYMBOLS}]|{CURRENCY_WORDS})\s*(?P<number>{_NUMBER_CORE})",
    re.IGNORECASE,
)
_PERCENT = re.compile(rf"(?P<number>{_NUMBER_CORE})\s*(?P<symbol>%|per\s?cent)", re.IGNORECASE)
_NUMBER = re.compile(rf"(?<![\w.]){_NUMBER_CORE}(?![\w])")
_IDENTIFIER = re.compile(r"(?<![\w/-])(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)+(?![\w])")

MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}
_MONTH_NAMES = "|".join(sorted(MONTHS, key=len, reverse=True))

# 30 September 2026 · 30th Sept, 2026 · 30-Sep-2026
_DATE_DMY_WORD = re.compile(
    rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th)?[\s.\-]+(?P<month>{_MONTH_NAMES})\.?[\s,.\-]+(?P<year>\d{{4}})\b",
    re.IGNORECASE,
)
# September 30, 2026
_DATE_MDY_WORD = re.compile(
    rf"\b(?P<month>{_MONTH_NAMES})\.?[\s.\-]+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?[\s,.\-]+(?P<year>\d{{4}})\b",
    re.IGNORECASE,
)
# 2026-09-30 (ISO, unambiguous)
_DATE_ISO = re.compile(r"\b(?P<year>\d{4})-(?P<month>\d{1,2})-(?P<day>\d{1,2})\b")
# 30/09/2026 or 30-09-2026 — ambiguous unless one part is > 12
_DATE_NUMERIC = re.compile(r"\b(?P<a>\d{1,2})[/.\-](?P<b>\d{1,2})[/.\-](?P<year>\d{2,4})\b")

_YEAR = re.compile(r"^(1[89]\d{2}|20\d{2}|21\d{2})$")


@dataclass(frozen=True)
class TypedValue:
    """A value found in text, with the exact original spelling preserved."""

    kind: ValueKind
    text: str  # exactly as written in the document
    number: Decimal | None = None
    unit: str | None = None  # currency symbol or "%"
    day: int | None = None
    month: int | None = None
    year: int | None = None
    ambiguous: bool = False  # true for date formats that could be read two ways

    @property
    def as_date(self) -> date | None:
        if self.kind is not ValueKind.DATE or None in (self.day, self.month, self.year):
            return None
        try:
            return date(self.year, self.month, self.day)  # type: ignore[arg-type]
        except ValueError:
            return None


def _to_decimal(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def _month_number(raw: str) -> int | None:
    return MONTHS.get(raw.strip(". ").casefold())


def parse_date(text: str) -> TypedValue | None:
    """Parse one date. Returns None when the text is not a date at all."""
    cleaned = normalize(text)

    for pattern in (_DATE_DMY_WORD, _DATE_MDY_WORD):
        match = pattern.search(cleaned)
        if match:
            month = _month_number(match.group("month"))
            if month is None:
                continue
            return _build_date(
                match.group(0), int(match.group("day")), month, int(match.group("year")), ambiguous=False
            )

    match = _DATE_ISO.search(cleaned)
    if match:
        return _build_date(
            match.group(0),
            int(match.group("day")),
            int(match.group("month")),
            int(match.group("year")),
            ambiguous=False,
        )

    match = _DATE_NUMERIC.search(cleaned)
    if match:
        a, b = int(match.group("a")), int(match.group("b"))
        year = int(match.group("year"))
        year = year + 2000 if year < 100 else year
        if a > 12 and b <= 12:  # unambiguously day/month
            return _build_date(match.group(0), a, b, year, ambiguous=False)
        if b > 12 and a <= 12:  # unambiguously month/day
            return _build_date(match.group(0), b, a, year, ambiguous=False)
        # Both parts could be a month. Keep it, but flagged as ambiguous so the
        # engine compares it as text rather than inventing a calendar difference.
        return _build_date(match.group(0), a, b, year, ambiguous=True)
    return None


def _build_date(text: str, day: int, month: int, year: int, *, ambiguous: bool) -> TypedValue | None:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    try:
        date(year, month, day)
    except ValueError:
        return None
    return TypedValue(kind=ValueKind.DATE, text=text, day=day, month=month, year=year, ambiguous=ambiguous)


def parse_value(text: str) -> TypedValue | None:
    """Parse a fragment into a typed value, trying the most specific form first."""
    cleaned = normalize(text)
    if not cleaned:
        return None

    parsed_date = parse_date(cleaned)
    if parsed_date is not None:
        return parsed_date

    match = _PERCENT.search(cleaned)
    if match:
        number = _to_decimal(match.group("number"))
        if number is not None:
            return TypedValue(ValueKind.PERCENT, match.group(0), number=number, unit="%")

    match = _MONEY.search(cleaned)
    if match:
        number = _to_decimal(match.group("number"))
        if number is not None:
            return TypedValue(ValueKind.MONEY, match.group(0), number=number, unit=match.group("symbol"))

    match = _IDENTIFIER.search(cleaned)
    if match and match.group(0) == cleaned:
        return TypedValue(ValueKind.IDENTIFIER, cleaned)

    match = _NUMBER.search(cleaned)
    if match:
        number = _to_decimal(match.group(0))
        if number is not None:
            kind = ValueKind.YEAR if _YEAR.match(match.group(0)) else ValueKind.NUMBER
            return TypedValue(kind, match.group(0), number=number)
    return None


def contains_value(text: str) -> bool:
    return parse_value(text) is not None


@dataclass(frozen=True)
class ValueDelta:
    """The calculated difference between two paired values."""

    summary: str  # e.g. "+27" or "15 days later"
    absolute: str | None = None
    percent: str | None = None
    days: int | None = None


def _format_decimal(value: Decimal) -> str:
    normalized = value.normalize()
    text = format(normalized, "f")
    return text


def compare_values(old: TypedValue, new: TypedValue) -> ValueDelta | None:
    """Difference between two values, or None when a difference is not meaningful."""
    if old.kind is ValueKind.DATE and new.kind is ValueKind.DATE:
        if old.ambiguous or new.ambiguous:
            return None
        old_date, new_date = old.as_date, new.as_date
        if old_date is None or new_date is None:
            return None
        days = (new_date - old_date).days
        if days == 0:
            return None
        direction = "later" if days > 0 else "earlier"
        return ValueDelta(summary=f"{abs(days)} days {direction}", days=days)

    if old.number is None or new.number is None:
        return None
    # Identifiers and reference numbers have no arithmetic meaning.
    if ValueKind.IDENTIFIER in (old.kind, new.kind):
        return None
    # A changed currency or unit means the numbers are not comparable.
    if old.unit != new.unit:
        return None

    difference = new.number - old.number
    if difference == 0:
        return None
    sign = "+" if difference > 0 else "-"
    absolute = f"{sign}{_format_decimal(abs(difference))}"

    percent: str | None = None
    if _percentage_is_meaningful(old, new):
        ratio = (difference / old.number) * 100
        percent = f"{sign}{_format_decimal(abs(ratio).quantize(Decimal('0.01')))}%"

    summary = absolute if percent is None else f"{absolute} ({percent})"
    return ValueDelta(summary=summary, absolute=absolute, percent=percent)


def _percentage_is_meaningful(old: TypedValue, new: TypedValue) -> bool:
    """A percentage change is only reported for quantities where it means something."""
    if old.number == 0:
        return False  # division by zero, and "infinite increase" is not useful
    if ValueKind.YEAR in (old.kind, new.kind):
        return False  # 2026 -> 2027 is not a 0.05% increase
    if ValueKind.PERCENT in (old.kind, new.kind):
        return False  # percentage points, not a percentage of a percentage
    return True
