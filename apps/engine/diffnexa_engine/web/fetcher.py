"""Fetching a public webpage safely.

Two ideas carry most of the weight here.

**The connection goes to an address we checked, not to a name.** Checking that a
hostname resolves to a public address and then asking the HTTP library to
connect by name leaves a gap: the library performs its own lookup, and a second
answer can point somewhere else. That is DNS rebinding. Here the address is
resolved once, validated, and the socket is opened to that exact address, while
the original hostname is still used for the Host header and the TLS handshake so
certificate verification stays correct.

**Every redirect is a new, untrusted URL.** A public page redirecting to
`169.254.169.254` is a standard way to reach a cloud metadata service. Each hop
is therefore put through the whole validation and resolution again.

Beyond that the fetcher is defensive about size and time: the response is read
in chunks against a deadline, decompressed incrementally, and abandoned the
moment either limit is passed, so an endless or explosively compressed response
cannot exhaust the server.

What this module does NOT do, by design: it does not parse HTML, execute
JavaScript, fetch subresources, follow meta refresh, or interpret the body in
any way. It returns bytes.
"""

from __future__ import annotations

import http.client
import ssl
import time
import zlib
from dataclasses import dataclass
from enum import StrEnum

from diffnexa_engine.web.urls import (
    FetchPolicy,
    ResolvedTarget,
    UnsafeUrl,
    UrlRejection,
    resolve_safely,
)

REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
READ_CHUNK_BYTES = 64 * 1024

try:  # Brotli is optional; it is only advertised when it can be decoded.
    import brotli  # type: ignore

    BROTLI_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the deployment image
    brotli = None  # type: ignore
    BROTLI_AVAILABLE = False


def accepted_encodings() -> str:
    return "gzip, deflate, br" if BROTLI_AVAILABLE else "gzip, deflate"


class FetchFailure(StrEnum):
    UNREACHABLE = "url_unreachable"
    TOO_MANY_REDIRECTS = "too_many_redirects"
    REDIRECT_INVALID = "redirect_invalid"
    NOT_HTML = "url_not_html"
    TOO_LARGE = "page_too_large"
    TIMEOUT = "fetch_timeout"
    BAD_STATUS = "url_bad_status"
    BLOCKED_BY_ROBOTS = "blocked_by_robots"
    DECODE_FAILED = "decode_failed"


class FetchError(Exception):
    """A fetch that could not be completed. `reason` is safe to show, `detail` is not."""

    def __init__(self, reason: FetchFailure | UrlRejection, detail: str = "") -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(f"{reason.value}: {detail}" if detail else reason.value)


@dataclass(frozen=True)
class FetchedPage:
    """The raw result of one fetch. Nothing here has been parsed."""

    requested_url: str
    final_url: str
    status: int
    content_type: str
    charset: str | None
    body: bytes
    fetched_at: str  # ISO-8601 UTC
    redirect_chain: tuple[str, ...]
    elapsed_ms: int
    truncated: bool = False


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Connects to a checked address while still presenting the real hostname."""

    def __init__(self, hostname: str, ip: str, port: int, timeout: float) -> None:
        super().__init__(hostname, port=port, timeout=timeout)
        self._pinned_ip = ip

    def connect(self) -> None:
        import socket

        self.sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """As above, with TLS verified against the hostname rather than the address."""

    def __init__(self, hostname: str, ip: str, port: int, timeout: float, context: ssl.SSLContext) -> None:
        super().__init__(hostname, port=port, timeout=timeout, context=context)
        self._pinned_ip = ip

    def connect(self) -> None:
        import socket

        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        # server_hostname is the name, so SNI and certificate checking behave
        # exactly as if we had connected by name.
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _open(target: ResolvedTarget, policy: FetchPolicy) -> http.client.HTTPConnection:
    if target.scheme == "https":
        return _PinnedHTTPSConnection(
            target.hostname,
            target.ip,
            target.port,
            policy.connect_timeout_s,
            ssl.create_default_context(),
        )
    return _PinnedHTTPConnection(target.hostname, target.ip, target.port, policy.connect_timeout_s)


def _path_of(url: str) -> str:
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    path = parts.path or "/"
    return f"{path}?{parts.query}" if parts.query else path


def _decompressor(encoding: str):
    """An incremental decoder, so size is capped while decompressing, not after."""
    encoding = encoding.lower().strip()
    if encoding in ("gzip", "x-gzip"):
        return zlib.decompressobj(zlib.MAX_WBITS | 16)
    if encoding == "deflate":
        return zlib.decompressobj()
    if encoding == "br" and BROTLI_AVAILABLE:
        return brotli.Decompressor()  # type: ignore[union-attr]
    if encoding in ("", "identity"):
        return None
    raise FetchError(FetchFailure.DECODE_FAILED, f"unsupported content encoding {encoding!r}")


def _decompress_chunk(decoder, chunk: bytes) -> bytes:
    if decoder is None:
        return chunk
    if hasattr(decoder, "decompress"):
        try:
            return decoder.decompress(chunk)
        except (zlib.error, OSError, ValueError) as exc:
            raise FetchError(FetchFailure.DECODE_FAILED, str(exc))
    return chunk


def _split_content_type(raw: str) -> tuple[str, str | None]:
    parts = [piece.strip() for piece in raw.split(";")]
    mime = parts[0].lower()
    charset = None
    for piece in parts[1:]:
        if piece.lower().startswith("charset="):
            charset = piece.split("=", 1)[1].strip().strip('"').lower() or None
    return mime, charset


def _read_body(response: http.client.HTTPResponse, policy: FetchPolicy, deadline: float) -> bytes:
    """Read with both a size ceiling and a deadline, decompressing as we go.

    The ceiling applies to the decompressed bytes, which is what a decompression
    bomb inflates. Reading in chunks means an oversized response is abandoned
    early rather than after it has been buffered.
    """
    decoder = _decompressor(response.headers.get("Content-Encoding", ""))
    collected = bytearray()

    while True:
        if time.monotonic() > deadline:
            raise FetchError(FetchFailure.TIMEOUT, "deadline passed while reading the response")
        try:
            chunk = response.read(READ_CHUNK_BYTES)
        except TimeoutError as exc:
            raise FetchError(FetchFailure.TIMEOUT, str(exc))
        except OSError as exc:
            raise FetchError(FetchFailure.UNREACHABLE, str(exc))
        if not chunk:
            break

        collected += _decompress_chunk(decoder, chunk)
        if len(collected) > policy.max_response_bytes:
            raise FetchError(
                FetchFailure.TOO_LARGE,
                f"exceeded {policy.max_response_bytes} bytes while reading",
            )

    if decoder is not None and hasattr(decoder, "flush"):
        try:
            collected += decoder.flush()
        except (zlib.error, OSError, ValueError) as exc:
            raise FetchError(FetchFailure.DECODE_FAILED, str(exc))
        if len(collected) > policy.max_response_bytes:
            raise FetchError(FetchFailure.TOO_LARGE, "exceeded size limit after decompression")

    return bytes(collected)


def fetch(url: str, policy: FetchPolicy | None = None) -> FetchedPage:
    """Fetch a public webpage, or raise UnsafeUrl / FetchError explaining why not."""
    from datetime import UTC, datetime
    from urllib.parse import urljoin

    policy = policy or FetchPolicy()
    started = time.monotonic()
    deadline = started + policy.total_timeout_s

    if policy.respect_robots:
        from diffnexa_engine.web.robots import robots_allows

        if not robots_allows(url, policy):
            raise FetchError(FetchFailure.BLOCKED_BY_ROBOTS, "disallowed by robots.txt")

    current = url
    chain: list[str] = []

    for _hop in range(policy.max_redirects + 1):
        if time.monotonic() > deadline:
            raise FetchError(FetchFailure.TIMEOUT, "deadline passed before the request completed")

        # Full validation and resolution, on every hop.
        target = resolve_safely(current, policy)
        connection = _open(target, policy)
        try:
            remaining = max(0.1, deadline - time.monotonic())
            connection.timeout = min(policy.connect_timeout_s, remaining)
            try:
                connection.request(
                    "GET",
                    _path_of(current),
                    headers={
                        "Host": target.hostname,
                        "User-Agent": policy.user_agent,
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Encoding": accepted_encodings(),
                        "Connection": "close",
                    },
                )
                connection.sock.settimeout(max(0.1, deadline - time.monotonic()))
                response = connection.getresponse()
            except TimeoutError as exc:
                raise FetchError(FetchFailure.TIMEOUT, str(exc))
            except OSError as exc:
                raise FetchError(FetchFailure.UNREACHABLE, f"{type(exc).__name__}: {exc}")

            if response.status in REDIRECT_STATUSES:
                location = response.headers.get("Location")
                if not location:
                    raise FetchError(FetchFailure.REDIRECT_INVALID, "redirect without a location")
                chain.append(current)
                if len(chain) > policy.max_redirects:
                    raise FetchError(
                        FetchFailure.TOO_MANY_REDIRECTS,
                        f"more than {policy.max_redirects} redirects",
                    )
                current = urljoin(current, location)
                continue

            if response.status >= 400:
                raise FetchError(FetchFailure.BAD_STATUS, f"HTTP {response.status}")

            mime, charset = _split_content_type(response.headers.get("Content-Type", ""))
            if mime not in policy.allowed_content_types:
                raise FetchError(FetchFailure.NOT_HTML, f"content type {mime or 'unknown'!r}")

            # A declared length over the ceiling is refused before reading.
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > policy.max_response_bytes:
                raise FetchError(FetchFailure.TOO_LARGE, f"declared {declared} bytes")

            body = _read_body(response, policy, deadline)
            return FetchedPage(
                requested_url=url,
                final_url=current,
                status=response.status,
                content_type=mime,
                charset=charset,
                body=body,
                fetched_at=datetime.now(UTC).isoformat(),
                redirect_chain=tuple(chain),
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        finally:
            connection.close()

    raise FetchError(FetchFailure.TOO_MANY_REDIRECTS, f"more than {policy.max_redirects} redirects")


__all__ = [
    "FetchError",
    "FetchFailure",
    "FetchedPage",
    "FetchPolicy",
    "UnsafeUrl",
    "UrlRejection",
    "fetch",
]
