"""Competitor signals attached to real comparisons.

Each test builds two versions of a small competitor page, runs the ordinary
webpage comparison, and checks the one signal each change receives. The rules
under test are the product's promises:

* every change gets exactly one signal, and nothing is hidden;
* no signal exists without a change the engine proved;
* each signal quotes text that is in the change's own evidence;
* when no rule clearly applies, the answer is Other, not a guess;
* no wording ranks, scores or characterises a change.
"""

from __future__ import annotations

import re

import pytest

from diffnexa_engine.competitor import (
    COMPETITOR_SIGNALS_VERSION,
    CompetitorSignal,
    SignalBasis,
    classify_change,
    classify_changes,
    describe_reason,
    describe_signal_for_reader,
    signal_blurb,
    signal_label,
)
from diffnexa_engine.competitor.signals import SIGNAL_RULES, cta_phrase
from diffnexa_engine.contracts.changes import ChangeCategory, Side
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.web.compare import compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot

URL = "https://acme.example.com/pricing"


def page(body: str, title: str = "Acme Pricing", description: str = "Plans for every team.") -> str:
    return (
        f"<!doctype html><html><head><title>{title}</title>"
        f'<meta name="description" content="{description}"></head><body><main>{body}</main></body></html>'
    )


PRICING_PAGE = (
    "<h1>Project management for teams</h1>"
    "<p>Plan, track and ship work in one place.</p>"
    '<a class="button" href="https://acme.example.com/signup">Start free trial</a>'
    "<h2>Plans</h2>"
    "<h3>Starter</h3><p>$9 per month</p><ul><li>5 projects</li><li>Email support</li></ul>"
    "<h3>Pro</h3><p>$29 per month</p><ul><li>Unlimited projects</li><li>Priority support</li></ul>"
    "<h2>Features</h2><ul><li>Kanban boards</li><li>Gantt charts</li></ul>"
    "<h2>About us</h2><p>We were founded in 2015 by two engineers in Berlin.</p>"
    '<p>Read our <a href="https://acme.example.com/blog">blog</a> for updates.</p>'
)


def run(before: str, after: str, *, wrap: bool = True):
    old = extract_snapshot(page(before) if wrap else before, url=URL, fetched_at="2026-01-01T00:00:00+00:00")
    new = extract_snapshot(page(after) if wrap else after, url=URL, fetched_at="2026-02-01T00:00:00+00:00")
    outcome = compare_snapshots_verbose(old, new)
    classification = classify_changes(outcome.result.changes, new, old)
    return outcome, classification, old, new


def signals(before: str, after: str, **kwargs) -> list[tuple[str, CompetitorSignal]]:
    outcome, classification, _old, _new = run(before, after, **kwargs)
    return [
        (change.new_value or change.old_value or "", classification.by_change[change.id].signal)
        for change in outcome.result.changes
        if change.noise_reason is None
    ]


def only(before: str, after: str) -> CompetitorSignal:
    found = {signal for _value, signal in signals(before, after)}
    assert len(found) == 1, found
    return found.pop()


# ---------------------------------------------------------------- the taxonomy


def test_there_are_exactly_nine_signals_in_the_agreed_order():
    assert [signal_label(rules.signal) for rules in SIGNAL_RULES] == [
        "Pricing & Commercial",
        "Product & Features",
        "Messaging & Positioning",
        "Plans & Packaging",
        "Calls to Action",
        "Content & Sections",
        "Links & Destinations",
        "SEO & Metadata",
        "Other",
    ]
    assert len(CompetitorSignal) == 9


def test_the_signals_are_versioned():
    assert re.fullmatch(r"\d{4}\.\d{2}\.\d+", COMPETITOR_SIGNALS_VERSION)


FORBIDDEN = (
    "important",
    "critical",
    "major",
    "threat",
    "risk",
    "opportunit",
    "better",
    "worse",
    "good",
    "bad",
    "strategic",
    "winning",
    "losing",
    "aggressive",
    "weak",
    "strong",
    "intent",
    "significant",
)


def test_no_label_blurb_or_reason_judges_a_change():
    wording = [signal_label(rules.signal) for rules in SIGNAL_RULES]
    wording += [signal_blurb(rules.signal) for rules in SIGNAL_RULES]
    from diffnexa_engine.competitor.classify import ChangeSignal

    for basis in SignalBasis:
        found = ChangeSignal(CompetitorSignal.OTHER, basis, "Example")
        wording += [describe_reason(found), describe_signal_for_reader(found)]
    text = " ".join(wording).lower()
    for word in FORBIDDEN:
        assert not re.search(rf"\b{word}", text), word


def test_the_reader_wording_names_a_location_only():
    outcome, classification, _o, _n = run(PRICING_PAGE, PRICING_PAGE.replace("$9 per", "$12 per"))
    found = classification.by_change[outcome.result.changes[0].id]
    assert describe_signal_for_reader(found) == "Touches Pricing & Commercial"


# ---------------------------------------------------------------- pricing


def test_a_changed_price_touches_pricing():
    outcome, classification, _o, _n = run(PRICING_PAGE, PRICING_PAGE.replace("$9 per", "$12 per"))
    [change] = outcome.result.changes
    found = classification.by_change[change.id]
    assert (change.old_value, change.new_value) == ("$9", "$12")
    assert change.delta, "the engine's own delta is kept"
    assert found.signal is CompetitorSignal.PRICING
    assert found.basis is SignalBasis.MONEY_VALUE
    assert found.matched_text == "$12"


def test_an_unchanged_price_produces_no_pricing_signal():
    after = PRICING_PAGE.replace("Kanban boards", "Kanban and list boards")
    found = signals(PRICING_PAGE, after)
    assert found, "the feature wording change is still reported"
    assert CompetitorSignal.PRICING not in {signal for _value, signal in found}


def test_billing_wording_touches_pricing():
    before = "<h1>Acme</h1><h2>Plans</h2><p>All plans are billed monthly.</p>"
    after = "<h1>Acme</h1><h2>Plans</h2><p>All plans are billed annually.</p>"
    assert only(before, after) is CompetitorSignal.PRICING


def test_a_discount_percentage_touches_pricing_through_the_words_beside_it():
    before = "<h1>Acme</h1><h2>Offers</h2><p>Save 20% off when you pay yearly.</p>"
    after = "<h1>Acme</h1><h2>Offers</h2><p>Save 25% off when you pay yearly.</p>"
    assert only(before, after) is CompetitorSignal.PRICING


def test_a_trial_length_touches_pricing():
    before = (
        "<h1>Acme</h1><h2>Getting started</h2><p>Every account starts with a 14-day trial of all tools.</p>"
    )
    after = (
        "<h1>Acme</h1><h2>Getting started</h2><p>Every account starts with a 30-day trial of all tools.</p>"
    )
    assert only(before, after) is CompetitorSignal.PRICING


def test_a_number_away_from_any_price_is_not_claimed_as_pricing():
    """ "5 projects" sits under a plan; it is packaging, not a price."""
    after = PRICING_PAGE.replace("5 projects", "10 projects")
    assert only(PRICING_PAGE, after) is CompetitorSignal.PLANS


def test_a_table_cell_under_a_price_heading_touches_pricing():
    table = (
        "<h1>Acme</h1><h2>Compare</h2><table><tr><th>Plan</th><th>Monthly price</th></tr>"
        "<tr><td>Starter</td><td>{starter}</td></tr><tr><td>Pro</td><td>29</td></tr></table>"
    )
    assert only(table.format(starter="9"), table.format(starter="12")) is CompetitorSignal.PRICING


def test_no_currency_conversion_or_period_is_inferred():
    """The engine's own values and delta are passed through; nothing is converted."""
    outcome, classification, _o, _n = run(PRICING_PAGE, PRICING_PAGE.replace("$9 per", "€9 per"))
    for change in outcome.result.changes:
        found = classification.by_change[change.id]
        assert found.signal is CompetitorSignal.PRICING
        assert found.matched_text in (change.old_value or "") + (change.new_value or "")
        assert "month" not in found.matched_text.lower()


# ---------------------------------------------------------------- features


def test_an_added_feature_touches_features():
    after = PRICING_PAGE.replace("<li>Gantt charts</li>", "<li>Gantt charts</li><li>Time tracking</li>")
    assert signals(PRICING_PAGE, after) == [("Time tracking", CompetitorSignal.FEATURES)]


def test_a_removed_feature_touches_features():
    after = PRICING_PAGE.replace("<li>Gantt charts</li>", "")
    assert signals(PRICING_PAGE, after) == [("Gantt charts", CompetitorSignal.FEATURES)]


def test_wording_that_announces_a_feature_touches_features_anywhere():
    before = "<h1>Acme</h1><h2>News</h2><p>Acme works with your calendar.</p>"
    after = "<h1>Acme</h1><h2>News</h2><p>Acme now supports Outlook calendars.</p>"
    assert only(before, after) is CompetitorSignal.FEATURES


def test_an_integrations_section_counts_as_features():
    before = "<h1>Acme</h1><h2>Integrations</h2><ul><li>Slack</li></ul>"
    after = "<h1>Acme</h1><h2>Integrations</h2><ul><li>Slack</li><li>Microsoft Teams</li></ul>"
    assert only(before, after) is CompetitorSignal.FEATURES


# ---------------------------------------------------------------- plans


def test_an_added_plan_touches_plans():
    after = PRICING_PAGE.replace(
        "<h2>Features</h2>", "<h3>Enterprise</h3><ul><li>Dedicated manager</li></ul><h2>Features</h2>"
    )
    found = signals(PRICING_PAGE, after)
    assert ("Enterprise", CompetitorSignal.PLANS) in found
    assert {signal for _value, signal in found} == {CompetitorSignal.PLANS}


def test_a_removed_plan_touches_plans():
    after = PRICING_PAGE.replace(
        "<h3>Pro</h3><p>$29 per month</p><ul><li>Unlimited projects</li><li>Priority support</li></ul>", ""
    )
    found = dict(signals(PRICING_PAGE, after))
    assert found["Pro"] is CompetitorSignal.PLANS
    # The price that disappeared with the plan is still reported, as a price.
    assert found["$29 per month"] is CompetitorSignal.PRICING


def test_a_renamed_plan_touches_plans():
    before = "<h1>Acme</h1><h2>Choose a plan</h2><h3>Standard Plan</h3><p>For small teams.</p>"
    after = "<h1>Acme</h1><h2>Choose a plan</h2><h3>Professional Plan</h3><p>For small teams.</p>"
    outcome, classification, _o, _n = run(before, after)
    [change] = [c for c in outcome.result.changes if c.noise_reason is None]
    found = classification.by_change[change.id]
    assert found.signal is CompetitorSignal.PLANS
    assert found.basis is SignalBasis.HEADING_TEXT


def test_plan_names_are_never_invented():
    """A plan signal quotes a heading the page has; it does not name a plan itself."""
    after = PRICING_PAGE.replace("<li>Priority support</li>", "<li>Priority support</li><li>SSO</li>")
    outcome, classification, old, new = run(PRICING_PAGE, after)
    [change] = outcome.result.changes
    found = classification.by_change[change.id]
    assert found.signal is CompetitorSignal.PLANS
    headings = {node.text for node in new.nodes} | {node.text for node in old.nodes}
    assert found.matched_text in headings


def test_a_heading_naming_both_plans_and_features_is_plans():
    before = "<h1>Acme</h1><h2>Compare plans and features</h2><ul><li>Audit log</li></ul>"
    after = "<h1>Acme</h1><h2>Compare plans and features</h2><ul><li>Audit log</li><li>SAML</li></ul>"
    assert only(before, after) is CompetitorSignal.PLANS


def test_a_table_column_named_for_a_plan_touches_plans():
    table = (
        "<h1>Acme</h1><h2>Compare</h2><table><tr><th>Capability</th><th>Pro plan</th></tr>"
        "<tr><td>Seats</td><td>{seats}</td></tr></table>"
    )
    assert only(table.format(seats="10"), table.format(seats="25")) is CompetitorSignal.PLANS


# ---------------------------------------------------------------- calls to action


def test_a_changed_call_to_action_touches_calls_to_action():
    after = PRICING_PAGE.replace(">Start free trial<", ">Book a demo<")
    found = signals(PRICING_PAGE, after)
    assert found, "the link change is reported"
    assert {signal for _value, signal in found} == {CompetitorSignal.CTA}


def test_a_call_to_action_with_a_new_destination_touches_calls_to_action():
    after = PRICING_PAGE.replace("acme.example.com/signup", "acme.example.com/signup/pro")
    outcome, classification, _o, _n = run(PRICING_PAGE, after)
    [change] = outcome.result.changes
    assert change.category is ChangeCategory.LINK
    found = classification.by_change[change.id]
    assert found.signal is CompetitorSignal.CTA
    assert found.matched_text == "Start free trial"


def test_a_button_inside_a_list_item_is_recognised_by_its_link():
    before = '<h1>Acme</h1><h2>Start</h2><ul><li><a href="https://acme.example.com/a">Sign up</a></li></ul>'
    after = (
        '<h1>Acme</h1><h2>Start</h2><ul><li><a href="https://acme.example.com/a">Get started</a></li></ul>'
    )
    assert {signal for _value, signal in signals(before, after)} == {CompetitorSignal.CTA}


def test_call_to_action_words_in_ordinary_prose_are_not_a_call_to_action():
    """No link, no call to action: the DOM has to say the words are clickable."""
    before = "<h1>Acme</h1><h2>Support</h2><p>Sign up for our newsletter at the front desk.</p>"
    after = "<h1>Acme</h1><h2>Support</h2><p>Sign up for our newsletter at the reception desk.</p>"
    assert only(before, after) is CompetitorSignal.CONTENT


def test_a_long_link_is_not_a_call_to_action():
    assert cta_phrase("Learn more about how we started the company and grew it over the years") is None
    assert cta_phrase("Learn more") == "Learn more"


# ---------------------------------------------------------------- links


def test_an_ordinary_link_change_touches_links():
    after = PRICING_PAGE.replace("acme.example.com/blog", "acme.example.com/news")
    outcome, classification, _o, _n = run(PRICING_PAGE, after)
    [change] = outcome.result.changes
    found = classification.by_change[change.id]
    assert found.signal is CompetitorSignal.LINKS
    assert found.matched_text == "blog"


def test_an_unchanged_link_produces_nothing():
    outcome, classification, _o, _n = run(PRICING_PAGE, PRICING_PAGE)
    assert outcome.result.changes == ()
    assert classification.by_change == {}
    assert classification.changed_signals() == ()


def test_a_tracking_parameter_is_not_a_link_change():
    after = PRICING_PAGE.replace("acme.example.com/blog", "acme.example.com/blog?utm_source=ad")
    assert signals(PRICING_PAGE, after) == []


# ---------------------------------------------------------------- messaging and metadata


def test_a_changed_main_heading_touches_messaging():
    after = PRICING_PAGE.replace("for teams</h1>", "for growing teams</h1>")
    assert only(PRICING_PAGE, after) is CompetitorSignal.MESSAGING


def test_the_opening_text_touches_messaging():
    after = PRICING_PAGE.replace("in one place.", "in a single workspace.")
    assert only(PRICING_PAGE, after) is CompetitorSignal.MESSAGING


def test_a_page_without_an_h1_leads_with_its_first_h2():
    before = "<h2>Ship faster</h2><p>Tools for engineers.</p><h2>Details</h2><p>Some text here.</p>"
    after = "<h2>Ship safer</h2><p>Tools for engineers.</p><h2>Details</h2><p>Some text here.</p>"
    assert only(before, after) is CompetitorSignal.MESSAGING


def test_the_main_heading_does_not_turn_every_section_into_plans():
    """A page titled for plans still has an About section that is just content."""
    before = "<h1>Simple plans for every team</h1><h2>About us</h2><p>Founded in 2015 in Berlin.</p>"
    after = "<h1>Simple plans for every team</h1><h2>About us</h2><p>Founded in 2016 in Berlin.</p>"
    assert only(before, after) is CompetitorSignal.CONTENT


def test_a_changed_title_touches_seo_and_metadata():
    old = extract_snapshot(page(PRICING_PAGE), url=URL, fetched_at="2026-01-01T00:00:00+00:00")
    new = extract_snapshot(
        page(PRICING_PAGE, title="Acme Pricing and Plans", description="Pricing for every team."),
        url=URL,
        fetched_at="2026-02-01T00:00:00+00:00",
    )
    outcome = compare_snapshots_verbose(old, new)
    classification = classify_changes(outcome.result.changes, new, old)
    assert len(outcome.result.changes) == 2
    for change in outcome.result.changes:
        assert classification.by_change[change.id].signal is CompetitorSignal.SEO
        assert classification.by_change[change.id].basis is SignalBasis.METADATA_FIELD


# ---------------------------------------------------------------- content and other


def test_an_ordinary_section_change_touches_content():
    after = PRICING_PAGE.replace("two engineers", "three engineers")
    assert only(PRICING_PAGE, after) is CompetitorSignal.CONTENT


def test_a_new_ordinary_section_touches_content():
    after = PRICING_PAGE.replace(
        "<h2>About us</h2>", "<h2>Careers</h2><p>We are hiring.</p><h2>About us</h2>"
    )
    assert {signal for _value, signal in signals(PRICING_PAGE, after)} == {CompetitorSignal.CONTENT}


def test_a_change_no_rule_describes_is_other():
    """Text before any heading, with no price, link or feature wording: not recognised."""
    before = "<p>Welcome to the site of a small company.</p><p>Opening hours vary.</p>"
    after = "<p>Welcome to the site of a small business.</p><p>Opening hours vary.</p>"
    outcome, classification, _o, _n = run(before, after)
    [change] = outcome.result.changes
    found = classification.by_change[change.id]
    assert found.signal is CompetitorSignal.OTHER
    assert found.basis is SignalBasis.NONE
    assert found.matched_text == ""
    assert describe_reason(found) == "no category clearly describes this change"


# ---------------------------------------------------------------- the guarantees


MIXED = (
    PRICING_PAGE.replace("$9 per", "$12 per")
    .replace("<li>Gantt charts</li>", "<li>Gantt charts</li><li>Time tracking</li>")
    .replace(">Start free trial<", ">Book a demo<")
    .replace("for teams</h1>", "for growing teams</h1>")
    .replace("acme.example.com/blog", "acme.example.com/news")
    .replace("two engineers", "three engineers")
)


def test_every_change_gets_exactly_one_signal_and_none_is_lost():
    outcome, classification, _o, _n = run(PRICING_PAGE, MIXED)
    ids = [change.id for change in outcome.result.changes]
    assert sorted(classification.by_change) == sorted(ids)
    total = sum(classification.counts().values())
    meaningful = [change for change in outcome.result.changes if change.noise_reason is None]
    assert total == len(meaningful)
    grouped = [cid for signal in CompetitorSignal for cid in classification.change_ids_for(signal)]
    assert sorted(grouped) == sorted(change.id for change in meaningful)


def test_a_mixed_page_reaches_many_signals():
    outcome, classification, _o, _n = run(PRICING_PAGE, MIXED)
    assert set(classification.changed_signals()) == {
        CompetitorSignal.PRICING,
        CompetitorSignal.FEATURES,
        CompetitorSignal.MESSAGING,
        CompetitorSignal.CTA,
        CompetitorSignal.CONTENT,
        CompetitorSignal.LINKS,
    }


def test_classification_never_alters_the_changes():
    outcome, _classification, old, new = run(PRICING_PAGE, MIXED)
    before = [change.model_dump() for change in outcome.result.changes]
    classify_changes(outcome.result.changes, new, old)
    assert [change.model_dump() for change in outcome.result.changes] == before
    assert verify_web_traceability(outcome.result.changes, old, new) == []


def test_every_signal_quotes_text_from_its_own_evidence():
    outcome, classification, old, new = run(PRICING_PAGE, MIXED)
    snapshots = {Side.OLD: old, Side.NEW: new}
    for change in outcome.result.changes:
        found = classification.by_change[change.id]
        if found.signal is CompetitorSignal.OTHER:
            continue
        available = [change.old_value or "", change.new_value or "", change.label or ""]
        for evidence in change.evidence:
            available += [evidence.excerpt or "", *evidence.section_path]
            if evidence.node_id:
                available.append(snapshots[evidence.side].node_index()[evidence.node_id].text)
        assert found.matched_text, change.id
        assert found.matched_text in " ".join(available), (change.id, found)
        assert change.evidence, "every signalled change carries evidence"


def test_no_signal_exists_without_a_change():
    outcome, classification, _o, _n = run(PRICING_PAGE, PRICING_PAGE)
    assert outcome.result.changes == ()
    assert classification.counts() == {signal: 0 for signal in CompetitorSignal}


def test_classification_is_deterministic():
    first = run(PRICING_PAGE, MIXED)[1].by_change
    for _ in range(3):
        assert run(PRICING_PAGE, MIXED)[1].by_change == first


def test_a_single_change_can_be_classified_on_its_own():
    outcome, classification, old, new = run(PRICING_PAGE, MIXED)
    for change in outcome.result.changes:
        alone = classify_change(change, {Side.OLD: old, Side.NEW: new})
        assert alone == classification.by_change[change.id]


def test_without_the_pages_nothing_is_claimed_from_structure():
    """Classification without the captures still works, and never guesses a section."""
    outcome, _classification, _old, _new = run(PRICING_PAGE, MIXED)
    for change in outcome.result.changes:
        found = classify_change(change)
        assert found.signal in CompetitorSignal


@pytest.mark.parametrize(
    ("before_token", "after_token"),
    [
        ("385156e55778575c514b505952575a4b5c5d4b53165156", "41282f272e012e25283229202b2e23322524322a6f282f"),
    ],
)
def test_a_cloudflare_email_token_is_still_not_a_change(before_token, after_token):
    link = '<h2>Contact</h2><p>Email <a href="/cdn-cgi/l/email-protection#{}">[email protected]</a></p>'
    assert signals(link.format(before_token), link.format(after_token)) == []
