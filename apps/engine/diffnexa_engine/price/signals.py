"""The categories a change on a pricing page can belong to, and the patterns behind them.

Someone checking a pricing or product page wants to see at a glance whether a
price moved, a sale ended, the currency or billing period changed, a plan was
renamed or a product went out of stock. This module holds that fixed vocabulary
and the deterministic patterns that recognise it.

It never evaluates. "$29 → $39" is reported as exactly that; whether it is a
good deal, a big rise or a competitor undercutting anyone is not something a
comparison of two captures can know, and no word here says so.

The central rule is **conservatism about what a price is**. A number is a price
only when the page itself marks it as money: a currency symbol or code written
next to it ("$29", "€29.99", "₹2,499", "INR 2499", "29 USD"), or a table column
headed as a price. "10 users", "a 14-day trial" and "99% uptime" contain digits
and are not prices, and the tests hold that line.

Patterns and categories are data, versioned together. When they change, the
version changes, so every result records the rules that produced it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

PRICE_RULES_VERSION = "2026.09.1"


class PriceCategory(StrEnum):
    """Where a change on a pricing page sits. Exactly one per change."""

    PRICE = "price"
    DISCOUNT = "discount_sale"
    ORIGINAL = "original_price"
    CURRENCY = "currency"
    BILLING = "billing_period"
    PRODUCT_PLAN = "product_plan"
    AVAILABILITY = "availability"
    PRICING_DETAILS = "pricing_details"
    OTHER = "other"


class PriceBasis(StrEnum):
    """What evidence placed a change in its category. Shown as the reason."""

    MONEY = "money"  # the changed words are an amount with a currency
    CURRENCY_CHANGED = "currency_changed"  # the amount's currency differs
    CURRENCY_CODE = "currency_code"  # the changed words are a currency on their own
    SALE_WORDING = "sale_wording"  # "now", "sale", "save", "% off" beside the amount
    ORIGINAL_WORDING = "original_wording"  # "was", "regular price", "MRP" beside the amount
    PRICE_COLUMN = "price_column"  # a table column or row headed as a price
    BILLING_WORDING = "billing_wording"  # "per month" becoming "per year"
    AVAILABILITY_WORDING = "availability_wording"  # "in stock", "sold out", "contact sales"
    PRICED_HEADING = "priced_heading"  # a heading with a price directly under it
    PLAN_HEADING = "plan_heading"  # a heading that names a plan or tier
    PLAN_TABLE_HEADER = "plan_table_header"  # a header cell of a table with prices
    PRICING_SECTION = "pricing_section"  # other content where prices are laid out
    SAME_AMOUNT = "same_amount"  # the amount is written differently, value unchanged
    METADATA = "metadata"  # page title, description, canonical link, address
    LINK = "link"  # an ordinary link
    NONE = "none"  # nothing recognised


@dataclass(frozen=True)
class CategoryRules:
    category: PriceCategory
    label: str
    blurb: str


# Labels and blurbs describe what a category covers, never whether a change in
# it is good or bad.
CATEGORY_RULES: tuple[CategoryRules, ...] = (
    CategoryRules(
        PriceCategory.PRICE,
        "Price",
        "Amounts of money the page states, with a currency symbol or code, or in a price column.",
    ),
    CategoryRules(
        PriceCategory.DISCOUNT,
        "Discount / Sale Price",
        "Sale prices and discounts, where the page words them as such: now, sale, save, % off.",
    ),
    CategoryRules(
        PriceCategory.ORIGINAL,
        "Original / Compare-at Price",
        "Prices the page marks as the original or usual price: was, regular price, list price, MRP.",
    ),
    CategoryRules(
        PriceCategory.CURRENCY,
        "Currency",
        "The currency an amount is given in, or a currency named on its own.",
    ),
    CategoryRules(
        PriceCategory.BILLING,
        "Billing Period",
        "How often a price is charged: per month, per year, weekly, one-time.",
    ),
    CategoryRules(
        PriceCategory.PRODUCT_PLAN,
        "Product / Plan",
        "Names of products, plans and tiers: headings with a price under them, or that name a plan.",
    ),
    CategoryRules(
        PriceCategory.AVAILABILITY,
        "Availability",
        "Stock and availability wording: in stock, sold out, pre-order, contact sales.",
    ),
    CategoryRules(
        PriceCategory.PRICING_DETAILS,
        "Pricing Details",
        "Other content where prices are laid out, such as what a plan includes.",
    ),
    CategoryRules(
        PriceCategory.OTHER,
        "Other Changes",
        "Every other change on the page. Shown in full; nothing is hidden.",
    ),
)

RULES_BY_CATEGORY: dict[PriceCategory, CategoryRules] = {rules.category: rules for rules in CATEGORY_RULES}


def _phrases(*patterns: str) -> re.Pattern[str]:
    """One pattern matching any phrase on word boundaries, in any letter case."""
    return re.compile(r"(?<![\w])(?:" + "|".join(patterns) + r")(?![\w])", re.IGNORECASE)


_NUMBER = r"\d[\d,]*(?:\.\d+)?"

# An amount of money: a currency symbol or code with a number. The code comes
# first ("$29", "USD 29", "Rs. 2,499") or, for codes only, after ("29 USD").
# Letter codes must stand alone, so "hrs 5" is not rupees.
MONEY = re.compile(
    rf"(?:(?P<pre>US\$|[₹$€£¥]|(?<![A-Za-z])(?:Rs\.?|INR|USD|EUR|GBP|JPY)(?![A-Za-z]))\s?(?P<num>{_NUMBER})"
    rf"|(?<![\w.])(?P<num2>{_NUMBER})\s?(?P<post>USD|EUR|GBP|INR|JPY)(?![A-Za-z]))",
    re.IGNORECASE,
)

# A currency written on its own, as the whole of a changed word: "USD", "EUR.".
CURRENCY_ALONE = re.compile(r"^[\W_]*(US\$|[₹$€£¥]|Rs\.?|INR|USD|EUR|GBP|JPY)[\W_]*$", re.IGNORECASE)

_CURRENCY_CODES = {
    "$": "USD",
    "us$": "USD",
    "usd": "USD",
    "€": "EUR",
    "eur": "EUR",
    "£": "GBP",
    "gbp": "GBP",
    "₹": "INR",
    "rs": "INR",
    "rs.": "INR",
    "inr": "INR",
    "¥": "JPY",
    "jpy": "JPY",
}

PERCENT = re.compile(rf"(?<![\w.]){_NUMBER}\s?%")

# Words that mark an amount as a sale or discounted price.
SALE_WORDS = _phrases(
    r"now",
    r"on sale",
    r"sale(?: price)?",
    r"offer(?: price)?",
    r"special (?:price|offer)",
    r"deal(?: price)?",
    r"promo(?:tional)?(?: price)?",
    r"discount(?:ed)?(?: price)?",
    r"you save",
    r"save",
    r"limited[- ]time(?: offer)?",
    r"intro(?:ductory)? price",
    r"off",
)

# Words that mark an amount as the original or usual price.
ORIGINAL_WORDS = _phrases(
    r"was",
    r"originally",
    r"original(?: price)?",
    r"regular(?: price)?",
    r"reg\.",
    r"list price",
    r"compare[- ]at(?: price)?",
    r"m\.?r\.?p\.?",
    r"rrp",
    r"retail price",
    r"usual price",
)

# Table headings.
PRICE_HEADERS = _phrases(r"prices?", r"pricing", r"costs?", r"fees?", r"amount", r"rate")
SALE_HEADERS = _phrases(r"sale(?: price)?", r"discount(?:ed)?(?: price)?", r"offer price", r"deal price")
ORIGINAL_HEADERS = _phrases(
    r"original price", r"regular price", r"list price", r"m\.?r\.?p\.?", r"rrp", r"compare[- ]at price"
)

# A billing period, as the whole of the changed words: "month" → "year",
# "Monthly" → "Annual", "billed monthly" → "billed annually".
BILLING_ALONE = re.compile(
    r"^[\s(/,.]*(?:(?:billed|paid|charged)\s+)?(?:(?:per|a|every|each)\s+|/\s?)?"
    r"(?P<period>monthly|month|mo|annually|annual|yearly|year|yr|annum|weekly|week|quarterly|quarter"
    r"|one[- ]time|lifetime)[\s)/,.]*$",
    re.IGNORECASE,
)
# Periods that are billing words in themselves. "month" and "year" are not:
# "a month ago" is not a billing period, so they need "per" or "/" beside them.
STRONG_PERIODS = frozenset(
    {"monthly", "annually", "annual", "yearly", "weekly", "quarterly", "one-time", "one time", "lifetime"}
)
PERIOD_LEADERS = frozenset({"per", "a", "every", "each", "/", "billed", "paid", "charged"})

AVAILABILITY_WORDS = _phrases(
    r"in stock",
    r"out of stock",
    r"sold out",
    r"low stock",
    r"limited stock",
    r"only \d+ left",
    r"currently unavailable",
    r"not available",
    r"unavailable",
    r"available",
    r"pre-?order",
    r"back-?order(?:ed)?",
    r"coming soon",
    r"discontinued",
    r"contact sales",
    r"contact us for pricing",
    r"notify me",
    r"join the waitlist",
    r"waitlist",
)

# A heading that names a plan or tier in its own words.
PLAN_WORDS = _phrases(r"plans?", r"tiers?", r"editions?", r"packages?", r"bundles?", r"subscriptions?")

# A section heading under which prices are laid out.
PRICING_SECTIONS = _phrases(
    r"pricing", r"prices?", r"plans?", r"tiers?", r"packages?", r"editions?", r"subscriptions?", r"billing"
)


def normalise_currency(marker: str) -> str:
    """ "$" and "USD" are the same currency; "Rs." and "₹" are too."""
    return _CURRENCY_CODES.get(marker.strip().lower(), marker.strip().upper())


def find(pattern: re.Pattern[str], text: str | None) -> str | None:
    if not text:
        return None
    found = pattern.search(text)
    if not found:
        return None
    return found.group(0).strip() or None


def category_label(category: PriceCategory) -> str:
    return RULES_BY_CATEGORY[category].label


def category_blurb(category: PriceCategory) -> str:
    return RULES_BY_CATEGORY[category].blurb


__all__ = [
    "AVAILABILITY_WORDS",
    "BILLING_ALONE",
    "CATEGORY_RULES",
    "CURRENCY_ALONE",
    "CategoryRules",
    "MONEY",
    "ORIGINAL_HEADERS",
    "ORIGINAL_WORDS",
    "PERCENT",
    "PERIOD_LEADERS",
    "PLAN_WORDS",
    "PRICE_HEADERS",
    "PRICE_RULES_VERSION",
    "PRICING_SECTIONS",
    "PriceBasis",
    "PriceCategory",
    "RULES_BY_CATEGORY",
    "SALE_HEADERS",
    "SALE_WORDS",
    "STRONG_PERIODS",
    "category_blurb",
    "category_label",
    "find",
    "normalise_currency",
]
