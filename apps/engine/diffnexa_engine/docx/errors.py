"""User-facing errors for Word documents.

Separate from the PDF and webpage errors because a Word file fails in its own
ways: it can be an old .doc, a macro-enabled .docm, or hold tracked changes that
have not been accepted. The discipline is the same as elsewhere — a short code
the interface maps to wording, and a detail string that stays in the server log
and never contains document text.

Codes and messages must match the `docx_messages` section of
packages/contracts/errors.json exactly; a test enforces it.
"""

from __future__ import annotations

from enum import StrEnum


class DocxErrorCode(StrEnum):
    NOT_DOCX = "docx_not_docx"
    LEGACY_DOC = "docx_legacy_doc"
    MACRO_ENABLED = "docx_macro_enabled"
    ENCRYPTED = "docx_encrypted"
    UNREADABLE = "docx_unreadable"
    TOO_LARGE = "docx_too_large"
    TOO_COMPLEX = "docx_too_complex"
    TRACKED_CHANGES = "docx_tracked_changes"
    EMPTY_FILE = "docx_empty_file"


DOCX_MESSAGES: dict[DocxErrorCode, str] = {
    DocxErrorCode.NOT_DOCX: ("That file isn't a Word .docx document. DOCX Compare reads .docx files only."),
    DocxErrorCode.LEGACY_DOC: (
        "That looks like an older Word .doc file. Open it in Word, save it as .docx, then compare again."
    ),
    DocxErrorCode.MACRO_ENABLED: (
        "That is a macro-enabled Word file (.docm). For safety, DOCX Compare reads plain .docx files "
        "only. Save it as a .docx without macros, then compare again."
    ),
    DocxErrorCode.ENCRYPTED: (
        "This document is password protected. Remove the password in Word, then compare again."
    ),
    DocxErrorCode.UNREADABLE: (
        "That file couldn't be read as a Word document. It may be damaged, or not a real .docx file."
    ),
    DocxErrorCode.TOO_LARGE: (
        "That document is too large to compare. Try a smaller document, or one without large images."
    ),
    DocxErrorCode.TOO_COMPLEX: (
        "That document has more content than DOCX Compare can compare at once. Try comparing a "
        "shorter document."
    ),
    DocxErrorCode.TRACKED_CHANGES: (
        "This document contains tracked changes that haven't been accepted or rejected. Accept or "
        "reject them in Word, save, then compare again."
    ),
    DocxErrorCode.EMPTY_FILE: "That file is empty. Choose the Word document you want to compare.",
}


class DocxError(Exception):
    """A Word document that cannot be compared. `code` is safe to show."""

    def __init__(self, code: DocxErrorCode, detail: str = "", side: str | None = None) -> None:
        self.code = code
        self.detail = detail  # server log only; never includes document text
        self.side = side
        super().__init__(f"{code.value}: {detail}" if detail else code.value)

    @property
    def user_message(self) -> str:
        return DOCX_MESSAGES[self.code]


__all__ = ["DOCX_MESSAGES", "DocxError", "DocxErrorCode"]
