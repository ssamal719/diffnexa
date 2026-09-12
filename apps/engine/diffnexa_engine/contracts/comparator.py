"""The interface every comparison engine implements.

No comparator exists in Stage 1. The golden-test runner accepts one, so from
Stage 3 the real engine plugs in without changing the test system.
"""

from __future__ import annotations

from typing import Protocol

from diffnexa_engine.contracts.changes import ComparisonResult
from diffnexa_engine.model.document import Document


class Comparator(Protocol):
    def __call__(self, old: Document, new: Document) -> ComparisonResult: ...
