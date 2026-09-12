"""User-facing errors for webpage checking.

Separate from the document errors in `diffnexa_engine.errors` because the two
tools fail in different ways: a PDF can be password protected, a webpage can
refuse to be read. Both follow the same discipline — a short code the interface
maps to wording, and a detail string that stays in the server log.

Codes and messages must match the `web_messages` section of
packages/contracts/errors.json exactly; a test enforces it, so the engine and
the website can never describe the same failure differently.
"""

from __future__ import annotations

from enum import StrEnum


class WebErrorCode(StrEnum):
    URL_NOT_ALLOWED = "url_not_allowed"
    URL_UNREACHABLE = "url_unreachable"
    URL_NOT_HTML = "url_not_html"
    PAGE_NEEDS_JAVASCRIPT = "page_needs_javascript"
    PAGE_TOO_LARGE = "page_too_large"
    SNAPSHOT_MISMATCH = "snapshot_mismatch"
    SNAPSHOT_UNREADABLE = "snapshot_unreadable"
    FETCH_TIMEOUT = "fetch_timeout"
    ENGINE_UNAVAILABLE = "engine_unavailable"
    BAD_REQUEST = "bad_request"


WEB_MESSAGES: dict[WebErrorCode, str] = {
    WebErrorCode.URL_NOT_ALLOWED: (
        "This address can't be checked. DiffNexa only reads public web pages over http or "
        "https, and some sites ask not to be read automatically."
    ),
    WebErrorCode.URL_UNREACHABLE: (
        "That page couldn't be reached. Check the address is correct and the site is online, then try again."
    ),
    WebErrorCode.URL_NOT_HTML: (
        "That address isn't a web page. DiffNexa reads web pages; for a PDF, use PDF Compare instead."
    ),
    WebErrorCode.PAGE_NEEDS_JAVASCRIPT: (
        "This page builds its content in the browser, so DiffNexa can't read it yet. Pages "
        "that work today are ones whose text is in the page itself."
    ),
    WebErrorCode.PAGE_TOO_LARGE: (
        "That page is larger than DiffNexa can read. Try a specific page rather than a very long one."
    ),
    WebErrorCode.SNAPSHOT_MISMATCH: (
        "That saved capture is for a different address. Choose the capture that matches the "
        "page you're checking."
    ),
    WebErrorCode.SNAPSHOT_UNREADABLE: (
        "That file isn't a DiffNexa capture, or it's damaged. Choose the file you downloaded "
        "when you captured the page."
    ),
    WebErrorCode.FETCH_TIMEOUT: (
        "That page took too long to respond. It may be slow right now, so try again in a moment."
    ),
    WebErrorCode.ENGINE_UNAVAILABLE: (
        "The service that reads web pages isn't responding right now. Nothing is wrong with "
        "the address you entered."
    ),
    WebErrorCode.BAD_REQUEST: ("Something was missing from that request. Enter a web address and try again."),
}


class WebRequestError(Exception):
    """A webpage request that cannot be completed. `code` is safe to show."""

    def __init__(self, code: WebErrorCode, detail: str = "") -> None:
        self.code = code
        self.detail = detail  # server log only: may name hosts, sizes, parser output
        super().__init__(f"{code.value}: {detail}" if detail else code.value)

    @property
    def user_message(self) -> str:
        return WEB_MESSAGES[self.code]
