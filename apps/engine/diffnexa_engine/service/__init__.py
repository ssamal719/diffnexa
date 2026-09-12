"""HTTP service that exposes the comparison engine to the website."""

from diffnexa_engine.service.app import build_app, serialize_outcome

__all__ = ["build_app", "serialize_outcome"]
