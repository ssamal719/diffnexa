"""A small HTTP service that puts the comparison engine behind an API.

This is how the website reaches the engine. It is deliberately plain:

* It listens on localhost only by default.
* It holds nothing. PDFs arrive in the request, are compared in memory, and are
  discarded when the response is sent. Nothing is written to disk, no database,
  no external calls.
* It never logs document contents — only sizes, page counts and timings.
* Every file is validated by the same Stage 1 checks the command line uses, so
  a browser cannot talk the engine into reading something unsafe.

Run it with `diffnexa serve`. It is a development and self-hosting service; the
deployed arrangement (a container on Cloud Run, called by the website's server)
comes in a later stage and uses this same application object.
"""

# Note: this module deliberately does NOT use `from __future__ import annotations`.
# FastAPI resolves the endpoint's type annotations at runtime to know that
# `UploadFile` is a file upload; with deferred annotations they stay strings it
# cannot resolve, and every request fails.

import time
from typing import Any

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.adapters.pdf.extract import extract_document
from diffnexa_engine.compare import compare_documents_verbose
from diffnexa_engine.competitor.api import serialize_competitor_comparison
from diffnexa_engine.competitor.classify import classify_changes as classify_competitor_changes
from diffnexa_engine.config import EngineLimits
from diffnexa_engine.contracts import Side
from diffnexa_engine.docx.api import serialize_docx_comparison
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.docx.errors import DocxError, DocxErrorCode
from diffnexa_engine.docx.extract import extract_docx
from diffnexa_engine.docx.package import DocxLimits
from diffnexa_engine.errors import USER_MESSAGES, DocumentError, ErrorCode
from diffnexa_engine.policy.api import serialize_policy_comparison
from diffnexa_engine.policy.classify import classify_changes
from diffnexa_engine.price.api import serialize_price_comparison
from diffnexa_engine.price.classify import classify_changes as classify_price_changes
from diffnexa_engine.service.auth import check_credentials, configured_secret
from diffnexa_engine.web.api import (
    MAX_SNAPSHOT_BYTES,
    STATUS_FOR_CODE,
    capture,
    compare_against,
    read_snapshot,
    serialize_snapshot,
    serialize_web_comparison,
)
from diffnexa_engine.web.errors import WebErrorCode, WebRequestError
from diffnexa_engine.xlsx.api import serialize_excel_comparison
from diffnexa_engine.xlsx.compare import compare_xlsx
from diffnexa_engine.xlsx.errors import ExcelError, ExcelErrorCode
from diffnexa_engine.xlsx.extract import ExcelLimits, extract_xlsx

MAX_REQUEST_BYTES_HEADROOM = 2 * 1024 * 1024  # room for multipart overhead


def build_app():  # noqa: C901 - a single route with explicit error handling
    """Create the FastAPI application. Imported lazily so FastAPI stays optional."""
    from fastapi import FastAPI, File, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    limits = EngineLimits.from_env()
    secret = configured_secret()
    if secret is None:
        print(
            "WARNING: ENGINE_SHARED_SECRET is not set, so this engine accepts requests "
            "from anyone who can reach it. Set it here and on the website before "
            "exposing this service to the internet."
        )
    app = FastAPI(
        title="DiffNexa engine",
        version=ENGINE_VERSION,
        docs_url=None,  # no interactive docs page: this is an internal service
        redoc_url=None,
    )

    # The browser never calls this service directly — the website's own server
    # does — so no cross-origin access is granted.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_methods=["POST"],
        allow_headers=["*"],
    )

    def error_response(code: ErrorCode, side: str | None = None, status: int = 400) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"error": {"code": code.value, "message": USER_MESSAGES[code], "side": side}},
        )

    # /v1/* requires the shared secret. /healthz deliberately does not: hosting
    # platforms check it on a fixed URL and cannot be told to send a header, so
    # requiring one there would make the platform believe a healthy engine is
    # down and restart it in a loop. It returns only the engine version and the
    # configured limits — no document data and nothing secret.
    @app.middleware("http")
    async def require_shared_secret(request: Request, call_next):
        if request.url.path.startswith("/v1/"):
            allowed, status = check_credentials(request.headers.get("authorization"), secret)
            if not allowed:
                return JSONResponse(
                    status_code=status or 401,
                    content={
                        "error": {
                            "code": "unauthorized" if status == 401 else "forbidden",
                            "message": (
                                "This engine requires credentials."
                                if status == 401
                                else "The credentials presented are not valid for this engine."
                            ),
                            "side": None,
                        }
                    },
                )
        return await call_next(request)

    @app.get("/healthz")
    def healthz(request: Request) -> dict[str, Any]:
        # Reports whether the caller's credentials would be accepted, so a
        # mismatched secret shows up as a clear misconfiguration instead of a
        # healthy-looking engine that refuses every comparison. This reveals
        # nothing: it says yes or no about credentials already presented.
        credentials_ok, _ = check_credentials(request.headers.get("authorization"), secret)
        return {
            "status": "ok",
            "engine_version": ENGINE_VERSION,
            "limits": {
                "max_file_bytes": limits.max_file_bytes,
                "max_pages": limits.max_pages,
            },
            "requires_auth": secret is not None,
            "authenticated": credentials_ok,
        }

    def web_error(exc: WebRequestError) -> JSONResponse:
        """The same error shape Tool 1 uses. `exc.detail` stays in the log."""
        return JSONResponse(
            status_code=STATUS_FOR_CODE.get(exc.code, 400),
            content={"error": {"code": exc.code.value, "message": exc.user_message, "side": None}},
        )

    @app.post("/v1/web/snapshot")
    async def web_snapshot(request: Request) -> Any:
        try:
            payload = await _read_json(request)
            snapshot = capture(payload.get("url", ""))
        except WebRequestError as exc:
            return web_error(exc)
        return JSONResponse(content={"snapshot": serialize_snapshot(snapshot)})

    @app.post("/v1/web/compare")
    async def web_compare(request: Request) -> Any:
        started = time.perf_counter()
        try:
            payload = await _read_json(request)
            previous = read_snapshot(payload.get("previous_snapshot"))
            outcome = compare_against(payload.get("url", ""), previous)
        except WebRequestError as exc:
            return web_error(exc)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_web_comparison(outcome, elapsed_ms))

    @app.post("/v1/policy/compare")
    async def policy_compare(request: Request) -> Any:
        """Compare a policy page with a baseline, and say which clauses moved.

        The comparison is the same deterministic one Website Change Detector
        runs. What is added is the classification layer: which part of the
        agreement each change sits in. Capturing a policy page needs no endpoint
        of its own, so /v1/web/snapshot serves that.
        """
        started = time.perf_counter()
        try:
            payload = await _read_json(request)
            previous = read_snapshot(payload.get("previous_snapshot"))
            outcome = compare_against(payload.get("url", ""), previous)
        except WebRequestError as exc:
            return web_error(exc)

        classification = classify_changes(
            outcome.result.changes,
            current_snapshot=outcome.current,
            baseline_snapshot=previous,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_policy_comparison(outcome, classification, elapsed_ms))

    @app.post("/v1/competitor/compare")
    async def competitor_compare(request: Request) -> Any:
        """Compare a competitor's page with a baseline, and say what kind of thing moved.

        The comparison is the same deterministic one Website Change Detector
        runs, with the same address rules, fetch limits and evidence checks. What
        is added is one signal per change: pricing, plans, features, a call to
        action, and so on. Capturing the page needs no endpoint of its own, so
        /v1/web/snapshot serves that. The competitor's name and the page type
        are the reader's labels and are never sent here.
        """
        started = time.perf_counter()
        try:
            payload = await _read_json(request)
            previous = read_snapshot(payload.get("previous_snapshot"))
            outcome = compare_against(payload.get("url", ""), previous)
        except WebRequestError as exc:
            return web_error(exc)

        classification = classify_competitor_changes(
            outcome.result.changes,
            current_snapshot=outcome.current,
            baseline_snapshot=previous,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_competitor_comparison(outcome, classification, elapsed_ms))

    @app.post("/v1/price/compare")
    async def price_compare(request: Request) -> Any:
        """Compare a pricing page with a baseline, and say which kind of pricing change each is.

        The same deterministic comparison Website Change Detector runs, with the
        same address rules, fetch limits and evidence checks. Added is one
        category per change: price, sale price, currency, billing period and so
        on. Capturing needs no endpoint of its own; /v1/web/snapshot serves it.
        The product name and page type are the reader's labels and never sent here.
        """
        started = time.perf_counter()
        try:
            payload = await _read_json(request)
            previous = read_snapshot(payload.get("previous_snapshot"))
            outcome = compare_against(payload.get("url", ""), previous)
        except WebRequestError as exc:
            return web_error(exc)

        classification = classify_price_changes(
            outcome.result.changes,
            current_snapshot=outcome.current,
            baseline_snapshot=previous,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_price_comparison(outcome, classification, elapsed_ms))

    docx_limits = DocxLimits.from_env()

    @app.post("/v1/docx/compare")
    async def docx_compare(
        original: UploadFile = File(...),
        revised: UploadFile = File(...),
    ) -> Any:
        """Compare two Word (.docx) documents.

        Both files are read into memory with a hard size ceiling, validated as
        genuine .docx packages from their bytes (never their names or declared
        types), and read without executing, fetching or extracting anything.
        Nothing is written anywhere or kept after the response.
        """
        started = time.perf_counter()
        documents = {}
        for side, upload in (("original", original), ("revised", revised)):
            data = await upload.read(docx_limits.max_file_bytes + 1)
            try:
                if len(data) > docx_limits.max_file_bytes:
                    raise DocxError(DocxErrorCode.TOO_LARGE, f"{len(data)}+ bytes")
                documents[side] = extract_docx(data, docx_limits)
            except DocxError as exc:
                # exc.detail stays in the server log; it never holds document text.
                return JSONResponse(
                    status_code=413 if exc.code is DocxErrorCode.TOO_LARGE else 400,
                    content={"error": {"code": exc.code.value, "message": exc.user_message, "side": side}},
                )

        outcome = compare_docx(documents["original"], documents["revised"])
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_docx_comparison(outcome, elapsed_ms))

    excel_limits = ExcelLimits.from_env()

    @app.post("/v1/excel/compare")
    async def excel_compare(
        original: UploadFile = File(...),
        revised: UploadFile = File(...),
    ) -> Any:
        """Compare two Excel (.xlsx) workbooks.

        Both files are read into memory with a hard size ceiling and validated
        from their bytes. No formula is calculated, no macro runs, no link is
        opened, and nothing is written anywhere or kept after the response.
        """
        started = time.perf_counter()
        workbooks = {}
        for side, upload in (("original", original), ("revised", revised)):
            data = await upload.read(excel_limits.max_file_bytes + 1)
            try:
                if len(data) > excel_limits.max_file_bytes:
                    raise ExcelError(ExcelErrorCode.TOO_LARGE, f"{len(data)}+ bytes")
                workbooks[side] = extract_xlsx(data, excel_limits)
            except ExcelError as exc:
                # exc.detail stays in the server log; it never holds cell contents.
                return JSONResponse(
                    status_code=413 if exc.code is ExcelErrorCode.TOO_LARGE else 400,
                    content={"error": {"code": exc.code.value, "message": exc.user_message, "side": side}},
                )

        outcome = compare_xlsx(workbooks["original"], workbooks["revised"])
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_excel_comparison(outcome, elapsed_ms))

    @app.post("/v1/compare")
    async def compare_endpoint(
        previous: UploadFile = File(...),
        revised: UploadFile = File(...),
    ) -> Any:
        started = time.perf_counter()

        documents = {}
        for side, upload in (("previous", previous), ("revised", revised)):
            data = await upload.read()
            if len(data) > limits.max_file_bytes:
                return error_response(ErrorCode.FILE_TOO_LARGE, side, status=413)
            try:
                documents[side] = extract_document(data, limits)
            except DocumentError as exc:
                # exc.detail stays in the server log; the user sees the friendly text.
                return error_response(exc.code, side)

        outcome = compare_documents_verbose(documents["previous"], documents["revised"])
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return JSONResponse(content=serialize_outcome(outcome, elapsed_ms))

    return app


async def _read_json(request: Any) -> dict[str, Any]:
    """Read a JSON body, refusing anything oversized or malformed.

    The size is checked before the body is parsed, so an enormous or hostile
    payload is rejected rather than buffered and handed to the parser.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_SNAPSHOT_BYTES:
        raise WebRequestError(WebErrorCode.PAGE_TOO_LARGE, f"declared {declared} bytes")

    raw = await request.body()
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise WebRequestError(WebErrorCode.PAGE_TOO_LARGE, f"{len(raw)} bytes")
    if not raw:
        raise WebRequestError(WebErrorCode.BAD_REQUEST, "empty body")

    import json

    try:
        payload = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise WebRequestError(WebErrorCode.BAD_REQUEST, f"unreadable body: {exc}") from exc
    if not isinstance(payload, dict):
        raise WebRequestError(WebErrorCode.BAD_REQUEST, "body must be an object")
    return payload


def serialize_outcome(outcome: Any, processing_ms: int) -> dict[str, Any]:
    """Shape the result for the website. Values come straight from the engine."""
    result = outcome.result
    diagnostics = outcome.diagnostics

    changes = [
        {
            "id": change.id,
            "seq": change.seq,
            "type": change.change_type.value,
            "kind": change.kind.value,
            "category": change.category.value,
            "label": change.label,
            "oldValue": change.old_value,
            "newValue": change.new_value,
            "delta": change.delta,
            "confidence": change.confidence,
            "isNoise": change.noise_reason is not None,
            "noiseReason": change.noise_reason,
            "oldPages": sorted(change.evidence_pages(Side.OLD)),
            "newPages": sorted(change.evidence_pages(Side.NEW)),
            "evidence": [
                {
                    "side": item.side.value,
                    "page": item.page,
                    "excerpt": item.excerpt,
                    "bbox": (
                        None
                        if item.bbox is None
                        else {
                            "x0": item.bbox.x0,
                            "y0": item.bbox.y0,
                            "x1": item.bbox.x1,
                            "y1": item.bbox.y1,
                        }
                    ),
                    "wordCount": len(item.word_ids),
                }
                for item in change.evidence
            ],
        }
        for change in result.changes
    ]

    return {
        "engineVersion": result.engine_version,
        "processingMs": processing_ms,
        "documents": {
            "previous": {
                "pageCount": result.old_document.page_count,
                "sha256": result.old_document.sha256,
            },
            "revised": {
                "pageCount": result.new_document.page_count,
                "sha256": result.new_document.sha256,
            },
        },
        "counts": {
            "total": len(changes),
            "meaningful": sum(1 for change in changes if not change["isNoise"]),
            "noise": sum(1 for change in changes if change["isNoise"]),
        },
        "changes": changes,
        "diagnostics": {
            "ocrRequired": diagnostics.ocr_required,
            "previousScannedPages": diagnostics.old_scanned_pages,
            "revisedScannedPages": diagnostics.new_scanned_pages,
            "previousPagesWithoutText": diagnostics.old_pages_without_text,
            "revisedPagesWithoutText": diagnostics.new_pages_without_text,
            "notes": diagnostics.notes,
        },
    }
