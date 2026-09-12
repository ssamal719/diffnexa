"""Safe first look at an uploaded file.

Never trusts the filename or the declared MIME type: everything is decided from
the file's bytes. Returns a result instead of raising, so callers can show the
matching friendly message.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

import pikepdf

from diffnexa_engine.config import EngineLimits
from diffnexa_engine.errors import ErrorCode

# The PDF specification allows the header to appear within the first 1024 bytes.
HEADER_SEARCH_BYTES = 1024
PDF_SIGNATURE = b"%PDF-"


@dataclass(frozen=True)
class ProbeResult:
    ok: bool
    size_bytes: int
    sha256: str
    error: ErrorCode | None = None
    page_count: int | None = None
    pdf_version: str | None = None
    is_encrypted: bool = False
    detail: str = ""  # internal only; never shown to users


def has_pdf_signature(data: bytes) -> bool:
    return PDF_SIGNATURE in data[:HEADER_SEARCH_BYTES]


def probe_pdf(data: bytes, limits: EngineLimits | None = None) -> ProbeResult:
    limits = limits or EngineLimits.from_env()
    size = len(data)
    digest = hashlib.sha256(data).hexdigest()

    def fail(code: ErrorCode, detail: str = "", **extra: object) -> ProbeResult:
        return ProbeResult(ok=False, size_bytes=size, sha256=digest, error=code, detail=detail, **extra)  # type: ignore[arg-type]

    if size == 0:
        return fail(ErrorCode.EMPTY_FILE)
    if size > limits.max_file_bytes:
        return fail(ErrorCode.FILE_TOO_LARGE, f"{size} bytes > {limits.max_file_bytes}")
    if not has_pdf_signature(data):
        return fail(ErrorCode.NOT_PDF, "no %PDF- signature in the first 1024 bytes")

    try:
        with pikepdf.open(io.BytesIO(data)) as pdf:
            page_count = len(pdf.pages)
            version = str(pdf.pdf_version)
            encrypted = bool(pdf.is_encrypted)
    except pikepdf.PasswordError:
        return fail(ErrorCode.PASSWORD_PROTECTED, "a password is required to open this file")
    except pikepdf.PdfError as exc:
        return fail(ErrorCode.CORRUPTED, f"qpdf: {exc}")
    except Exception as exc:  # any parser failure means we can't safely read it
        return fail(ErrorCode.CORRUPTED, f"{type(exc).__name__}: {exc}")

    if page_count == 0:
        return fail(ErrorCode.NO_PAGES, pdf_version=version)
    if page_count > limits.max_pages:
        return fail(
            ErrorCode.TOO_MANY_PAGES,
            f"{page_count} pages > {limits.max_pages}",
            page_count=page_count,
            pdf_version=version,
        )

    return ProbeResult(
        ok=True,
        size_bytes=size,
        sha256=digest,
        page_count=page_count,
        pdf_version=version,
        is_encrypted=encrypted,
    )
