"""AI layer (optional).

Stage 1 contains only the boundary that decides how AI output may touch results.
The Gemini provider, prompts and validator arrive in Stage 8.

Hard rule, enforced by tests/test_ai_boundary.py: code in this package may never
import or construct `Change` or `Evidence`. AI can only produce `AIAnnotation`s,
which attach to changes the deterministic engine already found.
"""
