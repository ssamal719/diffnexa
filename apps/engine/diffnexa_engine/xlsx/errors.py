"""User-facing errors for Excel workbooks.

A workbook fails in its own ways: it can be an old .xls, a macro-enabled .xlsm,
a binary .xlsb, password protected, or simply larger than one comparison can
show. The discipline is the same as for the other formats — a short code the
interface maps to wording, and a detail string that stays in the server log and
never contains workbook content.

Codes and messages must match the `excel_messages` section of
packages/contracts/errors.json exactly; a test enforces it.
"""

from __future__ import annotations

from enum import StrEnum


class ExcelErrorCode(StrEnum):
    NOT_XLSX = "excel_not_xlsx"
    LEGACY_XLS = "excel_legacy_xls"
    MACRO_ENABLED = "excel_macro_enabled"
    UNSUPPORTED = "excel_unsupported"
    ENCRYPTED = "excel_encrypted"
    UNREADABLE = "excel_unreadable"
    TOO_LARGE = "excel_too_large"
    TOO_COMPLEX = "excel_too_complex"
    NO_SHEETS = "excel_no_sheets"
    EMPTY_FILE = "excel_empty_file"


EXCEL_MESSAGES: dict[ExcelErrorCode, str] = {
    ExcelErrorCode.NOT_XLSX: "That file isn't an Excel .xlsx workbook. Excel Compare reads .xlsx files only.",
    ExcelErrorCode.LEGACY_XLS: (
        "That looks like an older Excel .xls file. Open it in Excel, save it as .xlsx, then compare again."
    ),
    ExcelErrorCode.MACRO_ENABLED: (
        "That is a macro-enabled Excel file (.xlsm). For safety, Excel Compare reads plain .xlsx files "
        "only. Save it as a .xlsx without macros, then compare again."
    ),
    ExcelErrorCode.UNSUPPORTED: (
        "That Excel file is saved in a format Excel Compare can't read yet, such as a binary .xlsb "
        "workbook or a template. Save it as an ordinary .xlsx workbook, then compare again."
    ),
    ExcelErrorCode.ENCRYPTED: (
        "This workbook is password protected. Remove the password in Excel, then compare again."
    ),
    ExcelErrorCode.UNREADABLE: (
        "That file couldn't be read as an Excel workbook. It may be damaged, or not a real .xlsx file."
    ),
    ExcelErrorCode.TOO_LARGE: (
        "That workbook is too large to compare. Try a smaller workbook, or one without large images."
    ),
    ExcelErrorCode.TOO_COMPLEX: (
        "That workbook has more cells or sheets than Excel Compare can show at once. Try comparing a "
        "smaller workbook, or only the sheets you need."
    ),
    ExcelErrorCode.NO_SHEETS: "That workbook has no worksheets to compare.",
    ExcelErrorCode.EMPTY_FILE: "That file is empty. Choose the Excel workbook you want to compare.",
}


class ExcelError(Exception):
    """A workbook that cannot be compared, and why.

    `detail` is for the server log only. It never contains cell contents.
    """

    def __init__(self, code: ExcelErrorCode, detail: str, side: str | None = None) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.side = side

    @property
    def user_message(self) -> str:
        return EXCEL_MESSAGES[self.code]


__all__ = ["EXCEL_MESSAGES", "ExcelError", "ExcelErrorCode"]
