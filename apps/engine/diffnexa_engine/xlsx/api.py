"""The Excel Compare response.

Everything the comparison workspace needs, in one reply:

* **changes** — each with the place a reader uses ("Pricing", "F22") on both
  sides, the cell as it was and as it is (value, how it is shown, formula,
  link), the difference, and the evidence. Where a change exists on one side
  only (an added row), the other side names the nearest place and says that it
  is only the nearest.
* **groups** — Values, Formulas, Structure and Links, each change in exactly one.
* **sheets** — how the sheets were paired, and which rows and columns of each
  pair were matched, so the two views can be moved together.
* **grids** — every non-empty cell of both workbooks, so the browser can draw
  both spreadsheets. They are the user's own files, returned to the user who
  uploaded them; nothing is kept.
"""

from __future__ import annotations

from typing import Any

from diffnexa_engine.contracts.changes import ChangeCategory
from diffnexa_engine.xlsx.compare import CellSnapshot, ExcelChange, ExcelComparisonOutcome, Place
from diffnexa_engine.xlsx.model import Cell, Workbook

GROUPS: tuple[tuple[str, str], ...] = (
    ("values", "Values"),
    ("formulas", "Formulas"),
    ("structure", "Structure"),
    ("links", "Links"),
)

_KIND_CODES = {"number": "n", "date": "d", "text": "s", "bool": "b", "error": "e", "empty": "x"}


def group_of(item: ExcelChange) -> str:
    category = item.change.category
    if category is ChangeCategory.FORMULA:
        return "formulas"
    if category is ChangeCategory.LAYOUT:
        return "structure"
    if category is ChangeCategory.LINK:
        return "links"
    return "values"


def _cell(snapshot: CellSnapshot | None) -> dict[str, Any] | None:
    if snapshot is None:
        return None
    return {
        "value": snapshot.value,
        "display": snapshot.display,
        "kind": snapshot.kind,
        "formula": f"={snapshot.formula}" if snapshot.formula else None,
        "link": snapshot.link,
    }


def _place(
    place: Place | None, snapshot: CellSnapshot | None, cells: tuple[str, ...]
) -> dict[str, Any] | None:
    if place is None:
        return None
    return {
        "sheet": place.sheet,
        "ref": place.ref,
        "exact": place.exact,
        "note": place.note,
        "cell": _cell(snapshot),
        "cells": list(cells),
    }


def _grid_cell(cell: Cell) -> list[Any]:
    row: list[Any] = [cell.row, cell.col, cell.display, _KIND_CODES[cell.kind]]
    if cell.formula or cell.link:
        row.append(f"={cell.formula}" if cell.formula else None)
    if cell.link:
        row.append(cell.link)
    return row


def _grids(book: Workbook) -> list[dict[str, Any]]:
    return [
        {
            "name": sheet.name,
            "index": sheet.index,
            "kind": sheet.kind,
            "state": sheet.state,
            "rows": sheet.max_row,
            "cols": sheet.max_col,
            "merges": list(sheet.merges),
            "cells": [_grid_cell(cell) for cell in sheet.cells],
        }
        for sheet in book.sheets
    ]


def _workbook(book: Workbook) -> dict[str, Any]:
    return {
        "sha256": book.content_sha256,
        "sheetCount": len(book.sheets),
        "cellCount": book.cell_count,
        "date1904": book.date1904,
        "warnings": list(book.warnings),
    }


def serialize_excel_comparison(outcome: ExcelComparisonOutcome, processing_ms: int) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    for number, item in enumerate(outcome.changes, start=1):
        change = item.change
        primary = item.revised if item.revised is not None and item.revised.exact else item.original
        if primary is None:
            primary = item.revised
        assert primary is not None
        changes.append(
            {
                "id": change.id,
                "number": number,
                "seq": change.seq,
                "type": change.change_type.value,
                "kind": change.kind.value,
                "category": change.category.value,
                "subtype": change.subtype,
                "group": group_of(item),
                "sheet": primary.sheet,
                "ref": primary.ref,
                "label": change.label,
                "oldValue": change.old_value,
                "newValue": change.new_value,
                "delta": change.delta,
                "confidence": change.confidence,
                "original": _place(item.original, item.before, item.original_cells),
                "revised": _place(item.revised, item.after, item.revised_cells),
                "evidence": [
                    {
                        "side": evidence.side.value,
                        "sheet": evidence.sheet,
                        "cell": evidence.cell_ref,
                        "excerpt": evidence.excerpt,
                    }
                    for evidence in change.evidence
                ],
            }
        )

    return {
        "engineVersion": outcome.result.engine_version,
        "processingMs": processing_ms,
        "workbooks": {"original": _workbook(outcome.previous), "revised": _workbook(outcome.current)},
        "counts": {"total": len(changes)},
        "options": {
            "ignoreCase": outcome.options.ignore_case,
            "ignoreWhitespace": outcome.options.ignore_whitespace,
        },
        "groups": [
            {
                "id": group_id,
                "label": label,
                "changeCount": sum(1 for change in changes if change["group"] == group_id),
                "changeIds": [change["id"] for change in changes if change["group"] == group_id],
            }
            for group_id, label in GROUPS
        ],
        "changes": changes,
        "sheets": [
            {
                "original": pairing.original.name if pairing.original else None,
                "revised": pairing.revised.name if pairing.revised else None,
                "status": pairing.status,
                "rows": [list(pair) for pair in pairing.rows],
                "columns": [list(pair) for pair in pairing.columns],
            }
            for pairing in outcome.sheets
        ],
        "grids": {"original": _grids(outcome.previous), "revised": _grids(outcome.current)},
        "diagnostics": {
            "notes": list(outcome.diagnostics.notes),
            "droppedUntraceable": outcome.diagnostics.dropped_untraceable,
        },
    }


__all__ = ["GROUPS", "group_of", "serialize_excel_comparison"]
