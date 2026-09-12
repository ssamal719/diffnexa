"""User-facing document errors.

Codes and messages must match packages/contracts/errors.json exactly; a test
enforces this. Internal details are kept separate and never shown to users.
"""

from __future__ import annotations

from enum import StrEnum


class ErrorCode(StrEnum):
    NOT_PDF = "not_pdf"
    EMPTY_FILE = "empty_file"
    FILE_TOO_LARGE = "file_too_large"
    TOO_MANY_PAGES = "too_many_pages"
    PASSWORD_PROTECTED = "password_protected"
    CORRUPTED = "corrupted"
    NO_PAGES = "no_pages"
    EXTRACTION_FAILED = "extraction_failed"


USER_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.NOT_PDF: ("This file isn't a PDF. Choose a file that ends in .pdf and was saved as a PDF."),
    ErrorCode.EMPTY_FILE: ("This file is empty. Choose the PDF again, or re-save it and try once more."),
    ErrorCode.FILE_TOO_LARGE: ("This PDF is larger than the current size limit. Choose a smaller file."),
    ErrorCode.TOO_MANY_PAGES: (
        "This PDF has more pages than the current page limit. Choose a shorter document."
    ),
    ErrorCode.PASSWORD_PROTECTED: (
        "This PDF is password protected. Remove the password in your PDF reader, "
        "save a copy, and upload that copy."
    ),
    ErrorCode.CORRUPTED: (
        "This PDF appears to be damaged and can't be read. Re-download or re-export it and try again."
    ),
    ErrorCode.NO_PAGES: "This PDF has no pages to compare. Choose a different file.",
    ErrorCode.EXTRACTION_FAILED: (
        "Unable to read this PDF's contents. Try re-saving it as a new PDF and upload it again."
    ),
}


class DocumentError(Exception):
    """A PDF could not be accepted or read.

    `code` is safe to show (via USER_MESSAGES); `detail` is for logs only.
    """

    def __init__(self, code: ErrorCode, detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"{code.value}: {detail}" if detail else code.value)

    @property
    def user_message(self) -> str:
        return USER_MESSAGES[self.code]
