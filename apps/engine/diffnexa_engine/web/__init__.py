"""Fetching public webpages safely.

W2 scope: this package fetches bytes and nothing more. It does not parse HTML,
build snapshots, or compare anything — those arrive in later stages.
"""

from diffnexa_engine.web.fetcher import FetchedPage, FetchError, FetchFailure, fetch
from diffnexa_engine.web.urls import FetchPolicy, UnsafeUrl, UrlRejection, resolve_safely

__all__ = [
    "FetchError",
    "FetchFailure",
    "FetchPolicy",
    "FetchedPage",
    "UnsafeUrl",
    "UrlRejection",
    "fetch",
    "resolve_safely",
]
