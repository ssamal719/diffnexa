"""The deterministic comparison engine."""

from diffnexa_engine.compare.engine import (
    ComparisonDiagnostics,
    ComparisonOutcome,
    compare_documents,
    compare_documents_verbose,
)

__all__ = [
    "ComparisonDiagnostics",
    "ComparisonOutcome",
    "compare_documents",
    "compare_documents_verbose",
]
