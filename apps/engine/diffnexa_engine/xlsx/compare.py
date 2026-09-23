"""Comparing two workbooks, cell by cell, with evidence for every change.

The order of work:

1. **Sheets** are paired by name. A sheet missing from one side and a new sheet
   on the other are treated as a rename only when their content shows it: the
   same cells, or mostly the same cells and no better candidate. A change in
   the order of the sheets is reported as sheets moved.
2. **Columns, then rows**, of each pair of sheets are matched by content
   (`align.py`), so an inserted row or column is reported once and the cells
   after it are compared with their true counterparts — original F21 with
   revised F22 when a row was inserted above.
3. **Cells** in matched rows and columns are compared on what the file stores,
   never on how it is formatted: numbers as numbers, dates as dates, text
   exactly, formulas as text. A value whose number format changed but whose
   stored value did not is a formatting change, which V1 does not report.

A cell that changed its formula is one change, showing the formula and the
stored result before and after — never a separate "value changed" for the same
cell. A cell whose formula is unchanged but whose stored result differs (because
something it refers to changed) is reported as a changed result, and says so.

Every change cites the cells or sheets it came from; `verify_xlsx_traceability`
checks each citation against the two workbooks before the result is returned.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from collections.abc import Hashable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.compare.values import TypedValue, ValueKind, compare_values, parse_whole_date
from diffnexa_engine.contracts.changes import (
    Change,
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    Evidence,
    Side,
    XlsxRef,
)
from diffnexa_engine.xlsx import numfmt
from diffnexa_engine.xlsx.align import align
from diffnexa_engine.xlsx.formula import cell_ref, column_letters, translate
from diffnexa_engine.xlsx.model import Cell, Sheet, Workbook

EXCERPT_CHARS = 240
#: Cells quoted as evidence for a whole row or column: enough to find it.
EVIDENCE_CELLS = 5
PREVIEW_CELLS = 8

COLUMN_THRESHOLD = 0.34
ROW_THRESHOLD = 0.5
RENAME_THRESHOLD = 0.5


# ---------------------------------------------------------------- results


@dataclass(frozen=True)
class Place:
    """A cell or range on one side, as a reader names it."""

    sheet: str
    ref: str | None  # "F22" or "A5:F5"; None for the sheet itself
    exact: bool = True
    #: Why this place is only the nearest one (a row that exists on one side only).
    note: str | None = None


@dataclass(frozen=True)
class CellSnapshot:
    value: str
    display: str
    kind: str
    formula: str | None
    link: str | None


@dataclass(frozen=True)
class ExcelChange:
    change: Change
    original: Place | None
    revised: Place | None
    before: CellSnapshot | None = None
    after: CellSnapshot | None = None
    #: Cells covered by a row, column or sheet change, for highlighting.
    original_cells: tuple[str, ...] = ()
    revised_cells: tuple[str, ...] = ()


@dataclass
class SheetPairing:
    original: Sheet | None
    revised: Sheet | None
    status: Literal["same", "renamed", "added", "removed"]
    rows: list[tuple[int, int]] = field(default_factory=list)
    columns: list[tuple[int, int]] = field(default_factory=list)


@dataclass
class ExcelDiagnostics:
    dropped_untraceable: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass
class ExcelComparisonOutcome:
    result: ComparisonResult
    changes: list[ExcelChange]
    sheets: list[SheetPairing]
    diagnostics: ExcelDiagnostics
    previous: Workbook
    current: Workbook


# ---------------------------------------------------------------- evidence


def _excerpt(text: str) -> str:
    text = text.strip() or text
    if len(text) <= EXCERPT_CHARS:
        return text
    return text[: EXCERPT_CHARS - 1].rstrip() + "…"


def shown(cell: Cell) -> str:
    """What a reader sees for a cell: its value, or its formula if it has no stored result."""
    if cell.display:
        return cell.display
    if cell.formula:
        return f"={cell.formula}"
    return cell.value


def cell_evidence(book: Workbook, sheet: Sheet, cell: Cell, side: Side) -> Evidence:
    return Evidence(
        side=side,
        scope="cell",
        snapshot_sha256=book.content_sha256,
        sheet=sheet.name,
        cell_ref=cell.ref,
        excerpt=_excerpt(shown(cell) or cell.ref),
    )


def sheet_evidence(book: Workbook, sheet: Sheet, side: Side) -> Evidence:
    return Evidence(
        side=side,
        scope="cell",
        snapshot_sha256=book.content_sha256,
        sheet=sheet.name,
        excerpt=_excerpt(sheet.name),
    )


def _snapshot(cell: Cell | None) -> CellSnapshot | None:
    if cell is None:
        return None
    return CellSnapshot(cell.value, cell.display, cell.kind, cell.formula, cell.link)


# ---------------------------------------------------------------- building changes


class _Builder:
    def __init__(self) -> None:
        self.items: list[tuple[tuple, ExcelChange]] = []

    def add(
        self, order: tuple, *, original, revised, before=None, after=None, cells=((), ()), **fields
    ) -> None:
        seq = len(self.items)
        change = Change(id=f"c{seq}", seq=seq, **fields)
        self.items.append(
            (
                order,
                ExcelChange(change, original, revised, before, after, tuple(cells[0]), tuple(cells[1])),
            )
        )

    def finish(self) -> list[ExcelChange]:
        ordered = [item for _order, item in sorted(self.items, key=lambda pair: pair[0])]
        return [
            ExcelChange(
                item.change.model_copy(update={"id": f"c{index}", "seq": index}),
                item.original,
                item.revised,
                item.before,
                item.after,
                item.original_cells,
                item.revised_cells,
            )
            for index, item in enumerate(ordered)
        ]


def _label(sheet: str, ref: str | None) -> str:
    return f"{sheet} · {ref}" if ref else sheet


def _number_value(cell: Cell) -> Decimal | None:
    try:
        return Decimal(cell.value)
    except ArithmeticError:
        return None


def _as_date(cell: Cell, date1904: bool) -> dt.date | None:
    if cell.kind != "date":
        return None
    number = _number_value(cell)
    if number is not None:
        moment = numfmt.serial_to_datetime(float(number), date1904)
        return moment.date() if moment else None
    try:
        return dt.date.fromisoformat(cell.value[:10])
    except ValueError:
        return None


def _is_percent(cell: Cell) -> bool:
    return bool(cell.number_format) and numfmt.classify(cell.number_format or "") == "percent"


def _delta(old: Cell, new: Cell, old_book: Workbook, new_book: Workbook) -> tuple[ChangeCategory, str | None]:
    """The kind of value change, and the difference where one is meaningful."""
    if old.kind == "date" and new.kind == "date":
        before, after = _as_date(old, old_book.date1904), _as_date(new, new_book.date1904)
        if before and after:
            delta = compare_values(
                TypedValue(ValueKind.DATE, old.display, day=before.day, month=before.month, year=before.year),
                TypedValue(ValueKind.DATE, new.display, day=after.day, month=after.month, year=after.year),
            )
            return ChangeCategory.DATE, delta.summary if delta else None
        return ChangeCategory.DATE, None
    if old.kind == "number" and new.kind == "number":
        a, b = _number_value(old), _number_value(new)
        if a is None or b is None:
            return ChangeCategory.NUMBER, None
        if _is_percent(old) and _is_percent(new):
            points = (b - a) * 100
            sign = "+" if points > 0 else "-"
            magnitude = format(abs(points).normalize(), "f")
            return ChangeCategory.NUMBER, f"{sign}{magnitude} percentage points"
        delta = compare_values(
            TypedValue(ValueKind.NUMBER, old.display, number=a),
            TypedValue(ValueKind.NUMBER, new.display, number=b),
        )
        return ChangeCategory.NUMBER, delta.summary if delta else None
    if old.kind == "text" and new.kind == "text":
        # Text that is a whole date on both sides is compared as a date.
        before, after = parse_whole_date(old.value), parse_whole_date(new.value)
        if before and after and not before.ambiguous and not after.ambiguous:
            delta = compare_values(before, after)
            return ChangeCategory.DATE, delta.summary if delta else None
    return ChangeCategory.TEXT, None


def _same_value(old: Cell, new: Cell) -> bool:
    if old.kind in ("number", "date") and new.kind in ("number", "date"):
        a, b = _number_value(old), _number_value(new)
        if a is not None and b is not None:
            return a == b  # the same stored value; a format change is not compared
    return old.kind == new.kind and old.value == new.value


def _category_for(cell: Cell) -> ChangeCategory:
    if cell.formula:
        return ChangeCategory.FORMULA
    if cell.kind == "number":
        return ChangeCategory.NUMBER
    if cell.kind == "date":
        return ChangeCategory.DATE
    return ChangeCategory.TEXT


def _with_formula(cell: Cell) -> str:
    return f"={cell.formula}" if cell.formula else shown(cell)


def _compare_cell(
    builder: _Builder,
    order: tuple,
    pair: tuple[Sheet, Sheet],
    refs: tuple[str, str],
    old: Cell | None,
    new: Cell | None,
    books: tuple[Workbook, Workbook],
) -> None:
    old_sheet, new_sheet = pair
    old_book, new_book = books
    if old is None and new is None:
        return
    if old is None:
        assert new is not None
        builder.add(
            order,
            original=Place(old_sheet.name, refs[0], note="This cell is empty in the original."),
            revised=Place(new_sheet.name, new.ref),
            after=_snapshot(new),
            cells=((), (new.ref,)),
            kind=ChangeKind.ADDED,
            category=_category_for(new),
            subtype="cell",
            label=_label(new_sheet.name, new.ref),
            new_value=_excerpt(_with_formula(new) if new.formula and not new.display else shown(new)),
            evidence=(cell_evidence(new_book, new_sheet, new, Side.NEW),),
        )
        return
    if new is None:
        builder.add(
            order,
            original=Place(old_sheet.name, old.ref),
            revised=Place(new_sheet.name, refs[1], note="This cell is empty in the revised workbook."),
            before=_snapshot(old),
            cells=((old.ref,), ()),
            kind=ChangeKind.REMOVED,
            category=_category_for(old),
            subtype="cell",
            label=_label(old_sheet.name, old.ref),
            old_value=_excerpt(_with_formula(old) if old.formula and not old.display else shown(old)),
            evidence=(cell_evidence(old_book, old_sheet, old, Side.OLD),),
        )
        return

    evidence = (
        cell_evidence(old_book, old_sheet, old, Side.OLD),
        cell_evidence(new_book, new_sheet, new, Side.NEW),
    )
    places = {"original": Place(old_sheet.name, old.ref), "revised": Place(new_sheet.name, new.ref)}
    snapshots = {"before": _snapshot(old), "after": _snapshot(new), "cells": ((old.ref,), (new.ref,))}
    label = _label(new_sheet.name, new.ref)

    formula_changed = (old.formula or None) != (new.formula or None)
    if formula_changed and not _formula_moved_with_row(old, new):
        builder.add(
            order,
            **places,
            **snapshots,
            kind=ChangeKind.MODIFIED,
            category=ChangeCategory.FORMULA,
            subtype="formula",
            label=label,
            old_value=_excerpt(_with_formula(old)),
            new_value=_excerpt(_with_formula(new)),
            evidence=evidence,
        )
    elif not _same_value(old, new) and not (old.kind == "empty" or new.kind == "empty"):
        category, delta = _delta(old, new, old_book, new_book)
        builder.add(
            order,
            **places,
            **snapshots,
            kind=ChangeKind.MODIFIED,
            category=category,
            subtype="calculated" if old.formula and new.formula else "cell",
            label=label,
            old_value=_excerpt(shown(old)),
            new_value=_excerpt(shown(new)),
            delta=delta,
            evidence=evidence,
        )

    if (old.link or None) != (new.link or None):
        kind = (
            ChangeKind.MODIFIED
            if old.link and new.link
            else ChangeKind.ADDED
            if new.link
            else ChangeKind.REMOVED
        )
        builder.add(
            (*order, 1),
            **places,
            **snapshots,
            kind=kind,
            category=ChangeCategory.LINK,
            subtype="hyperlink",
            label=label,
            old_value=old.link,
            new_value=new.link,
            evidence=evidence,
        )


def _formula_moved_with_row(old: Cell, new: Cell) -> bool:
    """A formula that only changed because its row or column moved.

    When a row is inserted above, Excel rewrites "=B21*C21" in F21 as
    "=B22*C22" in F22. That is the same formula in its new place, not an edit.
    """
    if not old.formula or not new.formula:
        return False
    try:
        return translate(old.formula, old.ref, new.ref) == new.formula
    except ValueError:
        return False


# ---------------------------------------------------------------- sheets


def _signature(cell: Cell) -> Hashable:
    return (cell.kind, cell.value, cell.formula if not cell.value else None)


def _content_similarity(a: Sheet, b: Sheet) -> float:
    left = Counter(_signature(cell) for cell in a.cells)
    right = Counter(_signature(cell) for cell in b.cells)
    if not left and not right:
        return 1.0
    common = sum((left & right).values())
    return common / max(sum((left | right).values()), 1)


def _pair_sheets(old: Workbook, new: Workbook) -> list[SheetPairing]:
    pairings: list[SheetPairing] = []
    unmatched_old = [sheet for sheet in old.sheets if new.sheet(sheet.name) is None]
    unmatched_new = [sheet for sheet in new.sheets if old.sheet(sheet.name) is None]

    renamed: dict[str, Sheet] = {}
    candidates = sorted(
        (
            (-_content_similarity(a, b), abs(a.index - b.index), a.index, b.index, a, b)
            for a in unmatched_old
            for b in unmatched_new
            if a.kind == b.kind
        ),
        key=lambda item: item[:4],
    )
    used_old: set[str] = set()
    used_new: set[str] = set()
    for negative, _distance, _i, _j, a, b in candidates:
        similarity = -negative
        if a.name in used_old or b.name in used_new:
            continue
        empty = not a.cells and not b.cells
        if similarity < RENAME_THRESHOLD or (empty and a.index != b.index):
            continue
        renamed[a.name] = b
        used_old.add(a.name)
        used_new.add(b.name)

    for sheet in old.sheets:
        counterpart = new.sheet(sheet.name) or renamed.get(sheet.name)
        if counterpart is None:
            pairings.append(SheetPairing(sheet, None, "removed"))
        else:
            status = "same" if counterpart.name == sheet.name else "renamed"
            pairings.append(SheetPairing(sheet, counterpart, status))
    for sheet in new.sheets:
        if old.sheet(sheet.name) is None and sheet.name not in used_new:
            pairings.append(SheetPairing(None, sheet, "added"))
    return pairings


def _moved_sheets(pairings: list[SheetPairing]) -> set[str]:
    """Names of paired sheets whose place in the order changed relative to the others."""
    matched = sorted(
        (p.original.index, p.revised.index, p.original.name)
        for p in pairings
        if p.original is not None and p.revised is not None
    )
    best: list[list[tuple[int, int, str]]] = []
    for item in matched:
        chains = [chain for chain in best if chain[-1][1] < item[1]]
        longest = max(chains, key=len) if chains else []
        best.append([*longest, item])
    keep = {name for _o, _n, name in max(best, key=len)} if best else set()
    return {name for _o, _n, name in matched if name not in keep}


# ---------------------------------------------------------------- rows and columns


def _align_sheets(old: Sheet, new: Sheet) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    old_grid, new_grid = old.grid(), new.grid()

    def columns_of(sheet: Sheet) -> dict[int, list[Cell]]:
        found: dict[int, list[Cell]] = {}
        for cell in sheet.cells:
            found.setdefault(cell.col, []).append(cell)
        return found

    old_cols, new_cols = columns_of(old), columns_of(new)
    old_col_values = {col: Counter(_signature(cell) for cell in cells) for col, cells in old_cols.items()}
    new_col_values = {col: Counter(_signature(cell) for cell in cells) for col, cells in new_cols.items()}
    old_col_keys = {col: tuple(_signature(cell) for cell in cells) for col, cells in old_cols.items()}
    new_col_keys = {col: tuple(_signature(cell) for cell in cells) for col, cells in new_cols.items()}
    old_tops = {col: cells[0].value for col, cells in old_cols.items()}
    new_tops = {col: cells[0].value for col, cells in new_cols.items()}

    def column_key(side: str, col: int) -> Hashable:
        return ("col", old_col_keys[col]) if side == "old" else ("col", new_col_keys[col])

    def column_similarity(a: int, b: int) -> float:
        left, right = old_col_values[a], new_col_values[b]
        score = sum((left & right).values()) / max(sum((left | right).values()), 1)
        if old_tops[a] and old_tops[a] == new_tops[b]:
            score = max(score, 0.6)  # the same heading at the top of the column
        return score

    columns = align(sorted(old_cols), sorted(new_cols), column_key, column_similarity, COLUMN_THRESHOLD)

    def row_values(grid: dict[tuple[int, int], Cell], row: int, side: str) -> tuple:
        values = []
        for old_col, new_col in columns:
            cell = grid.get((row, old_col if side == "old" else new_col))
            values.append(None if cell is None else (cell.kind, cell.value or cell.formula))
        return tuple(values)

    old_rows = sorted({cell.row for cell in old.cells})
    new_rows = sorted({cell.row for cell in new.cells})
    old_row_keys = {row: row_values(old_grid, row, "old") for row in old_rows}
    new_row_keys = {row: row_values(new_grid, row, "new") for row in new_rows}

    def row_key(side: str, row: int) -> Hashable:
        return old_row_keys[row] if side == "old" else new_row_keys[row]

    def row_similarity(a: int, b: int) -> float:
        left, right = old_row_keys[a], new_row_keys[b]
        considered = equal = 0
        for x, y in zip(left, right, strict=True):
            if x is None and y is None:
                continue
            considered += 1
            equal += x == y
        return equal / considered if considered else 0.0

    rows = align(old_rows, new_rows, row_key, row_similarity, ROW_THRESHOLD)
    return rows, columns


def _preview(cells: list[Cell]) -> str:
    shown_cells = [shown(cell) for cell in cells[:PREVIEW_CELLS]]
    text = " · ".join(value for value in shown_cells if value)
    if len(cells) > PREVIEW_CELLS:
        text += " · …"
    return _excerpt(text) or "(empty)"


def _span(cells: list[Cell], row: int | None = None, col: int | None = None) -> str:
    if row is not None:
        cols = [cell.col for cell in cells]
        first, last = cell_ref(row, min(cols)), cell_ref(row, max(cols))
    else:
        assert col is not None
        rows = [cell.row for cell in cells]
        first, last = cell_ref(min(rows), col), cell_ref(max(rows), col)
    return first if first == last else f"{first}:{last}"


def _nearest(mapping: list[tuple[int, int]], position: int, from_side: Literal["old", "new"]) -> int:
    """Where an item that exists on one side only would sit on the other side."""
    before = [pair for pair in mapping if (pair[1] if from_side == "new" else pair[0]) < position]
    if not before:
        return 1
    last = max(before, key=lambda pair: pair[1] if from_side == "new" else pair[0])
    return (last[0] if from_side == "new" else last[1]) + 1


def _compare_sheet_pair(
    builder: _Builder,
    pairing: SheetPairing,
    sheet_order: int,
    books: tuple[Workbook, Workbook],
) -> None:
    old, new = pairing.original, pairing.revised
    assert old is not None and new is not None
    old_book, new_book = books
    rows, columns = _align_sheets(old, new)
    pairing.rows, pairing.columns = rows, columns
    old_grid, new_grid = old.grid(), new.grid()
    row_of = dict(rows)
    col_of = dict(columns)
    new_row_matched = set(row_of.values())
    new_col_matched = set(col_of.values())

    # Rows that moved: the same content removed in one place and added in another.
    removed_rows = [row for row in sorted({c.row for c in old.cells}) if row not in row_of]
    added_rows = [row for row in sorted({c.row for c in new.cells}) if row not in new_row_matched]

    def by_row(sheet: Sheet) -> dict[int, list[Cell]]:
        found: dict[int, list[Cell]] = {}
        for cell in sheet.cells:
            found.setdefault(cell.row, []).append(cell)
        return found

    def content(cells: list[Cell], side: str) -> tuple:
        """A row's content in revised-sheet columns, counting only columns on both sides."""
        mapped = []
        for cell in cells:
            if side == "old" and cell.col in col_of:
                mapped.append(
                    (col_of[cell.col], cell.kind, cell.value, cell.formula if not cell.value else None)
                )
            elif side == "new" and cell.col in new_col_matched:
                mapped.append((cell.col, cell.kind, cell.value, cell.formula if not cell.value else None))
        return tuple(sorted(mapped))

    old_by_row, new_by_row = by_row(old), by_row(new)
    old_row_cells = {row: old_by_row[row] for row in removed_rows}
    new_row_cells = {row: new_by_row[row] for row in added_rows}
    moved: list[tuple[int, int]] = []
    free_new = list(added_rows)
    for row in removed_rows:
        key = content(old_row_cells[row], "old")
        if not key:
            continue
        match = next(
            (candidate for candidate in free_new if content(new_row_cells[candidate], "new") == key), None
        )
        if match is not None:
            free_new.remove(match)
            moved.append((row, match))
    moved_old = {a for a, _b in moved}
    moved_new = {b for _a, b in moved}

    for old_row, new_row in moved:
        before_cells, after_cells = old_row_cells[old_row], new_row_cells[new_row]
        builder.add(
            (sheet_order, 1, new_row, 0),
            original=Place(old.name, _span(before_cells, row=old_row)),
            revised=Place(new.name, _span(after_cells, row=new_row)),
            cells=([c.ref for c in before_cells], [c.ref for c in after_cells]),
            kind=ChangeKind.MOVED,
            category=ChangeCategory.LAYOUT,
            subtype="row",
            label=_label(new.name, f"row {new_row}"),
            old_value=f"Row {old_row}",
            new_value=f"Row {new_row}",
            evidence=(
                *(cell_evidence(old_book, old, c, Side.OLD) for c in before_cells[:EVIDENCE_CELLS]),
                *(cell_evidence(new_book, new, c, Side.NEW) for c in after_cells[:EVIDENCE_CELLS]),
            ),
        )

    for row in removed_rows:
        if row in moved_old:
            continue
        cells = old_row_cells[row]
        nearest = _nearest(rows, row, "old")
        builder.add(
            (sheet_order, 1, nearest, 0, -1),
            original=Place(old.name, _span(cells, row=row)),
            revised=Place(
                new.name,
                f"A{nearest}",
                exact=False,
                note=f"Row {row} of the original is not in the revised sheet. Shown where it would be.",
            ),
            before=None,
            cells=([c.ref for c in cells], ()),
            kind=ChangeKind.REMOVED,
            category=ChangeCategory.LAYOUT,
            subtype="row",
            label=_label(old.name, f"row {row}"),
            old_value=_preview(cells),
            evidence=tuple(cell_evidence(old_book, old, c, Side.OLD) for c in cells[:EVIDENCE_CELLS]),
        )

    for row in added_rows:
        if row in moved_new:
            continue
        cells = new_row_cells[row]
        nearest = _nearest(rows, row, "new")
        builder.add(
            (sheet_order, 1, row, 0),
            original=Place(
                old.name,
                f"A{nearest}",
                exact=False,
                note=f"Row {row} is new in the revised sheet. The original is shown where it would be.",
            ),
            revised=Place(new.name, _span(cells, row=row)),
            cells=((), [c.ref for c in cells]),
            kind=ChangeKind.ADDED,
            category=ChangeCategory.LAYOUT,
            subtype="row",
            label=_label(new.name, f"row {row}"),
            new_value=_preview(cells),
            evidence=tuple(cell_evidence(new_book, new, c, Side.NEW) for c in cells[:EVIDENCE_CELLS]),
        )

    for col in sorted({c.col for c in old.cells}):
        if col in col_of:
            continue
        cells = [c for c in old.cells if c.col == col]
        nearest = _nearest(columns, col, "old")
        builder.add(
            (sheet_order, 0, 0, nearest, -1),
            original=Place(old.name, _span(cells, col=col)),
            revised=Place(
                new.name,
                f"{column_letters(nearest)}1",
                exact=False,
                note=f"Column {column_letters(col)} of the original is not in the revised sheet.",
            ),
            cells=([c.ref for c in cells], ()),
            kind=ChangeKind.REMOVED,
            category=ChangeCategory.LAYOUT,
            subtype="column",
            label=_label(old.name, f"column {column_letters(col)}"),
            old_value=_preview(cells),
            evidence=tuple(cell_evidence(old_book, old, c, Side.OLD) for c in cells[:EVIDENCE_CELLS]),
        )
    for col in sorted({c.col for c in new.cells}):
        if col in new_col_matched:
            continue
        cells = [c for c in new.cells if c.col == col]
        nearest = _nearest(columns, col, "new")
        builder.add(
            (sheet_order, 0, 0, col),
            original=Place(
                old.name,
                f"{column_letters(nearest)}1",
                exact=False,
                note=f"Column {column_letters(col)} is new in the revised sheet.",
            ),
            revised=Place(new.name, _span(cells, col=col)),
            cells=((), [c.ref for c in cells]),
            kind=ChangeKind.ADDED,
            category=ChangeCategory.LAYOUT,
            subtype="column",
            label=_label(new.name, f"column {column_letters(col)}"),
            new_value=_preview(cells),
            evidence=tuple(cell_evidence(new_book, new, c, Side.NEW) for c in cells[:EVIDENCE_CELLS]),
        )

    for old_row, new_row in rows:
        for old_col, new_col in columns:
            _compare_cell(
                builder,
                (sheet_order, 1, new_row, new_col),
                (old, new),
                (cell_ref(old_row, old_col), cell_ref(new_row, new_col)),
                old_grid.get((old_row, old_col)),
                new_grid.get((new_row, new_col)),
                books,
            )


# ---------------------------------------------------------------- entry point


def compare_xlsx(old: Workbook, new: Workbook) -> ExcelComparisonOutcome:
    """Compare two workbooks. Deterministic: the same two workbooks, the same result."""
    from diffnexa_engine.contracts.xlsx_traceability import verify_xlsx_traceability

    builder = _Builder()
    books = (old, new)
    pairings = _pair_sheets(old, new)
    moved = _moved_sheets(pairings)
    order_of = {
        id(pairing): (pairing.revised.index if pairing.revised else pairing.original.index + 0.5)  # type: ignore[union-attr]
        for pairing in pairings
    }

    for pairing in pairings:
        position = order_of[id(pairing)]
        a, b = pairing.original, pairing.revised
        if pairing.status == "removed":
            assert a is not None
            builder.add(
                (position, -1),
                original=Place(a.name, None),
                revised=None,
                cells=([c.ref for c in a.cells], ()),
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.LAYOUT,
                subtype="sheet",
                label=a.name,
                old_value=a.name,
                evidence=(sheet_evidence(old, a, Side.OLD),),
            )
            continue
        if pairing.status == "added":
            assert b is not None
            builder.add(
                (position, -1),
                original=None,
                revised=Place(b.name, None),
                cells=((), [c.ref for c in b.cells]),
                kind=ChangeKind.ADDED,
                category=ChangeCategory.LAYOUT,
                subtype="sheet",
                label=b.name,
                new_value=b.name,
                evidence=(sheet_evidence(new, b, Side.NEW),),
            )
            continue
        assert a is not None and b is not None
        both = (sheet_evidence(old, a, Side.OLD), sheet_evidence(new, b, Side.NEW))
        if pairing.status == "renamed":
            builder.add(
                (position, -1, 0),
                original=Place(a.name, None),
                revised=Place(b.name, None),
                kind=ChangeKind.MODIFIED,
                category=ChangeCategory.LAYOUT,
                subtype="sheet_rename",
                label=b.name,
                old_value=a.name,
                new_value=b.name,
                confidence=round(_content_similarity(a, b), 3),
                evidence=both,
            )
        if a.name in moved:
            total_old, total_new = len(old.sheets), len(new.sheets)
            builder.add(
                (position, -1, 1),
                original=Place(a.name, None),
                revised=Place(b.name, None),
                kind=ChangeKind.MOVED,
                category=ChangeCategory.LAYOUT,
                subtype="sheet_order",
                label=b.name,
                old_value=f"Sheet {a.index + 1} of {total_old}",
                new_value=f"Sheet {b.index + 1} of {total_new}",
                evidence=both,
            )
        if a.kind == "worksheet" and b.kind == "worksheet":
            _compare_sheet_pair(builder, pairing, position, books)  # type: ignore[arg-type]

    changes = builder.finish()
    result = ComparisonResult(
        engine_version=ENGINE_VERSION,
        old_document=XlsxRef(
            sha256=old.content_sha256, sheet_count=len(old.sheets), cell_count=old.cell_count
        ),
        new_document=XlsxRef(
            sha256=new.content_sha256, sheet_count=len(new.sheets), cell_count=new.cell_count
        ),
        changes=tuple(item.change for item in changes),
    )
    diagnostics = ExcelDiagnostics()
    issues = verify_xlsx_traceability(result.changes, old, new)
    if issues:
        bad = {issue.change_id for issue in issues}
        kept = [item for item in changes if item.change.id not in bad]
        changes = [
            ExcelChange(
                item.change.model_copy(update={"id": f"c{index}", "seq": index}),
                item.original,
                item.revised,
                item.before,
                item.after,
                item.original_cells,
                item.revised_cells,
            )
            for index, item in enumerate(kept)
        ]
        diagnostics.dropped_untraceable = len(bad)
        diagnostics.notes.append(
            f"{len(bad)} change(s) were discarded because their evidence could not be traced "
            "back to the workbooks."
        )
        result = ComparisonResult(
            engine_version=result.engine_version,
            old_document=result.old_document,
            new_document=result.new_document,
            changes=tuple(item.change for item in changes),
        )
    return ExcelComparisonOutcome(result, changes, pairings, diagnostics, old, new)


__all__ = [
    "CellSnapshot",
    "ExcelChange",
    "ExcelComparisonOutcome",
    "Place",
    "SheetPairing",
    "compare_xlsx",
    "shown",
]
