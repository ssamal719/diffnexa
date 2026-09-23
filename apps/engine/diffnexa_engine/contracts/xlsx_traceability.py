"""Checking that workbook evidence really points into the workbooks it cites.

The same guarantee every other format gives: a change is only returned if each
piece of its evidence can be found where it says. For a workbook that means:

* the evidence is cell-scope and names the fingerprint of the workbook on its
  side (so evidence can never be attributed to the wrong file);
* the sheet it names exists in that workbook;
* the cell it names holds a value or formula in that sheet; and
* the quotation is exactly what that cell shows — its value as formatted, its
  formula, or (for a long value) the beginning of it.

Evidence for a whole sheet (no cell) must quote the sheet's name. Every rule
refuses rather than repairs.
"""

from __future__ import annotations

from collections.abc import Iterable

from diffnexa_engine.contracts.changes import Change, Side
from diffnexa_engine.contracts.traceability import TraceIssue
from diffnexa_engine.xlsx.formula import split_ref
from diffnexa_engine.xlsx.model import Cell, Workbook


def _quotes(cell: Cell) -> set[str]:
    options = {cell.display, cell.value}
    if cell.formula:
        options.add(f"={cell.formula}")
    return {option.strip() for option in options if option}


def _matches(excerpt: str, cell: Cell) -> bool:
    options = _quotes(cell)
    if excerpt in options:
        return True
    if excerpt.endswith("…"):
        start = excerpt[:-1].rstrip()
        return any(option.startswith(start) for option in options)
    return False


def verify_xlsx_traceability(changes: Iterable[Change], old: Workbook, new: Workbook) -> list[TraceIssue]:
    """Every reason a change's evidence cannot be found in the workbooks it cites."""
    books = {Side.OLD: old, Side.NEW: new}
    grids: dict[tuple[Side, str], dict[tuple[int, int], Cell]] = {}
    issues: list[TraceIssue] = []

    for change in changes:
        for evidence in change.evidence:
            side = evidence.side.value
            book = books[evidence.side]
            if evidence.scope != "cell":
                issues.append(TraceIssue(change.id, "workbook changes must cite cells or sheets"))
                continue
            if evidence.snapshot_sha256 != book.content_sha256:
                issues.append(TraceIssue(change.id, f"evidence cites a different {side} workbook"))
                continue
            sheet = book.sheet(evidence.sheet or "")
            if sheet is None:
                issues.append(TraceIssue(change.id, f"the {side} workbook has no sheet {evidence.sheet!r}"))
                continue
            if evidence.cell_ref is None:
                if (evidence.excerpt or "") != sheet.name[: len(evidence.excerpt or "")].strip() and not (
                    (evidence.excerpt or "").endswith("…")
                    and sheet.name.startswith((evidence.excerpt or "")[:-1].rstrip())
                ):
                    issues.append(TraceIssue(change.id, "sheet evidence does not quote the sheet's name"))
                continue
            key = (evidence.side, sheet.name)
            if key not in grids:
                grids[key] = sheet.grid()
            try:
                position = split_ref(evidence.cell_ref)
            except ValueError:
                issues.append(TraceIssue(change.id, f"{evidence.cell_ref!r} is not a cell"))
                continue
            cell = grids[key].get(position)
            if cell is None:
                issues.append(
                    TraceIssue(change.id, f"{sheet.name}!{evidence.cell_ref} is empty in the {side} workbook")
                )
                continue
            if not evidence.excerpt or not _matches(evidence.excerpt, cell):
                issues.append(
                    TraceIssue(
                        change.id, f"{sheet.name}!{evidence.cell_ref} does not hold what the evidence quotes"
                    )
                )
    return issues


__all__ = ["verify_xlsx_traceability"]
