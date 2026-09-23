"""A workbook, reduced to what can be compared and shown.

Each non-empty cell keeps its address, what kind of value it holds, the value as
stored in the file, the value as the workbook's number format shows it, its
formula text (never evaluated) and its hyperlink. Sheets keep their name, order,
visibility and merged ranges.

Everything is plain, immutable data built in a fixed order, so the same
workbook always produces the same model and the same fingerprint, however the
file was zipped or which application saved it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Literal

from diffnexa_engine.xlsx.formula import cell_ref

CellKind = Literal["number", "date", "text", "bool", "error", "empty"]
SheetKind = Literal["worksheet", "chartsheet", "other"]
SheetState = Literal["visible", "hidden", "veryHidden"]


@dataclass(frozen=True, slots=True)
class Cell:
    row: int
    col: int
    #: "empty" is a formula whose result was not stored in the file.
    kind: CellKind
    #: As stored: numbers and dates as plain decimals ("299", "46295"), text as
    #: written, TRUE/FALSE, or an error such as "#DIV/0!".
    value: str
    #: As the number format shows it ("$299.00", "30 September 2026").
    display: str
    #: Formula text without the leading "=", or None.
    formula: str | None = None
    #: The number format code, when it is not General.
    number_format: str | None = None
    #: Where a hyperlink on this cell points, as written in the file.
    link: str | None = None

    @property
    def ref(self) -> str:
        return cell_ref(self.row, self.col)

    def canonical(self) -> list[object]:
        return [self.ref, self.kind, self.value, self.display, self.formula, self.number_format, self.link]


@dataclass(frozen=True)
class Sheet:
    name: str
    index: int
    kind: SheetKind
    state: SheetState
    cells: tuple[Cell, ...]
    merges: tuple[str, ...] = ()

    @property
    def max_row(self) -> int:
        return max((cell.row for cell in self.cells), default=0)

    @property
    def max_col(self) -> int:
        return max((cell.col for cell in self.cells), default=0)

    def grid(self) -> dict[tuple[int, int], Cell]:
        return {(cell.row, cell.col): cell for cell in self.cells}

    def canonical(self) -> dict[str, object]:
        return {
            "name": self.name,
            "kind": self.kind,
            "state": self.state,
            "cells": [cell.canonical() for cell in self.cells],
            "merges": list(self.merges),
        }


@dataclass(frozen=True)
class Workbook:
    sheets: tuple[Sheet, ...]
    date1904: bool
    content_sha256: str
    warnings: tuple[str, ...] = ()
    extractor: str = "diffnexa-xlsx"
    extractor_version: str = "2026.09.1"
    _by_name: dict[str, Sheet] = field(default_factory=dict, compare=False, repr=False)

    def __post_init__(self) -> None:
        self._by_name.update({sheet.name: sheet for sheet in self.sheets})

    def sheet(self, name: str) -> Sheet | None:
        return self._by_name.get(name)

    @property
    def cell_count(self) -> int:
        return sum(len(sheet.cells) for sheet in self.sheets)


def fingerprint(sheets: tuple[Sheet, ...], date1904: bool) -> str:
    """A SHA-256 of the workbook's content — not of the file's bytes."""
    payload = {"date1904": date1904, "sheets": [sheet.canonical() for sheet in sheets]}
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


__all__ = ["Cell", "CellKind", "Sheet", "SheetKind", "SheetState", "Workbook", "fingerprint"]
