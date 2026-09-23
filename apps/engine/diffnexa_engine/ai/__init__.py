"""AI Change Analyst: an optional explanation layer over deterministic results.

Deterministic comparison finds and proves every change. This package only
explains changes that already exist, keyed by the IDs the comparison gave them:

    facts.py      the input contract — deterministic facts, nothing else
    adapters.py   each tool's published result → facts (refuses missing evidence)
    prompt.py     instructions, facts and untrusted document text, kept apart
    providers.py  the provider interface; Gemini and OpenAI-compatible
    validate.py   the deterministic check every AI statement must pass
    analyst.py    selection, batching and the grounded analysis
    boundary.py   AIAnnotation on a PDF ComparisonResult (the Stage 1 boundary)

Hard rule, enforced by tests/test_ai_boundary.py: code in this package may never
import or construct `Change` or `Evidence`. It reads the results the tools
already published and returns text tied to their change IDs; it cannot add,
alter or remove a change.
"""
