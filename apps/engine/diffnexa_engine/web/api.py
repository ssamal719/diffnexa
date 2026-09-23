"""The engine's webpage endpoints.

Two operations, both stateless and both in memory:

* `POST /v1/web/snapshot` fetches a public page and returns what it says, in a
  form the person can keep. Nothing is stored here.
* `POST /v1/web/compare` fetches the page again and compares it against a
  capture the person kept, returning a verified result.

Everything hostile is already handled further down: the fetcher enforces the
address rules, the size and time ceilings and robots.txt; extraction refuses to
invent content; and comparison verifies every change's evidence before
returning it. This module's job is to translate those outcomes into the same
error shape Tool 1 already uses, without letting any internal detail escape.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from diffnexa_engine.contracts.changes import Side, SnapshotRef
from diffnexa_engine.web.compare import METADATA_FIELDS, WebComparisonOutcome, compare_snapshots_verbose
from diffnexa_engine.web.errors import WebErrorCode, WebRequestError
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.fetcher import FetchError, FetchFailure, FetchPolicy, fetch
from diffnexa_engine.web.snapshot import RenderNote, Snapshot
from diffnexa_engine.web.urls import UnsafeUrl
from diffnexa_engine.web.view import content_view

# A capture of a long page is a few hundred kilobytes; this is generous.
MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
MAX_URL_LENGTH = 2048
# Extraction never produces more than this, so a capture claiming more was not
# made by DiffNexa and would only serve to make comparison expensive.
MAX_SNAPSHOT_NODES = 5_000

# How a fetch failure is described to the person who asked.
_FETCH_ERRORS: dict[FetchFailure, WebErrorCode] = {
    FetchFailure.UNREACHABLE: WebErrorCode.URL_UNREACHABLE,
    FetchFailure.BAD_STATUS: WebErrorCode.URL_UNREACHABLE,
    FetchFailure.REDIRECT_INVALID: WebErrorCode.URL_UNREACHABLE,
    FetchFailure.TOO_MANY_REDIRECTS: WebErrorCode.URL_UNREACHABLE,
    FetchFailure.DECODE_FAILED: WebErrorCode.URL_UNREACHABLE,
    FetchFailure.NOT_HTML: WebErrorCode.URL_NOT_HTML,
    FetchFailure.TOO_LARGE: WebErrorCode.PAGE_TOO_LARGE,
    FetchFailure.TIMEOUT: WebErrorCode.FETCH_TIMEOUT,
    # A site asking not to be read automatically is a refusal to check it, not a
    # fault with the address.
    FetchFailure.BLOCKED_BY_ROBOTS: WebErrorCode.URL_NOT_ALLOWED,
}

STATUS_FOR_CODE: dict[WebErrorCode, int] = {
    WebErrorCode.PAGE_TOO_LARGE: 413,
    WebErrorCode.FETCH_TIMEOUT: 504,
    WebErrorCode.ENGINE_UNAVAILABLE: 503,
}


def _flag(name: str, default: bool) -> bool:
    import os

    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def web_policy_from_env() -> FetchPolicy:
    """The fetch policy the service runs with.

    Every default is the safe one: public addresses only, the standard web
    ports, robots.txt respected, and the ceilings from the proposal. The
    overrides exist so a deployment can tighten them and so the test suite can
    reach a stub server on loopback; a test asserts the defaults.
    """
    import os

    def number(name: str, default: float) -> float:
        raw = os.environ.get(name)
        try:
            return float(raw) if raw and raw.strip() else default
        except ValueError:
            return default

    ports = os.environ.get("DIFFNEXA_WEB_PORTS", "").strip()
    allowed_ports = (
        frozenset(int(part) for part in ports.split(",") if part.strip().isdigit())
        if ports
        else frozenset({80, 443})
    )

    return FetchPolicy(
        total_timeout_s=number("DIFFNEXA_WEB_TIMEOUT_S", 20.0),
        max_response_bytes=int(number("DIFFNEXA_WEB_MAX_BYTES", 5 * 1024 * 1024)),
        respect_robots=_flag("DIFFNEXA_WEB_ROBOTS", True),
        allow_private_addresses=_flag("DIFFNEXA_WEB_ALLOW_PRIVATE", False),
        allowed_ports=allowed_ports or frozenset({80, 443}),
    )


def capture(url: str, policy: FetchPolicy | None = None) -> Snapshot:
    """Fetch a page and read it, or raise a WebRequestError explaining why not."""
    if not isinstance(url, str) or not url.strip():
        raise WebRequestError(WebErrorCode.BAD_REQUEST, "no url given")
    if len(url) > MAX_URL_LENGTH:
        raise WebRequestError(WebErrorCode.URL_NOT_ALLOWED, "url too long")

    try:
        page = fetch(url.strip(), policy or web_policy_from_env())
    except UnsafeUrl as exc:
        # The address itself is refused: private range, wrong scheme, bad port.
        raise WebRequestError(WebErrorCode.URL_NOT_ALLOWED, exc.detail) from exc
    except FetchError as exc:
        code = _FETCH_ERRORS.get(exc.reason, WebErrorCode.URL_UNREACHABLE)  # type: ignore[arg-type]
        raise WebRequestError(code, exc.detail) from exc

    snapshot = extract_snapshot(
        page.body,
        url=url.strip(),
        final_url=page.final_url,
        fetched_at=page.fetched_at,
        http_status=page.status,
        content_type=page.content_type,
        charset=page.charset,
        redirect_chain=page.redirect_chain,
    )

    if snapshot.render_note is RenderNote.NEEDS_JAVASCRIPT:
        # Better to say so than to compare an empty shell against an empty shell.
        raise WebRequestError(WebErrorCode.PAGE_NEEDS_JAVASCRIPT, "no readable text layer")

    return snapshot


def read_snapshot(payload: Any) -> Snapshot:
    """Turn an uploaded capture back into a snapshot, refusing anything else.

    The file came from the person's computer, so it is untrusted: it may be the
    wrong file, an edited one, or something crafted. Validation is strict and
    the failure is always the same short message.
    """
    if payload is None:
        raise WebRequestError(WebErrorCode.BAD_REQUEST, "no snapshot given")
    try:
        if isinstance(payload, str | bytes | bytearray):
            if len(payload) > MAX_SNAPSHOT_BYTES:
                raise WebRequestError(WebErrorCode.PAGE_TOO_LARGE, "snapshot over the size ceiling")
            snapshot = Snapshot.model_validate_json(payload)
            if snapshot.node_count > MAX_SNAPSHOT_NODES:
                raise WebRequestError(WebErrorCode.SNAPSHOT_UNREADABLE, "implausible node count")
            return snapshot
        snapshot = Snapshot.model_validate(payload)
        if snapshot.node_count > MAX_SNAPSHOT_NODES:
            raise WebRequestError(
                WebErrorCode.SNAPSHOT_UNREADABLE,
                f"{snapshot.node_count} nodes exceeds anything DiffNexa produces",
            )
        return snapshot
    except WebRequestError:
        raise
    except (ValidationError, ValueError, TypeError) as exc:
        raise WebRequestError(WebErrorCode.SNAPSHOT_UNREADABLE, str(exc)[:200]) from exc
    except RecursionError as exc:  # deeply nested JSON designed to exhaust the stack
        raise WebRequestError(WebErrorCode.SNAPSHOT_UNREADABLE, "nested too deeply") from exc


def _same_page(previous: Snapshot, current: Snapshot) -> bool:
    """Whether a capture is of the page being checked.

    Addresses are compared after removing a trailing slash and the fragment,
    since neither changes which page was fetched. A redirect is allowed for on
    both sides, because a site may move a page between captures.
    """

    def variants(snapshot: Snapshot) -> set[str]:
        found = set()
        for value in (snapshot.source.url, snapshot.source.final_url):
            cleaned = value.split("#")[0].strip()
            found.add(cleaned)
            found.add(cleaned.rstrip("/"))
        return found

    return bool(variants(previous) & variants(current))


def compare_against(url: str, previous: Snapshot, policy: FetchPolicy | None = None) -> WebComparisonOutcome:
    """Fetch the page now and compare it with a capture taken earlier."""
    current = capture(url, policy)
    if not _same_page(previous, current):
        raise WebRequestError(
            WebErrorCode.SNAPSHOT_MISMATCH,
            "the uploaded capture is for a different address",
        )
    return compare_snapshots_verbose(previous, current)


# ---------------------------------------------------------------- serialisation


def serialize_snapshot(snapshot: Snapshot) -> dict[str, Any]:
    """The capture, as the person downloads it."""
    return snapshot.model_dump(mode="json")


def serialize_web_comparison(outcome: WebComparisonOutcome, processing_ms: int) -> dict[str, Any]:
    """Shape the result for the website, mirroring the PDF comparison response."""
    result = outcome.result
    diagnostics = outcome.diagnostics

    def source(ref: Any) -> dict[str, Any]:
        return (
            {"url": ref.url, "sha256": ref.sha256, "nodeCount": ref.node_count}
            if isinstance(ref, SnapshotRef)
            else {"sha256": ref.sha256}
        )

    changes = [
        {
            "id": change.id,
            "seq": change.seq,
            "type": change.change_type.value,
            "kind": change.kind.value,
            "category": change.category.value,
            "subtype": change.subtype,
            "label": change.label,
            "oldValue": change.old_value,
            "newValue": change.new_value,
            "delta": change.delta,
            "confidence": change.confidence,
            "isNoise": change.noise_reason is not None,
            "noiseReason": change.noise_reason,
            "sections": sorted(
                {" › ".join(item.section_path) for item in change.evidence if item.section_path}
            ),
            "evidence": [
                {
                    "side": item.side.value,
                    "scope": item.scope,
                    "nodeId": item.node_id,
                    "path": item.node_path,
                    "sectionPath": list(item.section_path),
                    "field": item.field,
                    "excerpt": item.excerpt,
                }
                for item in change.evidence
            ],
        }
        for change in result.changes
    ]

    payload: dict[str, Any] = {
        "engineVersion": result.engine_version,
        "processingMs": processing_ms,
        "documents": {
            "previous": source(result.old_document),
            "revised": source(result.new_document),
        },
        "counts": {
            "total": len(changes),
            "meaningful": sum(1 for change in changes if not change["isNoise"]),
            "noise": sum(1 for change in changes if change["isNoise"]),
        },
        "changes": changes,
        "diagnostics": {
            "notes": diagnostics.notes,
            "previousWarnings": list(diagnostics.previous_warnings),
            "revisedWarnings": list(diagnostics.revised_warnings),
            "needsJavascript": diagnostics.needs_javascript,
        },
    }
    if outcome.previous is not None and outcome.current is not None:
        # Read-only content of both pages, for the workspace to show each change
        # in context. Nothing above depends on it.
        payload["view"] = content_view(
            outcome.previous.nodes,
            outcome.current.nodes,
            result.changes,
            fields=tuple(
                {name: getattr(snapshot.metadata, attribute) for name, attribute, _ in METADATA_FIELDS}
                for snapshot in (outcome.previous, outcome.current)
            ),
        )
    return payload


__all__ = [
    "MAX_SNAPSHOT_BYTES",
    "web_policy_from_env",
    "STATUS_FOR_CODE",
    "capture",
    "compare_against",
    "read_snapshot",
    "serialize_snapshot",
    "serialize_web_comparison",
    "Side",
]
