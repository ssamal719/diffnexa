"""AI Change Analyst settings, read from environment variables on the engine.

Nothing here reaches the browser. The API key is held only in this process,
is excluded from every representation of the settings, and is never logged.

AI is off unless a provider is chosen and given a key. With it off, every
comparison works exactly as before; only the optional analysis is unavailable.

    DIFFNEXA_AI_PROVIDER         gemini | openai_compatible   (unset = AI off)
    DIFFNEXA_AI_API_KEY          the provider's key
    DIFFNEXA_AI_MODEL            model name (gemini default: gemini-3.5-flash-lite)
    DIFFNEXA_AI_BASE_URL         openai_compatible only, e.g. https://api.openai.com/v1
    DIFFNEXA_AI_TIMEOUT_SECONDS  per provider call (default 45)
    DIFFNEXA_AI_MAX_CHANGES      most changes explained in one analysis (default 100)
    DIFFNEXA_AI_BATCH_SIZE       changes per provider call (default 25)
    DIFFNEXA_AI_MAX_OUTPUT_TOKENS  per provider call (default 8192)
    DIFFNEXA_AI_DAILY_LIMIT      analyses per day for this engine, all visitors together (default 200)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

PROVIDERS = ("gemini", "openai_compatible")
DEFAULT_MODELS = {"gemini": "gemini-3.5-flash-lite"}


def _int(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        return default
    return min(max(value, low), high)


@dataclass(frozen=True)
class AIConfig:
    provider: str | None
    model: str | None
    base_url: str | None
    api_key: str | None = field(default=None, repr=False, compare=False)
    timeout_seconds: int = 45
    max_changes: int = 100
    batch_size: int = 25
    max_output_tokens: int = 8192
    daily_limit: int = 200
    #: Why AI is off, for the operator. Never shown to visitors, never holds the key.
    problem: str | None = None

    @property
    def available(self) -> bool:
        return self.problem is None

    @property
    def max_batches(self) -> int:
        return -(-self.max_changes // self.batch_size)

    @classmethod
    def from_env(cls) -> AIConfig:
        provider = os.environ.get("DIFFNEXA_AI_PROVIDER", "").strip().lower() or None
        api_key = os.environ.get("DIFFNEXA_AI_API_KEY", "").strip() or None
        model = os.environ.get("DIFFNEXA_AI_MODEL", "").strip() or None
        base_url = os.environ.get("DIFFNEXA_AI_BASE_URL", "").strip().rstrip("/") or None
        limits = {
            "timeout_seconds": _int("DIFFNEXA_AI_TIMEOUT_SECONDS", 45, 5, 120),
            "max_changes": _int("DIFFNEXA_AI_MAX_CHANGES", 100, 1, 500),
            "batch_size": _int("DIFFNEXA_AI_BATCH_SIZE", 25, 1, 60),
            "max_output_tokens": _int("DIFFNEXA_AI_MAX_OUTPUT_TOKENS", 8192, 512, 65536),
            "daily_limit": _int("DIFFNEXA_AI_DAILY_LIMIT", 200, 1, 100_000),
        }

        problem: str | None = None
        if provider is None:
            problem = "DIFFNEXA_AI_PROVIDER is not set"
        elif provider not in PROVIDERS:
            problem = f"DIFFNEXA_AI_PROVIDER must be one of {', '.join(PROVIDERS)}"
        elif api_key is None:
            problem = "DIFFNEXA_AI_API_KEY is not set"
        else:
            model = model or DEFAULT_MODELS.get(provider)
            if model is None:
                problem = "DIFFNEXA_AI_MODEL is required for this provider"
            elif provider == "openai_compatible":
                if base_url is None:
                    problem = "DIFFNEXA_AI_BASE_URL is required for openai_compatible"
                else:
                    parts = urlsplit(base_url)
                    local = parts.hostname in ("127.0.0.1", "localhost")
                    if parts.scheme != "https" and not (parts.scheme == "http" and local):
                        # A key is sent with every call, so it only ever travels encrypted
                        # (plain http is allowed only to this machine, for local testing).
                        problem = "DIFFNEXA_AI_BASE_URL must use https"
        return cls(
            provider=provider if problem is None else None,
            model=model if problem is None else None,
            base_url=base_url if provider == "openai_compatible" and problem is None else None,
            api_key=api_key if problem is None else None,
            problem=problem,
            **limits,
        )


__all__ = ["DEFAULT_MODELS", "PROVIDERS", "AIConfig"]
