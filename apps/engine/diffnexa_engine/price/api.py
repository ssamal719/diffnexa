"""The Price Monitor's API shape.

One new engine endpoint, and this builds its response. Capturing a pricing page
is the same operation as capturing any page, so it reuses the existing webpage
capture endpoint.

The response is the webpage comparison, unchanged, with a `price` section
beside it. Every change keeps every field it already had and gains one
`priceCategory`. Nothing is removed, reordered or hidden, and because each
change has exactly one category, the per-category counts add up to the number
of changes found.

The product or service name and the page type are the reader's labels, kept in
their baseline file. They never reach the engine and cannot change how a page
is read or compared.
"""

from __future__ import annotations

from typing import Any

from diffnexa_engine.price.classify import PriceClassification, describe_reason
from diffnexa_engine.price.signals import CATEGORY_RULES
from diffnexa_engine.web.api import serialize_web_comparison
from diffnexa_engine.web.compare import WebComparisonOutcome


def _category_payload(classification: PriceClassification, change_id: str) -> dict[str, Any] | None:
    signal = classification.signal_for(change_id)
    if signal is None:
        return None
    return {
        "category": signal.category.value,
        "label": signal.label,
        "basis": signal.basis.value,
        "matchedText": signal.matched_text,
        "reason": describe_reason(signal),
    }


def serialize_price_comparison(
    outcome: WebComparisonOutcome,
    classification: PriceClassification,
    processing_ms: int,
) -> dict[str, Any]:
    """The webpage comparison, with one price category on every change."""
    payload = serialize_web_comparison(outcome, processing_ms)

    for change in payload["changes"]:
        # Additive: every existing field is untouched.
        change["priceCategory"] = _category_payload(classification, change["id"])

    counts = classification.counts()
    payload["price"] = {
        "rulesVersion": classification.rules_version,
        "categories": [
            {
                "id": rules.category.value,
                "label": rules.label,
                "blurb": rules.blurb,
                "changeCount": counts[rules.category],
                "changeIds": classification.change_ids_for(rules.category),
            }
            for rules in CATEGORY_RULES
        ],
        "changedCategories": [category.value for category in classification.changed_categories()],
    }
    return payload


__all__ = ["serialize_price_comparison"]
