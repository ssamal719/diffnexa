"""Respecting robots.txt.

DiffNexa fetches pages it was asked about, identifying itself honestly. Sites
publish rules about automated access, and following them is both the courteous
default and the safer one legally. It also means a site can opt out of being
monitored, which is a reasonable thing for a site to want.

Behaviour follows RFC 9309:

* 2xx — the rules are applied.
* 4xx (including 404, the common case) — treated as no rules, so fetching is
  allowed.
* 5xx — treated as "rules exist but are unavailable", so fetching is refused
  until the site recovers. This is the conservative reading and can block a
  legitimate fetch during an outage; that trade is deliberate.
* Network failure or malformed content — treated as no rules, allowing the
  fetch, because a site that cannot serve robots.txt at all should not block
  every page on the internet behind our own retry logic.

Results are cached in memory for the life of the process, keyed by origin, so a
comparison does not fetch robots.txt twice.
"""

from __future__ import annotations

import time
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

CACHE_TTL_S = 900
MAX_ROBOTS_BYTES = 512 * 1024

_cache: dict[str, tuple[float, RobotFileParser | None]] = {}


def _origin_of(url: str) -> tuple[str, str]:
    parts = urlsplit(url)
    origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    return origin, urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))


def clear_cache() -> None:
    """Used by tests, so one case cannot leak into the next."""
    _cache.clear()


def _load(robots_url: str, policy) -> RobotFileParser | None:
    """Fetch and parse robots.txt. None means "no usable rules, allow"."""
    # Imported here to avoid a circular import: the fetcher calls this module.
    from dataclasses import replace

    from diffnexa_engine.web.fetcher import FetchError, FetchFailure
    from diffnexa_engine.web.urls import UnsafeUrl

    # robots.txt is plain text, is never redirected through our HTML rules, and
    # must not recurse into another robots check.
    robots_policy = replace(
        policy,
        respect_robots=False,
        max_response_bytes=MAX_ROBOTS_BYTES,
        allowed_content_types=frozenset({"text/plain", "text/html", "application/xhtml+xml"}),
    )

    from diffnexa_engine.web.fetcher import fetch

    try:
        page = fetch(robots_url, robots_policy)
    except FetchError as exc:
        if exc.reason is FetchFailure.BAD_STATUS and "HTTP 5" in exc.detail:
            raise  # a 5xx means "unavailable": the caller refuses the fetch
        return None
    except UnsafeUrl:
        raise
    except Exception:
        return None

    parser = RobotFileParser()
    try:
        parser.parse(page.body.decode("utf-8", errors="replace").splitlines())
    except Exception:
        return None
    return parser


def robots_allows(url: str, policy) -> bool:
    """Whether robots.txt permits DiffNexaBot to fetch this URL."""
    from diffnexa_engine.web.fetcher import FetchError, FetchFailure

    origin, robots_url = _origin_of(url)
    cached = _cache.get(origin)
    now = time.monotonic()

    if cached is None or now - cached[0] > CACHE_TTL_S:
        try:
            parser = _load(robots_url, policy)
        except FetchError as exc:
            if exc.reason is FetchFailure.BAD_STATUS:
                _cache[origin] = (now, None)
                return False  # robots.txt exists but is unavailable: do not fetch
            parser = None
        _cache[origin] = (now, parser)
        cached = _cache[origin]

    parser = cached[1]
    if parser is None:
        return True
    agent = policy.user_agent.split("/")[0] or "*"
    return bool(parser.can_fetch(agent, url))
