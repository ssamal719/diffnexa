"""Putting each change the comparison already found into one pricing category.

This layer adds nothing to the comparison and removes nothing from it. The
deterministic webpage engine decides what changed; this decides, for each of
those changes, which of nine categories it sits in.

Rules that keep it honest:

* **Never a filter.** Every change gets exactly one category and stays in the
  result. "Other Changes" holds everything that is not about pricing, in full.
* **Conservative about prices.** A number is a price only when the page marks
  it as money — a currency symbol or code written beside it, or a column headed
  as a price. "10 users", "a 14-day trial" and "99% uptime" are never prices.
* **Read the words beside the change.** The engine reports "2499 → 2999" for
  "INR 2499 → INR 2999" and "month → year" for "per month → per year". The
  currency or "per" that makes those pricing changes sits in the next word, so
  each rule reads a small, fixed window of words around the change — never the
  whole paragraph.
* **Where, not what it means.** Categories state facts about the page. Nothing
  here calls a price good, bad, high, low or better.

Each category records the exact text that produced it, taken from the change's
own evidence, so a reader can check it against the page.

Rules are applied in this order; the first that applies wins:

1. Page title, description, canonical or address  → Other Changes
2. A link                                         → Availability if its words
                                                     say so, else Other Changes
3. The changed words are an amount of money:
     its currency differs from before             → Currency
     same currency and amount, written differently → Pricing Details
     "was", "regular price", "MRP" beside it      → Original / Compare-at Price
     "now", "sale", "save", "off" beside it       → Discount / Sale Price
     a sale / original / price column             → that category
     otherwise                                    → Price
4. The changed words are a currency on their own  → Currency
5. A percentage with sale wording beside it       → Discount / Sale Price
6. A number in a column headed as a price         → Price (or sale/original)
7. The changed words are a billing period         → Billing Period
8. The changed words are availability wording     → Availability
9. A heading with a price under it, a heading that
   names a plan, or a header cell of a priced table → Product / Plan
10. Other content where prices are laid out        → Pricing Details
11. Anything else                                  → Other Changes

Kept beside the comparison result rather than inside it, so the `Change`
contract every other tool depends on is untouched.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from diffnexa_engine.contracts.changes import Change, ChangeCategory, Side
from diffnexa_engine.price.signals import (
    AVAILABILITY_WORDS,
    BILLING_ALONE,
    CATEGORY_RULES,
    CURRENCY_ALONE,
    MONEY,
    ORIGINAL_HEADERS,
    ORIGINAL_WORDS,
    PERCENT,
    PLAN_WORDS,
    PRICE_HEADERS,
    PRICE_RULES_VERSION,
    PRICING_SECTIONS,
    SALE_HEADERS,
    SALE_WORDS,
    STRONG_PERIODS,
    PriceBasis,
    PriceCategory,
    category_label,
    find,
    normalise_currency,
)
from diffnexa_engine.web.snapshot import ContentNode, NodeRole, Snapshot

# Words read either side of a change. One for a currency written beside a
# number ("INR 2499"); three for wording such as "was", "now" or "% off"; two
# for availability wording that the change sits inside ("Out of stock").
MONEY_RADIUS = 1
MARKER_RADIUS = 3
AVAILABILITY_RADIUS = 2


@dataclass(frozen=True)
class PriceSignal:
    """One change's category, and the evidence that placed it there."""

    category: PriceCategory
    basis: PriceBasis
    # Exactly as the page has it, from the change's own evidence. Empty only
    # when there is nothing to quote (Other Changes).
    matched_text: str = ""

    @property
    def label(self) -> str:
        return category_label(self.category)


@dataclass
class PriceClassification:
    """Price categories for one comparison, recorded alongside its result."""

    rules_version: str = PRICE_RULES_VERSION
    by_change: dict[str, PriceSignal] = field(default_factory=dict)
    # Changes the engine explained as noise keep a category but are counted
    # apart from what changed, as in every other DiffNexa report.
    noise: set[str] = field(default_factory=set)

    def signal_for(self, change_id: str) -> PriceSignal | None:
        return self.by_change.get(change_id)

    def change_ids_for(self, category: PriceCategory, *, include_noise: bool = False) -> list[str]:
        return [
            change_id
            for change_id, found in self.by_change.items()
            if found.category is category and (include_noise or change_id not in self.noise)
        ]

    def counts(self) -> dict[PriceCategory, int]:
        return {rules.category: len(self.change_ids_for(rules.category)) for rules in CATEGORY_RULES}

    def changed_categories(self) -> tuple[PriceCategory, ...]:
        return tuple(category for category, count in self.counts().items() if count > 0)


# ---------------------------------------------------------------- the page


@dataclass(frozen=True)
class _Page:
    nodes: dict[str, ContentNode]
    # Headings with an amount of money directly under them: a pricing card's
    # plan name, a product page's product name.
    priced_headings: frozenset[str]
    # Tables with an amount of money in any cell.
    priced_tables: frozenset[int]


def _read_page(snapshot: Snapshot) -> _Page:
    priced_headings: set[str] = set()
    priced_tables: set[int] = set()
    for node in snapshot.nodes:
        if node.role in (NodeRole.HEADING, NodeRole.LINK) or not MONEY.search(node.text):
            continue
        if node.section_path:
            priced_headings.add(node.section_path[-1])
        if node.table is not None:
            priced_tables.add(node.table.table_index)
    return _Page(snapshot.node_index(), frozenset(priced_headings), frozenset(priced_tables))


@dataclass(frozen=True)
class _Cited:
    side: Side
    node: ContentNode
    token_ids: tuple[str, ...]


def _cited_nodes(change: Change, pages: dict[Side, _Page]) -> list[_Cited]:
    cited: list[_Cited] = []
    for evidence in change.evidence:
        page = pages.get(evidence.side)
        if page is None or not evidence.node_id:
            continue
        node = page.nodes.get(evidence.node_id)
        if node is not None:
            cited.append(_Cited(evidence.side, node, evidence.token_ids))
    # The page as it reads now first, so a quote shows the current wording.
    cited.sort(key=lambda item: 0 if item.side is Side.NEW else 1)
    return cited


# ---------------------------------------------------------------- word windows


@dataclass(frozen=True)
class _Window:
    """The changed words and a few either side, with where the change sits."""

    text: str
    start: int
    end: int

    @property
    def changed(self) -> str:
        return self.text[self.start : self.end]

    @property
    def before(self) -> list[str]:
        return self.text[: self.start].split()


def _window(item: _Cited, radius: int) -> _Window | None:
    tokens = item.node.tokens
    if not tokens:
        return None
    wanted = set(item.token_ids)
    positions = [index for index, token in enumerate(tokens) if token.id in wanted]
    if not positions:
        # Evidence for a whole block (added or removed) cites no single words:
        # the whole block is what changed.
        positions = list(range(len(tokens)))
    first, last = min(positions), max(positions)
    low, high = max(0, first - radius), min(len(tokens), last + radius + 1)

    parts: list[str] = []
    offset, start, end = 0, 0, 0
    for index in range(low, high):
        if parts:
            offset += 1
        if index == first:
            start = offset
        parts.append(tokens[index].text)
        offset += len(tokens[index].text)
        if index == last:
            end = offset
    return _Window(" ".join(parts), start, end)


def _overlapping(pattern: re.Pattern[str], window: _Window | None) -> re.Match[str] | None:
    """The first match that includes at least part of the changed words."""
    if window is None:
        return None
    for found in pattern.finditer(window.text):
        if found.start() < window.end and found.end() > window.start:
            return found
    return None


def _nearest_marker(window: _Window | None) -> tuple[PriceCategory, str] | None:
    """Sale or original-price wording beside the change, nearest first.

    Wording belongs to the amount it sits next to. In "Was $99, now $79" the
    word "was" belongs to $99 and "now" to $79; in "MRP ₹2,999 ₹1,999" the
    "MRP" belongs to ₹2,999 only. So a marker with another amount between it
    and the change is not counted.
    """
    if window is None:
        return None
    amounts = [
        (found.start(), found.end())
        for found in MONEY.finditer(window.text)
        if not (found.start() < window.end and found.end() > window.start)
    ]

    best: tuple[int, int, PriceCategory, str] | None = None
    for pattern, category in ((ORIGINAL_WORDS, PriceCategory.ORIGINAL), (SALE_WORDS, PriceCategory.DISCOUNT)):
        for found in pattern.finditer(window.text):
            if found.start() < window.end and found.end() > window.start:
                continue  # part of the change itself, not wording beside it
            if found.end() <= window.start:
                gap = (found.end(), window.start)
                distance, side = window.start - found.end(), 0
            else:
                gap = (window.end, found.start())
                distance, side = found.start() - window.end, 1
            if any(gap[0] <= start and end <= gap[1] for start, end in amounts):
                continue
            key = (distance, side, category, found.group(0))
            if best is None or key[:2] < best[:2]:
                best = key
    return (best[2], best[3]) if best else None


def _amount(found: re.Match[str]) -> tuple[str, Decimal | None]:
    marker = found.group("pre") or found.group("post") or ""
    number = found.group("num") or found.group("num2") or ""
    try:
        value = Decimal(number.replace(",", ""))
    except InvalidOperation:
        value = None
    return normalise_currency(marker), value


# ---------------------------------------------------------------- the rules


def _money(change: Change, cited: list[_Cited]) -> PriceSignal | None:
    by_side: dict[Side, re.Match[str]] = {}
    windows: dict[Side, _Window | None] = {}
    for item in cited:
        window = _window(item, MONEY_RADIUS)
        found = _overlapping(MONEY, window)
        if found is not None and item.side not in by_side:
            by_side[item.side] = found
            windows[item.side] = _window(item, MARKER_RADIUS)
    if not by_side:
        return None

    shown = by_side.get(Side.NEW) or by_side[Side.OLD]
    if Side.OLD in by_side and Side.NEW in by_side:
        old_currency, old_value = _amount(by_side[Side.OLD])
        new_currency, new_value = _amount(by_side[Side.NEW])
        if old_currency != new_currency:
            return PriceSignal(PriceCategory.CURRENCY, PriceBasis.CURRENCY_CHANGED, shown.group(0))
        if old_value is not None and old_value == new_value:
            return PriceSignal(PriceCategory.PRICING_DETAILS, PriceBasis.SAME_AMOUNT, shown.group(0))

    for side in (Side.NEW, Side.OLD):
        if side in windows:
            marker = _nearest_marker(windows[side])
            if marker is not None:
                category, text = marker
                original = category is PriceCategory.ORIGINAL
                basis = PriceBasis.ORIGINAL_WORDING if original else PriceBasis.SALE_WORDING
                return PriceSignal(category, basis, text)

    column = _price_column(cited)
    if column is not None:
        return column
    return PriceSignal(PriceCategory.PRICE, PriceBasis.MONEY, shown.group(0))


def _price_column(cited: list[_Cited]) -> PriceSignal | None:
    """A table cell under a heading that says what kind of price it is."""
    for item in cited:
        table = item.node.table
        if table is None:
            continue
        for header in (table.column_header, table.row_key):
            if not header:
                continue
            for pattern, category in (
                (ORIGINAL_HEADERS, PriceCategory.ORIGINAL),
                (SALE_HEADERS, PriceCategory.DISCOUNT),
                (PRICE_HEADERS, PriceCategory.PRICE),
            ):
                if find(pattern, header):
                    return PriceSignal(category, PriceBasis.PRICE_COLUMN, header)
    return None


def _currency_alone(cited: list[_Cited]) -> PriceSignal | None:
    found: dict[Side, str] = {}
    for item in cited:
        window = _window(item, 0)
        if window is None:
            continue
        match = CURRENCY_ALONE.match(window.changed)
        if match:
            found.setdefault(item.side, match.group(1))
    if not found:
        return None
    if len(found) == 2 and normalise_currency(found[Side.OLD]) == normalise_currency(found[Side.NEW]):
        return None  # "Rs." becoming "INR": the same currency, written differently
    shown = found.get(Side.NEW) or found[Side.OLD]
    return PriceSignal(PriceCategory.CURRENCY, PriceBasis.CURRENCY_CODE, shown)


def _discount_percentage(cited: list[_Cited]) -> PriceSignal | None:
    """ "Save 20%" becoming "Save 25%". "99% uptime" has no sale wording and is not."""
    for item in cited:
        window = _window(item, MARKER_RADIUS)
        if _overlapping(PERCENT, window) is None:
            continue
        marker = _nearest_marker(window)
        if marker is not None and marker[0] is PriceCategory.DISCOUNT:
            return PriceSignal(PriceCategory.DISCOUNT, PriceBasis.SALE_WORDING, marker[1])
    return None


def _number_in_price_column(cited: list[_Cited]) -> PriceSignal | None:
    """A plain number in a "Price" column is a price: the table says so."""
    for item in cited:
        window = _window(item, 0)
        if item.node.table is None or window is None:
            continue
        if re.search(r"\d", window.changed) and not PERCENT.search(window.changed):
            column = _price_column([item])
            if column is not None:
                return column
    return None


def _billing(cited: list[_Cited], pages: dict[Side, _Page]) -> PriceSignal | None:
    """ "per month" becoming "per year", or "Monthly" becoming "Annual".

    "month" and "year" alone are ordinary words ("a month ago"), so they count
    only with "per", "/" or "billed" beside them. Every billing change must also
    sit with a price: in a block that states an amount, or in a priced section.
    """
    for item in cited:
        window = _window(item, 1)
        if window is None:
            continue
        found = BILLING_ALONE.match(window.changed)
        if not found:
            continue
        period = found.group("period").lower().replace("-", " ") if found.group("period") else ""
        period = "one-time" if period == "one time" else period
        changed = window.changed.lower()
        left = window.before[-1].lower() if window.before else ""
        has_money = MONEY.search(item.node.text) is not None
        led = (
            any(word in changed.split() for word in ("per", "billed", "paid", "charged", "every", "each"))
            or "/" in changed
            or left in {"per", "/", "billed", "paid", "charged", "every", "each"}
            or (left == "a" and has_money)
        )
        if period not in STRONG_PERIODS and not led:
            continue
        if has_money or _pricing_context(item, pages) is not None or "billed" in item.node.text.lower():
            quoted = window.changed.strip().strip(",.;:()")
            return PriceSignal(PriceCategory.BILLING, PriceBasis.BILLING_WORDING, quoted)
    return None


def _availability(cited: list[_Cited]) -> PriceSignal | None:
    for item in cited:
        found = _overlapping(AVAILABILITY_WORDS, _window(item, AVAILABILITY_RADIUS))
        if found is not None:
            return PriceSignal(PriceCategory.AVAILABILITY, PriceBasis.AVAILABILITY_WORDING, found.group(0))
    return None


def _product_or_plan(cited: list[_Cited], pages: dict[Side, _Page]) -> PriceSignal | None:
    for item in cited:
        node = item.node
        if node.role is NodeRole.HEADING:
            if node.text in pages[item.side].priced_headings:
                return PriceSignal(PriceCategory.PRODUCT_PLAN, PriceBasis.PRICED_HEADING, node.text)
            if find(PLAN_WORDS, node.text):
                return PriceSignal(PriceCategory.PRODUCT_PLAN, PriceBasis.PLAN_HEADING, node.text)
        table = node.table
        if table is not None and table.is_header and table.table_index in pages[item.side].priced_tables:
            return PriceSignal(PriceCategory.PRODUCT_PLAN, PriceBasis.PLAN_TABLE_HEADER, node.text)
    return None


def _pricing_context(item: _Cited, pages: dict[Side, _Page]) -> str | None:
    """The text that shows this content sits where prices are laid out."""
    page = pages[item.side]
    node = item.node
    money = MONEY.search(node.text)
    if money is not None:
        return money.group(0)
    if node.table is not None and node.table.table_index in page.priced_tables:
        return node.text
    if node.section_path:
        nearest = node.section_path[-1]
        if nearest in page.priced_headings or find(PRICING_SECTIONS, nearest):
            return nearest
    return None


def _pricing_details(cited: list[_Cited], pages: dict[Side, _Page]) -> PriceSignal | None:
    for item in cited:
        context = _pricing_context(item, pages)
        if context is not None:
            return PriceSignal(PriceCategory.PRICING_DETAILS, PriceBasis.PRICING_SECTION, context)
    return None


def _classify(change: Change, pages: dict[Side, _Page]) -> PriceSignal:
    if change.category is ChangeCategory.METADATA:
        return PriceSignal(PriceCategory.OTHER, PriceBasis.METADATA)

    cited = _cited_nodes(change, pages)

    if change.category is ChangeCategory.LINK:
        for item in cited:
            found = find(AVAILABILITY_WORDS, item.node.text)
            if found:
                return PriceSignal(PriceCategory.AVAILABILITY, PriceBasis.AVAILABILITY_WORDING, found)
        return PriceSignal(PriceCategory.OTHER, PriceBasis.LINK)

    for rule in (
        lambda: _money(change, cited),
        lambda: _currency_alone(cited),
        lambda: _discount_percentage(cited),
        lambda: _number_in_price_column(cited),
        lambda: _billing(cited, pages),
        lambda: _availability(cited),
        lambda: _product_or_plan(cited, pages),
        lambda: _pricing_details(cited, pages),
    ):
        found = rule()
        if found is not None:
            return found
    return PriceSignal(PriceCategory.OTHER, PriceBasis.NONE)


def classify_change(change: Change, snapshots: dict[Side, Snapshot] | None = None) -> PriceSignal:
    """The one category this change sits in. Always one; Other Changes when no rule applies."""
    pages = {side: _read_page(snapshot) for side, snapshot in (snapshots or {}).items()}
    return _classify(change, pages)


def classify_changes(
    changes: Sequence[Change] | Iterable[Change],
    current_snapshot: Snapshot | None = None,
    baseline_snapshot: Snapshot | None = None,
) -> PriceClassification:
    """Give every change its category. The changes themselves are not touched."""
    pages: dict[Side, _Page] = {}
    if baseline_snapshot is not None:
        pages[Side.OLD] = _read_page(baseline_snapshot)
    if current_snapshot is not None:
        pages[Side.NEW] = _read_page(current_snapshot)

    classification = PriceClassification()
    for change in changes:
        classification.by_change[change.id] = _classify(change, pages)
        if change.noise_reason is not None:
            classification.noise.add(change.id)
    return classification


def describe_reason(signal: PriceSignal) -> str:
    """Why this category, in terms a reader can check against the page."""
    text = signal.matched_text
    return {
        PriceBasis.MONEY: f"“{text}” is an amount with a currency",
        PriceBasis.CURRENCY_CHANGED: f"the amount is now in a different currency (“{text}”)",
        PriceBasis.CURRENCY_CODE: f"“{text}” is a currency",
        PriceBasis.SALE_WORDING: f"“{text}” is written beside it",
        PriceBasis.ORIGINAL_WORDING: f"“{text}” is written beside it",
        PriceBasis.PRICE_COLUMN: f"it is in the column or row headed “{text}”",
        PriceBasis.BILLING_WORDING: f"“{text}” is a billing period",
        PriceBasis.AVAILABILITY_WORDING: f"the wording includes “{text}”",
        PriceBasis.PRICED_HEADING: f"“{text}” is a heading with a price under it",
        PriceBasis.PLAN_HEADING: f"the heading “{text}” names a plan",
        PriceBasis.PLAN_TABLE_HEADER: f"“{text}” heads a column in a table of prices",
        PriceBasis.PRICING_SECTION: f"it sits with prices on the page (“{text}”)",
        PriceBasis.SAME_AMOUNT: f"the amount is unchanged (“{text}”); only how it is written changed",
        PriceBasis.METADATA: "a change to the page's title, description or address",
        PriceBasis.LINK: "a link changed",
        PriceBasis.NONE: "not a pricing change by these rules",
    }[signal.basis]


def describe_signal_for_reader(signal: PriceSignal) -> str:
    return signal.label


__all__ = [
    "PriceClassification",
    "PriceSignal",
    "classify_change",
    "classify_changes",
    "describe_reason",
    "describe_signal_for_reader",
]
