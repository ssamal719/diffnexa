"""Formula text, never formula evaluation.

When a formula is filled down or across, Excel stores its text once, on the
first cell, and marks the others as sharing it. To show each cell its own
formula ("=B7*C7", not "=B2*C2"), the shared text is moved to that cell exactly
as Excel moves it when copying: relative references shift by the distance
between the cells, `$`-anchored parts stay put, and a reference pushed off the
sheet becomes `#REF!`. Text in quotes, sheet names and table references are
left untouched.

Nothing here calculates a formula. A formula's result is only ever the value
the spreadsheet application stored in the file.
"""

from __future__ import annotations

import re

MAX_ROW = 1_048_576
MAX_COL = 16_384

_CELL = re.compile(r"(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?![A-Za-z0-9_(!.])")
_COLUMNS = re.compile(r"(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(!.])")
_ROWS = re.compile(r"(\$?)([0-9]{1,7}):(\$?)([0-9]{1,7})(?![A-Za-z0-9_(!.])")
_WORD = re.compile(r"[A-Za-z0-9_.]")


def column_number(letters: str) -> int:
    number = 0
    for ch in letters.upper():
        number = number * 26 + (ord(ch) - 64)
    return number


def column_letters(number: int) -> str:
    letters = ""
    while number > 0:
        number, remainder = divmod(number - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def split_ref(ref: str) -> tuple[int, int]:
    """'F22' as (row 22, column 6). Raises ValueError for anything else."""
    match = re.fullmatch(r"\$?([A-Za-z]{1,3})\$?([0-9]{1,7})", ref)
    if not match:
        raise ValueError(f"not a cell reference: {ref!r}")
    row, col = int(match.group(2)), column_number(match.group(1))
    if not (1 <= row <= MAX_ROW and 1 <= col <= MAX_COL):
        raise ValueError(f"cell reference off the sheet: {ref!r}")
    return row, col


def cell_ref(row: int, col: int) -> str:
    return f"{column_letters(col)}{row}"


def _shift_cell(match: re.Match[str], dr: int, dc: int) -> str:
    col_abs, letters, row_abs, digits = match.groups()
    col = column_number(letters) + (0 if col_abs else dc)
    row = int(digits) + (0 if row_abs else dr)
    if not (1 <= col <= MAX_COL and 1 <= row <= MAX_ROW):
        return "#REF!"
    return f"{col_abs}{column_letters(col)}{row_abs}{row}"


def _shift_columns(match: re.Match[str], dc: int) -> str:
    a_abs, a, b_abs, b = match.groups()
    first = column_number(a) + (0 if a_abs else dc)
    last = column_number(b) + (0 if b_abs else dc)
    if not (1 <= first <= MAX_COL and 1 <= last <= MAX_COL):
        return "#REF!"
    return f"{a_abs}{column_letters(first)}:{b_abs}{column_letters(last)}"


def _shift_rows(match: re.Match[str], dr: int) -> str:
    a_abs, a, b_abs, b = match.groups()
    first = int(a) + (0 if a_abs else dr)
    last = int(b) + (0 if b_abs else dr)
    if not (1 <= first <= MAX_ROW and 1 <= last <= MAX_ROW):
        return "#REF!"
    return f"{a_abs}{first}:{b_abs}{last}"


def translate(formula: str, origin: str, target: str) -> str:
    """The formula written in `origin`, as it reads when copied to `target`."""
    from_row, from_col = split_ref(origin)
    to_row, to_col = split_ref(target)
    dr, dc = to_row - from_row, to_col - from_col
    if dr == 0 and dc == 0:
        return formula

    out: list[str] = []
    i = 0
    n = len(formula)
    while i < n:
        ch = formula[i]
        if ch == '"':  # text constant; "" is an escaped quote
            j = i + 1
            while j < n:
                if formula[j] == '"':
                    if j + 1 < n and formula[j + 1] == '"':
                        j += 2
                        continue
                    break
                j += 1
            out.append(formula[i : j + 1])
            i = j + 1
            continue
        if ch == "'":  # quoted sheet name; '' is an escaped quote
            j = i + 1
            while j < n:
                if formula[j] == "'":
                    if j + 1 < n and formula[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append(formula[i : j + 1])
            i = j + 1
            continue
        if ch == "[":  # structured table references and external workbook indexes
            depth, j = 0, i
            while j < n:
                if formula[j] == "[":
                    depth += 1
                elif formula[j] == "]":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            out.append(formula[i : j + 1])
            i = j + 1
            continue
        preceded_by_word = i > 0 and bool(_WORD.match(formula[i - 1]))
        if not preceded_by_word:
            for pattern, shift in (
                (_COLUMNS, lambda m: _shift_columns(m, dc)),
                (_ROWS, lambda m: _shift_rows(m, dr)),
                (_CELL, lambda m: _shift_cell(m, dr, dc)),
            ):
                match = pattern.match(formula, i)
                if match:
                    out.append(shift(match))
                    i = match.end()
                    break
            else:
                out.append(ch)
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


__all__ = ["cell_ref", "column_letters", "column_number", "split_ref", "translate"]
