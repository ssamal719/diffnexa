"""Price categories attached to real comparisons.

Each test builds two versions of a small pricing or product page, runs the
ordinary webpage comparison, and checks the one category each change receives.

The promises under test:

* every change gets exactly one category and nothing is hidden;
* a number is a price only when the page marks it as money — "10 users",
  "a 14-day trial" and "99% uptime" never are;
* each category quotes text from the change's own evidence;
* no wording evaluates a price.
"""

from __future__ import annotations

import json
import re

import pytest

from diffnexa_engine.contracts.changes import ChangeCategory, Side
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.price import (
    PRICE_RULES_VERSION,
    PriceBasis,
    PriceCategory,
    PriceSignal,
    category_blurb,
    category_label,
    classify_change,
    classify_changes,
    describe_reason,
)
from diffnexa_engine.price.signals import CATEGORY_RULES
from diffnexa_engine.web.api import read_snapshot, serialize_snapshot
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot

URL = "https://shop.example.com/pricing"

P = PriceCategory


def page(body: str, title: str = "Acme Pricing", description: str = "Plans and prices.") -> str:
    return (
        f"<!doctype html><html><head><title>{title}</title>"
        f'<meta name="description" content="{description}"></head><body><main>{body}</main></body></html>'
    )


PRICING = (
    "<h1>Acme Pricing</h1>"
    "<p>All prices in USD.</p>"
    "<h2>Plans</h2>"
    "<h3>Starter</h3><p>$9 per month</p><ul><li>Up to 10 users</li><li>Email support</li></ul>"
    "<h3>Pro Plan</h3><p>$29 per month, billed annually</p><p>Was $39, now $29</p>"
    "<ul><li>Unlimited users</li><li>14-day trial</li></ul>"
    "<h3>Business</h3><p>Status: Available</p>"
    "<h2>About us</h2><p>We serve 12,000 teams with 99% uptime.</p>"
    '<p>Read our <a href="https://acme.example.com/blog">blog</a> for news.</p>'
)


def run(before: str, after: str, **page_kwargs):
    old = extract_snapshot(page(before), url=URL, fetched_at="2026-01-01T00:00:00+00:00")
    new = extract_snapshot(page(after, **page_kwargs), url=URL, fetched_at="2026-02-01T00:00:00+00:00")
    outcome = compare_snapshots_verbose(old, new)
    return outcome, classify_changes(outcome.result.changes, new, old), old, new


def categories(before: str, after: str, **page_kwargs) -> list[tuple[str, PriceCategory]]:
    outcome, classification, _old, _new = run(before, after, **page_kwargs)
    return [
        (change.new_value or change.old_value or "", classification.by_change[change.id].category)
        for change in outcome.result.changes
        if change.noise_reason is None
    ]


def only(before: str, after: str) -> PriceCategory:
    found = {category for _value, category in categories(before, after)}
    assert len(found) == 1, found
    return found.pop()


def single(before: str, after: str) -> tuple[PriceSignal, object]:
    outcome, classification, _old, _new = run(before, after)
    meaningful = [c for c in outcome.result.changes if c.noise_reason is None]
    assert len(meaningful) == 1, [(c.old_value, c.new_value) for c in meaningful]
    return classification.by_change[meaningful[0].id], meaningful[0]


def card(price: str, heading: str = "Pro") -> str:
    return (
        f"<h1>Acme</h1><h2>Plans</h2><h3>{heading}</h3><p>{price}</p><h2>About</h2><p>Founded in Leeds.</p>"
    )


# ---------------------------------------------------------------- the vocabulary


def test_there_are_nine_categories_in_the_agreed_order():
    assert [category_label(rules.category) for rules in CATEGORY_RULES] == [
        "Price",
        "Discount / Sale Price",
        "Original / Compare-at Price",
        "Currency",
        "Billing Period",
        "Product / Plan",
        "Availability",
        "Pricing Details",
        "Other Changes",
    ]


def test_the_rules_are_versioned():
    assert re.fullmatch(r"\d{4}\.\d{2}\.\d+", PRICE_RULES_VERSION)


EVALUATIVE = (
    "significant",
    "expensive",
    "cheap",
    "better",
    "worse",
    "good",
    "bad",
    "best",
    "great",
    "poor",
    "deal ",
    "undercut",
    "increase",
    "decrease",
    "rise",
    "drop",
    "higher",
    "lower",
)


def test_no_label_blurb_or_reason_evaluates_a_price():
    wording = [
        category_label(rules.category) + " " + category_blurb(rules.category) for rules in CATEGORY_RULES
    ]
    for basis in PriceBasis:
        wording.append(describe_reason(PriceSignal(P.PRICE, basis, "$29")))
    text = " ".join(wording).lower()
    for word in EVALUATIVE:
        assert not re.search(rf"\b{word.strip()}\b", text), word


# ---------------------------------------------------------------- prices and currencies


def test_the_same_page_produces_no_changes_and_no_categories():
    outcome, classification, _o, _n = run(PRICING, PRICING)
    assert outcome.result.changes == ()
    assert classification.by_change == {}
    assert classification.changed_categories() == ()


def test_a_monthly_price_change_is_a_price():
    signal, change = single(card("$29/month"), card("$39/month"))
    assert (change.old_value, change.new_value) == ("$29", "$39")
    assert change.delta, "the engine's own difference is kept, unchanged"
    assert signal.category is P.PRICE
    assert signal.basis is PriceBasis.MONEY
    assert signal.matched_text == "$39"


@pytest.mark.parametrize(
    ("before", "after", "quoted"),
    [
        ("$29", "$35", "$35"),
        ("$29.99", "$24.99", "$24.99"),
        ("€29", "€35", "€35"),
        ("€29.99", "€24.99", "€24.99"),
        ("£29", "£35", "£35"),
        ("£29.99", "£24.99", "£24.99"),
        ("₹2,499", "₹2,999", "₹2,999"),
        ("₹2499", "₹2999", "₹2999"),
        ("USD 29", "USD 35", "USD 35"),
        ("EUR 29", "EUR 35", "EUR 35"),
        ("GBP 29", "GBP 35", "GBP 35"),
        ("INR 2499", "INR 2999", "INR 2999"),
        ("29 USD", "35 USD", "35 USD"),
    ],
)
def test_prices_in_each_supported_format(before, after, quoted):
    # A block holding nothing but a price may be reported as one price replaced
    # by another (removed + added) rather than modified; either way, each is a price.
    outcome, classification, _o, _n = run(card(before), card(after))
    signals = [classification.by_change[change.id] for change in outcome.result.changes]
    assert signals, "the change is reported"
    assert {signal.category for signal in signals} == {P.PRICE}
    assert quoted in {signal.matched_text for signal in signals}


def test_a_currency_change_on_an_amount_is_a_currency_change():
    signal, _change = single(card("$29/month"), card("€29/month"))
    assert signal.category is P.CURRENCY
    assert signal.basis is PriceBasis.CURRENCY_CHANGED


def test_a_currency_named_on_its_own_is_a_currency_change():
    signal, change = single(PRICING, PRICING.replace("in USD.", "in EUR."))
    assert signal.category is P.CURRENCY
    assert signal.matched_text == "EUR"
    assert change.old_value == "USD."


def test_the_same_currency_written_differently_is_not_a_currency_change():
    assert only(card("Rs. 2,499"), card("₹2,499")) is not P.CURRENCY


# ---------------------------------------------------------------- sale and original prices


def test_a_sale_price_is_a_discount():
    signal, change = single(PRICING, PRICING.replace("now $29", "now $25"))
    assert (change.old_value, change.new_value) == ("$29", "$25")
    assert signal.category is P.DISCOUNT
    assert signal.matched_text == "now"


def test_an_original_price_is_an_original_price():
    signal, change = single(PRICING, PRICING.replace("Was $39", "Was $45"))
    assert (change.old_value, change.new_value) == ("$39", "$45")
    assert signal.category is P.ORIGINAL
    assert signal.matched_text == "Was"


def test_original_price_wording_belongs_only_to_the_amount_beside_it():
    """In "MRP ₹2,999 ₹1,999", MRP belongs to ₹2,999; ₹1,999 is just a price."""
    before, after = card("MRP ₹2,999 ₹1,999"), card("MRP ₹2,999 ₹1,799")
    assert only(before, after) is P.PRICE
    assert only(card("MRP ₹2,999 ₹1,999"), card("MRP ₹3,299 ₹1,999")) is P.ORIGINAL


def test_a_discount_percentage_is_a_discount():
    assert only(card("$29 — save 20% off"), card("$29 — save 25% off")) is P.DISCOUNT


# ---------------------------------------------------------------- billing, plans, availability


def test_a_billing_period_change_is_a_billing_period():
    signal, change = single(PRICING, PRICING.replace("$9 per month", "$9 per year"))
    assert (change.old_value, change.new_value) == ("month", "year")
    assert signal.category is P.BILLING


def test_billed_monthly_becoming_annually_is_a_billing_period():
    assert only(PRICING, PRICING.replace("billed annually", "billed monthly")) is P.BILLING


def test_a_period_toggle_in_a_plan_is_a_billing_period():
    toggle = (
        "<h1>Acme</h1><h2>Plans</h2><h3>Pro</h3><p>$29</p><p>{}</p><h2>About</h2><p>Founded in Leeds.</p>"
    )
    assert {category for _v, category in categories(toggle.format("Monthly"), toggle.format("Annual"))} == {
        P.BILLING
    }


def test_month_on_its_own_is_not_a_billing_period():
    before = "<h1>Acme</h1><h2>News</h2><p>Updated a month ago.</p>"
    after = "<h1>Acme</h1><h2>News</h2><p>Updated a year ago.</p>"
    assert only(before, after) is P.OTHER


def test_a_renamed_plan_is_a_product_or_plan_change():
    signal, change = single(PRICING, PRICING.replace("<h3>Pro Plan</h3>", "<h3>Business Plan</h3>"))
    assert (change.old_value, change.new_value) == ("Pro", "Business")
    assert signal.category is P.PRODUCT_PLAN


def test_a_renamed_product_with_its_price_under_it_is_a_product_change():
    before = "<h1>Acme Blender X200</h1><p>£89.99</p><p>In stock</p>"
    after = "<h1>Acme Blender X300</h1><p>£89.99</p><p>In stock</p>"
    signal, _change = single(before, after)
    assert signal.category is P.PRODUCT_PLAN
    assert signal.basis is PriceBasis.PRICED_HEADING


def test_available_becoming_contact_sales_is_availability():
    signal, change = single(PRICING, PRICING.replace("Status: Available", "Status: Contact sales"))
    assert (change.old_value, change.new_value) == ("Available", "Contact sales")
    assert signal.category is P.AVAILABILITY


def test_in_stock_becoming_out_of_stock_is_availability():
    before = "<h1>Acme Blender</h1><p>£89.99</p><p>In stock</p>"
    after = "<h1>Acme Blender</h1><p>£89.99</p><p>Out of stock</p>"
    signal, _change = single(before, after)
    assert signal.category is P.AVAILABILITY
    assert signal.matched_text == "Out of stock"


def test_availability_words_elsewhere_do_not_make_a_number_availability():
    before = "<h1>Acme</h1><h2>News</h2><p>Now available in 30 languages.</p>"
    after = "<h1>Acme</h1><h2>News</h2><p>Now available in 40 languages.</p>"
    assert only(before, after) is P.OTHER


# ---------------------------------------------------------------- pricing tables

TABLE = (
    "<h1>Acme</h1><h2>Compare</h2><table>"
    "<tr><th>Plan</th><th>Price (USD)</th><th>Seats</th></tr>"
    "<tr><td>Starter</td><td>{starter}</td><td>{seats}</td></tr>"
    "<tr><td>Pro</td><td>$29</td><td>25</td></tr></table>"
)


def test_a_number_in_a_price_column_is_a_price():
    signal, _change = single(TABLE.format(starter="9", seats="5"), TABLE.format(starter="12", seats="5"))
    assert signal.category is P.PRICE
    assert signal.basis is PriceBasis.PRICE_COLUMN


def test_a_number_in_another_column_of_a_price_table_is_not_a_price():
    signal, _change = single(TABLE.format(starter="9", seats="5"), TABLE.format(starter="9", seats="10"))
    assert signal.category is P.PRICING_DETAILS


def test_a_renamed_plan_column_is_a_product_or_plan_change():
    grid = (
        "<h1>Acme</h1><table><tr><th>Plan</th><th>{name}</th></tr><tr><td>Price</td><td>$29</td></tr></table>"
    )
    assert only(grid.format(name="Pro"), grid.format(name="Business")) is P.PRODUCT_PLAN


# ---------------------------------------------------------------- not prices


def test_an_ordinary_number_is_not_a_price():
    signal, change = single(PRICING, PRICING.replace("12,000 teams", "15,000 teams"))
    assert change.category is ChangeCategory.NUMBER
    assert signal.category is P.OTHER


def test_ten_users_is_not_a_price():
    signal, change = single(PRICING, PRICING.replace("Up to 10 users", "Up to 25 users"))
    assert (change.old_value, change.new_value) == ("10", "25")
    assert signal.category is not P.PRICE
    assert signal.category is P.PRICING_DETAILS  # it sits in a plan, beside a price


def test_a_fourteen_day_trial_is_not_a_price():
    signal, _change = single(PRICING, PRICING.replace("14-day trial", "30-day trial"))
    assert signal.category not in (P.PRICE, P.DISCOUNT, P.ORIGINAL, P.BILLING)


def test_ninety_nine_percent_uptime_is_not_a_price_or_discount():
    signal, _change = single(PRICING, PRICING.replace("99% uptime", "99.9% uptime"))
    assert signal.category is P.OTHER


def test_numbers_with_no_currency_are_never_prices_outside_a_price_column():
    for text in ("Up to 10 users", "5 GB storage", "30 projects", "24/7 support", "2 hours a week"):
        bumped = re.sub(r"\d+", lambda m: str(int(m.group(0)) + 1), text, count=1)
        before = f"<h1>Acme</h1><h2>Plans</h2><h3>Pro</h3><p>$29/month</p><p>{text}</p>"
        after = f"<h1>Acme</h1><h2>Plans</h2><h3>Pro</h3><p>$29/month</p><p>{bumped}</p>"
        found = {category for _v, category in categories(before, after)}
        assert P.PRICE not in found and P.DISCOUNT not in found and P.ORIGINAL not in found, (text, found)


# ---------------------------------------------------------------- nothing hidden


def test_ordinary_text_changes_remain_visible():
    assert categories(PRICING, PRICING.replace("for news", "for product updates"))


def test_ordinary_link_changes_remain_visible():
    outcome, classification, _o, _n = run(PRICING, PRICING.replace("/blog", "/news"))
    [change] = outcome.result.changes
    assert change.category is ChangeCategory.LINK
    assert classification.by_change[change.id].category is P.OTHER


def test_metadata_changes_remain_visible():
    outcome, classification, _o, _n = run(PRICING, PRICING, title="Acme Pricing 2026")
    [change] = outcome.result.changes
    assert change.category is ChangeCategory.METADATA
    assert classification.by_change[change.id].category is P.OTHER


MIXED = (
    PRICING.replace("$9 per month", "$12 per month")
    .replace("now $29", "now $25")
    .replace("Status: Available", "Status: Contact sales")
    .replace("<h3>Pro Plan</h3>", "<h3>Growth Plan</h3>")
    .replace("in USD.", "in EUR.")
    .replace("12,000 teams", "15,000 teams")
    .replace("/blog", "/news")
)


def test_every_change_gets_exactly_one_category_and_none_is_lost():
    outcome, classification, _o, _n = run(PRICING, MIXED)
    assert sorted(classification.by_change) == sorted(change.id for change in outcome.result.changes)
    meaningful = [change for change in outcome.result.changes if change.noise_reason is None]
    grouped = [cid for category in PriceCategory for cid in classification.change_ids_for(category)]
    assert sorted(grouped) == sorted(change.id for change in meaningful)
    assert sum(classification.counts().values()) == len(meaningful)


def test_a_mixed_page_reaches_the_expected_categories():
    _outcome, classification, _o, _n = run(PRICING, MIXED)
    assert set(classification.changed_categories()) == {
        P.PRICE,
        P.DISCOUNT,
        P.CURRENCY,
        P.PRODUCT_PLAN,
        P.AVAILABILITY,
        P.OTHER,
    }


def test_classification_never_alters_a_change_and_evidence_stays_valid():
    outcome, _classification, old, new = run(PRICING, MIXED)
    before = [change.model_dump() for change in outcome.result.changes]
    classify_changes(outcome.result.changes, new, old)
    assert [change.model_dump() for change in outcome.result.changes] == before
    assert verify_web_traceability(outcome.result.changes, old, new) == []


def test_every_category_quotes_text_from_its_own_evidence():
    outcome, classification, old, new = run(PRICING, MIXED)
    snapshots = {Side.OLD: old, Side.NEW: new}
    for change in outcome.result.changes:
        found = classification.by_change[change.id]
        if not found.matched_text:
            assert found.category is P.OTHER
            continue
        available = [change.old_value or "", change.new_value or "", change.label or ""]
        for evidence in change.evidence:
            available += [evidence.excerpt or "", *evidence.section_path]
            if evidence.node_id:
                available.append(snapshots[evidence.side].node_index()[evidence.node_id].text)
        assert found.matched_text in " ".join(available), (change.id, found)


def test_classification_is_deterministic():
    first = run(PRICING, MIXED)[1].by_change
    for _ in range(3):
        assert run(PRICING, MIXED)[1].by_change == first


def test_a_single_change_classifies_the_same_on_its_own():
    outcome, classification, old, new = run(PRICING, MIXED)
    for change in outcome.result.changes:
        assert classify_change(change, {Side.OLD: old, Side.NEW: new}) == classification.by_change[change.id]


def test_a_snapshot_survives_a_round_trip_through_a_file():
    """What the person downloads, uploaded again, compares exactly as the original."""
    captured = extract_snapshot(page(PRICING), url=URL, fetched_at="2026-01-01T00:00:00+00:00")
    text = json.dumps(serialize_snapshot(captured))
    restored = read_snapshot(json.loads(text))
    assert restored.content_sha256 == captured.content_sha256
    assert compare_snapshots_verbose(restored, captured).result.changes == ()
    assert read_snapshot(text).content_sha256 == captured.content_sha256


def test_a_cloudflare_email_token_is_still_not_a_change():
    link = (
        "<h1>Acme</h1><h2>Contact</h2>"
        '<p>Email <a href="/cdn-cgi/l/email-protection#{}">[email protected]</a> for a quote.</p>'
    )
    before = link.format("385156e55778575c514b505952575a4b5c5d4b53165156")
    after = link.format("41282f272e012e25283229202b2e23322524322a6f282f")
    assert categories(before, after) == []
