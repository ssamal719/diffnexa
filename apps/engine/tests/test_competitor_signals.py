"""The phrase patterns behind competitor signals.

These are the smallest pieces of the classifier, tested on their own so a
pattern change shows exactly which phrases it gained or lost.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.competitor.signals import (
    FEATURE_HEADINGS,
    FEATURE_PHRASES,
    PLAN_HEADINGS,
    PRICING_PHRASES,
    cta_phrase,
    find,
    find_money,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("$49", "$49"),
        ("From $1,299.00 a year", "$1,299.00"),
        ("€19 per seat", "€19"),
        ("₹999 per month", "₹999"),
        ("USD 10", "USD 10"),
        ("49 projects", None),
        ("Version 2.4", None),
    ],
)
def test_money_is_recognised_only_with_a_currency(text, expected):
    assert find_money(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("$49/mo", "49/mo"),
        ("Save 20% off", "20% off"),
        ("Billed Annually", "Billed Annually"),
        ("a 14-day trial", "14-day trial"),
        ("Start your free trial", "free trial"),
        ("No credit card required", "No credit card required"),
        ("Unlimited projects", None),
        ("Email support", None),
        ("Priority onboarding", None),
    ],
)
def test_pricing_wording(text, expected):
    """The phrase is returned as the page spells it, capital letters included."""
    assert find(PRICING_PHRASES, text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Start free trial", "Start free trial"),
        ("Get started", "Get started"),
        ("Sign up free", "Sign up free"),
        ("Book a demo", "Book a demo"),
        ("Request demo", "Request demo"),
        ("Contact sales", "Contact sales"),
        ("Try Acme free", "Try Acme free"),
        ("Buy now", "Buy now"),
        ("Learn more", "Learn more"),
        ("Contact us", None),
        ("blog", None),
        ("Our story", None),
        ("Read about how we started the company and how we got to where we are", None),
    ],
)
def test_call_to_action_wording(text, expected):
    assert cta_phrase(text) == expected


@pytest.mark.parametrize(
    ("heading", "plan", "feature"),
    [
        ("Plans", True, False),
        ("Choose your plan", True, False),
        ("Pricing", True, False),
        ("Enterprise tier", True, False),
        ("Features", False, True),
        ("Integrations", False, True),
        ("What's new", False, True),
        ("Changelog", False, True),
        ("Compare plans and features", True, True),
        ("About us", False, False),
        ("Explanation", False, False),  # "plan" inside a word is not a plan
        ("Planning your move", False, False),
    ],
)
def test_section_headings(heading, plan, feature):
    assert (find(PLAN_HEADINGS, heading) is not None) is plan
    assert (find(FEATURE_HEADINGS, heading) is not None) is feature


@pytest.mark.parametrize(
    ("text", "found"),
    [
        ("Acme now supports Outlook", True),
        ("New feature: shared views", True),
        ("Integrates with Slack", True),
        ("We support our customers", False),
    ],
)
def test_feature_announcements(text, found):
    assert (find(FEATURE_PHRASES, text) is not None) is found
