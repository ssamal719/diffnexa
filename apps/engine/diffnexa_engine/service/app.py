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
from diffnexa_engine.config import EngineLimits
from diffnexa_engine.contracts import Side
from diffnexa_engine.errors import USER_MESSAGES, DocumentError, ErrorCode

MAX_REQUEST_BYTES_HEADROOM = 2 * 1024 * 1024  # room for multipart overhead


def build_app():  # noqa: C901 - a single route with explicit error handling
    """Create the FastAPI application. Imported lazily so FastAPI stays optional."""
    from fastapi import FastAPI, File, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    limits = EngineLimits.from_env()
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

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {
            "status": "ok",
            "engine_version": ENGINE_VERSION,
            "limits": {
                "max_file_bytes": limits.max_file_bytes,
                "max_pages": limits.max_pages,
            },
        }

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
