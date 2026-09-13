"""Clause signals: what they recognise, and what they must not.

A signal says where a piece of text sits in an agreement — fees, cancellation,
liability — so a reader can see whether anything they care about moved. It never
says whether a change is good or bad for them; that is a legal judgement this
product has no basis for making, and a test below enforces the distinction in
the wording itself.

The false-positive tests carry the most weight. Marking ordinary prose as a
liability clause would train a reader to ignore the signals, which is worse than
having none.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.policy.signals import (
    CLAUSE_SIGNALS_VERSION,
    TOPIC_RULES,
    TOPICS_BY_ID,
    ClauseTopic,
    SignalSource,
    describe_topic,
    signals_for,
    topic_blurb,
    topics_for,
)

# ---------------------------------------------------------------- the rule set


def test_every_topic_has_rules_a_label_and_a_blurb():
    assert len(TOPIC_RULES) == len(ClauseTopic)
    for topic in ClauseTopic:
        rules = TOPICS_BY_ID[topic]
        assert rules.phrases, f"{topic} has no phrases"
        assert len(rules.label) > 2
        assert len(rules.blurb) > 20


def test_the_rules_are_versioned():
    assert CLAUSE_SIGNALS_VERSION


def test_no_topic_relies_on_a_single_common_word():
    """A bare word such as 'fees' or 'data' appears everywhere and signals nothing."""
    bare = {"fee", "fees", "data", "price", "cancel", "liability", "notice", "rights", "terms"}
    for rules in TOPIC_RULES:
        for phrase in rules.phrases:
            assert phrase.strip().lower() not in bare, f"{rules.topic}: {phrase!r} is too broad"
            assert len(phrase) > 6, f"{rules.topic}: {phrase!r} is too short to be specific"


def test_the_wording_describes_location_never_judgement():
    """Signals say what a clause is about, not whether it is good for you."""
    wording = " ".join(f"{rules.label} {rules.blurb}" for rules in TOPIC_RULES).lower()
    for judgement in ("unfair", "worse", "better", "risky", "dangerous", "harmful", "you should"):
        assert judgement not in wording


# ---------------------------------------------------------------- recognition


@pytest.mark.parametrize(
    "topic, text",
    [
        (ClauseTopic.LIABILITY, "Our total liability shall not exceed the fees paid in the last year."),
        (ClauseTopic.LIABILITY, "In no event will we be liable for any consequential loss."),
        (ClauseTopic.LIABILITY, "You agree to indemnify us against any third-party claim."),
        (ClauseTopic.WARRANTIES, "The service is provided as is, without warranties of any kind."),
        (ClauseTopic.WARRANTIES, "We disclaim all warranties, including fitness for a particular purpose."),
        (ClauseTopic.FEES_AND_PRICING, "We may change our pricing on thirty days notice."),
        (ClauseTopic.FEES_AND_PRICING, "The subscription fee is charged annually in advance."),
        (ClauseTopic.PAYMENT_TERMS, "Payment is due within 30 days of invoice."),
        (ClauseTopic.PAYMENT_TERMS, "Late payment may result in suspension."),
        (ClauseTopic.REFUNDS, "All fees are non-refundable."),
        (ClauseTopic.REFUNDS, "Our refund policy is set out below."),
        (ClauseTopic.CANCELLATION, "You may cancel your subscription at any time."),
        (ClauseTopic.CANCELLATION, "Either party may terminate this agreement on 60 days notice."),
        (ClauseTopic.AUTO_RENEWAL, "Your plan renews automatically for a further twelve months."),
        (ClauseTopic.AUTO_RENEWAL, "The subscription will auto-renew unless you cancel."),
        (ClauseTopic.DATA_RETENTION, "We retain your data for 24 months after closure."),
        (ClauseTopic.DATA_RETENTION, "Our retention period for logs is ninety days."),
        (ClauseTopic.DATA_SHARING, "We share your information with third-party processors."),
        (ClauseTopic.DATA_SHARING, "Personal data may be transferred outside the United Kingdom."),
        (ClauseTopic.PRIVACY_RIGHTS, "You have the right to erasure of your personal data."),
        (ClauseTopic.PRIVACY_RIGHTS, "You may withdraw consent at any time."),
        (ClauseTopic.LICENCE_AND_IP, "You grant us a non-exclusive licence to host your content."),
        (ClauseTopic.LICENCE_AND_IP, "All intellectual property rights remain with the supplier."),
        (ClauseTopic.ACCEPTABLE_USE, "Prohibited conduct includes scraping the service."),
        (ClauseTopic.ACCEPTABLE_USE, "We may suspend your account for breach of these terms."),
        (ClauseTopic.GOVERNING_LAW, "This agreement is governed by the laws of England and Wales."),
        (ClauseTopic.GOVERNING_LAW, "The courts of Singapore shall have exclusive jurisdiction."),
        (ClauseTopic.DISPUTE_RESOLUTION, "Any dispute shall be resolved by binding arbitration."),
        (ClauseTopic.DISPUTE_RESOLUTION, "You waive any right to a jury trial."),
    ],
)
def test_real_clauses_are_recognised(topic, text):
    assert topic in topics_for(text), f"{topic} not found in {text!r}"


def test_every_topic_is_reachable():
    """A topic no wording can trigger would be a promise the product cannot keep."""
    covered = {
        ClauseTopic.LIABILITY: "Our total liability shall not exceed 1,000.",
        ClauseTopic.WARRANTIES: "Provided as is, without warranties.",
        ClauseTopic.FEES_AND_PRICING: "We may change our pricing.",
        ClauseTopic.PAYMENT_TERMS: "Payment terms are net thirty.",
        ClauseTopic.REFUNDS: "No refunds are given.",
        ClauseTopic.CANCELLATION: "You may cancel your account.",
        ClauseTopic.AUTO_RENEWAL: "The plan will automatically renew.",
        ClauseTopic.DATA_RETENTION: "Our data retention rules apply.",
        ClauseTopic.DATA_SHARING: "We share your data with partners.",
        ClauseTopic.PRIVACY_RIGHTS: "You have the right to access your data.",
        ClauseTopic.LICENCE_AND_IP: "You grant us a licence to use it.",
        ClauseTopic.ACCEPTABLE_USE: "Acceptable use rules apply.",
        ClauseTopic.GOVERNING_LAW: "Governed by the laws of Ireland.",
        ClauseTopic.DISPUTE_RESOLUTION: "Dispute resolution is by mediation.",
    }
    assert set(covered) == set(ClauseTopic), "a topic has no example"
    for topic, text in covered.items():
        assert topic in topics_for(text), f"{topic} cannot be triggered"


# ---------------------------------------------------------------- false positives


@pytest.mark.parametrize(
    "text",
    [
        "Our chefs price each dish carefully to reflect the cost of ingredients.",
        "The data in this chart comes from the national statistics office.",
        "Cancel your alarm by pressing the button twice.",
        "The team shares information freely during the weekly meeting.",
        "Delivery is scheduled for 30 June 2026 at the agreed location.",
        "This article explains how cookies work in a web browser.",
        "The company was founded in 2011 and employs 400 people.",
        "Our support team is available from nine until five.",
        "Read the installation guide before connecting the device.",
        "The report notes a rise in rainfall across the region.",
    ],
)
def test_ordinary_writing_signals_nothing(text):
    assert topics_for(text) == (), f"ordinary text matched: {topics_for(text)}"


def test_everyday_uses_of_clause_words_do_not_match():
    """The words appear constantly in ordinary writing; the phrasing is what counts."""
    assert topics_for("The cancellation of the festival was announced.") == ()
    assert topics_for("He is a liability on the pitch, said the coach.") == ()
    assert topics_for("She works in data entry.") == ()
    assert topics_for("The licence plate was unreadable.") == ()


def test_a_news_article_about_terms_is_not_itself_a_clause():
    """Discussion of a policy is not the policy. Phrasing is what separates them."""
    assert topics_for("The regulator criticised the company's approach to refunds.") == ()
    assert topics_for("Campaigners say arbitration clauses are too common.") == ()


# ---------------------------------------------------------------- headings


def test_a_heading_is_stronger_evidence_than_the_body():
    signals = signals_for("The plan costs 50,000 per year.", heading="Fees and charges")
    fees = next(signal for signal in signals if signal.topic is ClauseTopic.FEES_AND_PRICING)
    assert fees.source is SignalSource.HEADING


def test_a_heading_carries_its_section_even_when_the_text_is_plain():
    signals = signals_for("The amount is 1,200.", heading="Limitation of liability")
    assert ClauseTopic.LIABILITY in {signal.topic for signal in signals}


def test_text_alone_is_enough_when_there_is_no_heading():
    signals = signals_for("Payment is due within 30 days of invoice.")
    assert signals and signals[0].source is SignalSource.TEXT


def test_a_topic_is_reported_once_even_when_both_match():
    signals = signals_for("You may cancel your subscription at any time.", heading="Cancellation policy")
    cancellation = [s for s in signals if s.topic is ClauseTopic.CANCELLATION]
    assert len(cancellation) == 1
    assert cancellation[0].source is SignalSource.HEADING


# ---------------------------------------------------------------- explainability


def test_every_signal_records_the_phrase_that_produced_it():
    for signal in signals_for("Our total liability shall not exceed the fees paid."):
        assert signal.matched_text
        assert signal.matched_text.lower() in "our total liability shall not exceed the fees paid."


def test_a_signal_can_be_explained_in_a_sentence():
    signal = signals_for("Payment is due within 30 days of invoice.")[0]
    description = signal.describe()
    assert signal.label in description
    assert "the text" in description
    assert "due within 30 days" in description


def test_topics_have_readable_names_and_descriptions():
    for topic in ClauseTopic:
        assert "_" not in describe_topic(topic)
        assert describe_topic(topic)[0].isupper()
        assert topic_blurb(topic).endswith(".")


# ---------------------------------------------------------------- behaviour


def test_several_topics_can_apply_to_one_clause():
    topics = topics_for(
        "If you cancel your subscription, no refunds are given and it will not automatically renew."
    )
    assert {ClauseTopic.CANCELLATION, ClauseTopic.REFUNDS, ClauseTopic.AUTO_RENEWAL} <= set(topics)


def test_results_are_in_a_stable_order():
    text = "You may cancel at any time; no refunds are given; governed by the laws of France."
    first = topics_for(text)
    assert first == topics_for(text)
    # Ordered by the topic list, not by where the phrase appears in the sentence.
    assert list(first) == [topic for topic in ClauseTopic if topic in set(first)]


def test_matching_ignores_case_and_spacing():
    spaced = "You   may  CANCEL your\nsubscription at any time."
    assert ClauseTopic.CANCELLATION in topics_for(spaced)


def test_matching_handles_typographic_quotes_and_dashes():
    """Reuses the shared normalisation, so a curly apostrophe is not a different clause."""
    assert ClauseTopic.CANCELLATION in topics_for(
        "Either party may terminate the agreement on 30 days\u2019 notice."
    )


def test_empty_input_signals_nothing():
    assert topics_for("") == ()
    assert topics_for("   ") == ()
    assert signals_for("", heading="") == ()


def test_signals_are_immutable():
    signal = signals_for("Payment is due within 30 days of invoice.")[0]
    with pytest.raises(AttributeError):
        signal.topic = ClauseTopic.REFUNDS  # type: ignore[misc]
