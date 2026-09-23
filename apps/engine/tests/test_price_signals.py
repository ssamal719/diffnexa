"""The patterns behind Price Monitor's categories, tested on their own.

Small and exhaustive, so a pattern change shows exactly which phrases it gained
or lost. The negative cases matter most: digits alone never make a price.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.price.signals import (
    AVAILABILITY_WORDS,
    BILLING_ALONE,
    CURRENCY_ALONE,
    MONEY,
    ORIGINAL_WORDS,
    PERCENT,
    PLAN_WORDS,
    SALE_WORDS,
    find,
    normalise_currency,
)


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        ("$29", "$29"),
        ("$29.99", "$29.99"),
        ("€29", "€29"),
        ("€29.99", "€29.99"),
        ("£29", "£29"),
        ("£29.99", "£29.99"),
        ("₹2,499", "₹2,499"),
        ("₹2499", "₹2499"),
        ("USD 29", "USD 29"),
        ("EUR 29", "EUR 29"),
        ("GBP 29", "GBP 29"),
        ("INR 2499", "INR 2499"),
        ("Rs. 2,499", "Rs. 2,499"),
        ("29 USD", "29 USD"),
        ("US$10", "US$10"),
        ("$29/month", "$29"),
    ],
)
def test_amounts_with_a_currency_are_money(text, amount):
    assert find(MONEY, text) == amount


@pytest.mark.parametrize(
    "text",
    [
        "10 users",
        "14-day trial",
        "99% uptime",
        "Version 2.4",
        "5 GB",
        "24/7 support",
        "12,000 teams",
        "4 hrs 5",
    ],
)
def test_numbers_without_a_currency_are_not_money(text):
    assert find(MONEY, text) is None


@pytest.mark.parametrize(
    ("marker", "code"), [("$", "USD"), ("usd", "USD"), ("Rs.", "INR"), ("₹", "INR"), ("€", "EUR")]
)
def test_currencies_are_normalised(marker, code):
    assert normalise_currency(marker) == code


@pytest.mark.parametrize(
    ("text", "found"), [("USD", True), ("EUR.", True), ("(GBP)", True), ("US", False), ("users", False)]
)
def test_a_currency_on_its_own(text, found):
    assert (CURRENCY_ALONE.match(text) is not None) is found


@pytest.mark.parametrize(
    ("text", "found"),
    [
        ("month", True),
        ("Monthly", True),
        ("annually,", True),
        ("/year", True),
        ("per month", True),
        ("billed monthly", True),
        ("one-time", True),
        ("weekly", True),
        ("14-day", False),
        ("months of support", False),
        ("30 days", False),
    ],
)
def test_billing_periods(text, found):
    assert (BILLING_ALONE.match(text) is not None) is found


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("In stock", "In stock"),
        ("Out of stock", "Out of stock"),
        ("Sold out", "Sold out"),
        ("Pre-order", "Pre-order"),
        ("Contact sales", "Contact sales"),
        ("Currently unavailable", "Currently unavailable"),
        ("Only 3 left", "Only 3 left"),
        ("Stockholm office", None),
    ],
)
def test_availability_wording(text, expected):
    assert find(AVAILABILITY_WORDS, text) == expected


def test_sale_and_original_wording():
    assert find(SALE_WORDS, "now") == "now"
    assert find(SALE_WORDS, "Sale price") == "Sale price"
    assert find(ORIGINAL_WORDS, "Was") == "Was"
    assert find(ORIGINAL_WORDS, "MRP") == "MRP"
    assert find(ORIGINAL_WORDS, "Regular price") == "Regular price"
    assert find(SALE_WORDS, "Snowfall") is None
    assert find(ORIGINAL_WORDS, "wash") is None


def test_percentages_and_plan_words():
    assert find(PERCENT, "Save 20% today") == "20%"
    assert find(PERCENT, "99.9% uptime") == "99.9%"
    assert find(PLAN_WORDS, "Pro Plan") == "Plan"
    assert find(PLAN_WORDS, "Planning") is None
