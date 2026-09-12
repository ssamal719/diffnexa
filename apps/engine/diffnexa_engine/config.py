"""Engine settings, read from environment variables.

These are system-wide safety ceilings. Per-plan limits (for example the smaller
limits for anonymous users) will live in the database from Stage 10 and are
always lower than or equal to these values.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MAX_FILE_MB = 50
DEFAULT_MAX_PAGES = 500


def _int_env(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value


@dataclass(frozen=True)
class EngineLimits:
    max_file_bytes: int
    max_pages: int

    @classmethod
    def from_env(cls) -> EngineLimits:
        max_mb = _int_env("DIFFNEXA_MAX_FILE_MB", DEFAULT_MAX_FILE_MB)
        return cls(
            max_file_bytes=max_mb * 1024 * 1024,
            max_pages=_int_env("DIFFNEXA_MAX_PAGES", DEFAULT_MAX_PAGES),
        )
