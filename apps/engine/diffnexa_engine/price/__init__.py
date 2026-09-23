"""Price Monitor.

Places each change on a pricing or product page into one factual category —
price, sale price, original price, currency, billing period, product or plan,
availability, pricing details, or other — so a reader can see at a glance what
kind of thing moved.

It is a thin layer over the webpage comparison: the comparison decides what
changed, with evidence; this only says where each change sits. It never
evaluates a price.
"""

from diffnexa_engine.price.classify import (
    PriceClassification,
    PriceSignal,
    classify_change,
    classify_changes,
    describe_reason,
    describe_signal_for_reader,
)
from diffnexa_engine.price.signals import (
    PRICE_RULES_VERSION,
    PriceBasis,
    PriceCategory,
    category_blurb,
    category_label,
)

__all__ = [
    "PRICE_RULES_VERSION",
    "PriceBasis",
    "PriceCategory",
    "PriceClassification",
    "PriceSignal",
    "category_blurb",
    "category_label",
    "classify_change",
    "classify_changes",
    "describe_reason",
    "describe_signal_for_reader",
]
