"""Validation decides from the file's bytes only — never from its name or declared type."""

import pytest

from diffnexa_engine.adapters.pdf.probe import has_pdf_signature, probe_pdf
from diffnexa_engine.config import EngineLimits
from diffnexa_engine.errors import ErrorCode

from .helpers.pdfs import PNG_BYTES, encrypted_pdf, text_pdf

LIMITS = EngineLimits(max_file_bytes=5 * 1024 * 1024, max_pages=10)


def test_valid_pdf():
    data = text_pdf([["one"], ["two"], ["three"]])
    result = probe_pdf(data, LIMITS)
    assert result.ok and result.page_count == 3 and result.error is None
    assert len(result.sha256) == 64 and result.size_bytes == len(data)


@pytest.mark.parametrize(
    "data, code",
    [
        (b"", ErrorCode.EMPTY_FILE),
        (PNG_BYTES, ErrorCode.NOT_PDF),
        (b"Hello, this is plain text pretending to be a PDF", ErrorCode.NOT_PDF),
        (b"%PDF-1.7\nthis header is real but nothing else is", ErrorCode.CORRUPTED),
    ],
)
def test_rejections(data, code):
    result = probe_pdf(data, LIMITS)
    assert not result.ok and result.error is code


def test_truncated_pdf_is_corrupted():
    data = text_pdf([["some text"]])
    assert probe_pdf(data[: len(data) // 3], LIMITS).error is ErrorCode.CORRUPTED


def test_password_protected():
    data = encrypted_pdf(text_pdf([["secret"]]), user="open-sesame")
    assert probe_pdf(data, LIMITS).error is ErrorCode.PASSWORD_PROTECTED


def test_owner_password_only_is_accepted():
    """Permission-restricted PDFs open without a password, so they can be compared."""
    data = encrypted_pdf(text_pdf([["restricted"]]), user="")
    result = probe_pdf(data, LIMITS)
    assert result.ok and result.is_encrypted


def test_size_limit():
    data = text_pdf([["x"]])
    tiny = EngineLimits(max_file_bytes=len(data) - 1, max_pages=10)
    assert probe_pdf(data, tiny).error is ErrorCode.FILE_TOO_LARGE


def test_page_limit():
    data = text_pdf([[str(i)] for i in range(4)])
    result = probe_pdf(data, EngineLimits(max_file_bytes=10**7, max_pages=3))
    assert result.error is ErrorCode.TOO_MANY_PAGES and result.page_count == 4


def test_signature_may_follow_leading_bytes():
    assert has_pdf_signature(b"\x00" * 100 + b"%PDF-1.4")
    assert not has_pdf_signature(b"\x00" * 2000 + b"%PDF-1.4")
