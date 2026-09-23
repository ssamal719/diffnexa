"""Reading an untrusted .xlsx into the comparable workbook model, in memory.

The archive and XML are opened with the same hardened rules as Word documents
(`diffnexa_engine.ooxml.safety`). On top of those:

* **What is accepted.** The main part must be an ordinary workbook. Macro-enabled
  (.xlsm), binary (.xlsb), template and Strict Open XML workbooks are refused by
  their declared type, and a VBA project or Excel 4 macro sheet anywhere in the
  package is refused whatever the type claims. Old .xls and password-protected
  files are recognised from their first bytes.
* **What is read.** Only the workbook, its relationships, the shared strings,
  the number formats and each worksheet (with its hyperlink relationships). Only
  the number format of each style is looked at. Charts, images, comments, pivot
  caches, external links and everything else are never decompressed; the
  workbook notes that they are there and not compared.
* **What is never done.** No formula is calculated: a formula's result is the
  value the saving application stored, or nothing. No macro runs. No link,
  external workbook or data connection is opened.
* **Limits.** File size, archive entries, bytes decompressed per part and in
  total, the number of sheets and the number of cells are all capped. Past a
  cap the workbook is refused, never silently truncated.
"""

from __future__ import annotations

import os
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from lxml import etree

from diffnexa_engine.ooxml import safety
from diffnexa_engine.ooxml.safety import CT_NS, PackageProblem, PartReader, Relationship
from diffnexa_engine.xlsx import numfmt
from diffnexa_engine.xlsx.errors import ExcelError, ExcelErrorCode
from diffnexa_engine.xlsx.formula import MAX_COL, MAX_ROW, cell_ref, split_ref, translate
from diffnexa_engine.xlsx.model import Cell, CellKind, Sheet, SheetKind, SheetState, Workbook, fingerprint

MIB = 1024 * 1024

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
STRICT_NS = "http://purl.oclc.org/ooxml/spreadsheetml/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

XLSX_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
UNSUPPORTED_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
        "application/vnd.ms-excel.sheet.binary.macroenabled.main",
    }
)
MACRO_TYPES = frozenset(
    {
        "application/vnd.ms-excel.sheet.macroenabled.main+xml",
        "application/vnd.ms-excel.template.macroenabled.main+xml",
        "application/vnd.ms-excel.addin.macroenabled.main+xml",
    }
)

_PROBLEM_CODES = {
    "not_package": ExcelErrorCode.NOT_XLSX,
    "unreadable": ExcelErrorCode.UNREADABLE,
    "too_large": ExcelErrorCode.TOO_LARGE,
    "too_complex": ExcelErrorCode.TOO_COMPLEX,
    "encrypted": ExcelErrorCode.ENCRYPTED,
    "macro": ExcelErrorCode.MACRO_ENABLED,
}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class ExcelLimits:
    """Ceilings on what one workbook may cost. Each is a refusal, never a truncation."""

    max_file_bytes: int = 20 * MIB
    max_entries: int = 5_000
    max_sheet_bytes: int = 64 * MIB  # one worksheet's XML, decompressed
    max_part_bytes: int = 32 * MIB  # shared strings, styles, workbook, relationships
    max_total_bytes: int = 160 * MIB  # everything decompressed for one file
    max_sheets: int = 60
    #: Every cell is sent back for the side-by-side view, so this is also what
    #: one browser page has to draw from.
    max_cells: int = 150_000

    @classmethod
    def from_env(cls) -> ExcelLimits:
        return cls(
            max_file_bytes=_int_env("DIFFNEXA_EXCEL_MAX_FILE_MB", 20) * MIB,
            max_cells=_int_env("DIFFNEXA_EXCEL_MAX_CELLS", 150_000),
        )


@contextmanager
def _as_excel_errors() -> Iterator[None]:
    try:
        yield
    except PackageProblem as problem:
        raise ExcelError(_PROBLEM_CODES[problem.kind], problem.detail) from problem


def _q(tag: str) -> str:
    return f"{{{MAIN_NS}}}{tag}"


def _text(element: etree._Element | None) -> str:
    """The text of a string item, joining rich-text runs and skipping phonetic guides."""
    if element is None:
        return ""
    parts: list[str] = []
    for node in element.iter(_q("t")):
        parent = node.getparent()
        if parent is not None and parent.tag == _q("rPh"):
            continue
        parts.append(node.text or "")
    return unicodedata.normalize("NFC", "".join(parts))


def _decimal_text(raw: str) -> str | None:
    """A stored number as a plain decimal string, or None if it is not a number."""
    try:
        number = Decimal(raw.strip())
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    text = format(number.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


# ---------------------------------------------------------------- the package


def _check_container(data: bytes, limits: ExcelLimits) -> None:
    if not data:
        raise ExcelError(ExcelErrorCode.EMPTY_FILE, "no bytes")
    if len(data) > limits.max_file_bytes:
        raise ExcelError(ExcelErrorCode.TOO_LARGE, f"{len(data)} bytes")
    kind = safety.container_kind(data)
    if kind == "ole-encrypted":
        raise ExcelError(ExcelErrorCode.ENCRYPTED, "OLE container holding an encrypted package")
    if kind == "ole":
        raise ExcelError(ExcelErrorCode.LEGACY_XLS, "OLE compound file")
    if kind != "zip":
        raise ExcelError(ExcelErrorCode.NOT_XLSX, "no ZIP signature")


def _check_types(reader: PartReader, main: str, content_type: str | None) -> None:
    if content_type in MACRO_TYPES:
        raise ExcelError(ExcelErrorCode.MACRO_ENABLED, "macro-enabled workbook")
    if content_type in UNSUPPORTED_TYPES:
        raise ExcelError(ExcelErrorCode.UNSUPPORTED, f"workbook type {content_type!r}")
    if content_type != XLSX_MAIN:
        raise ExcelError(ExcelErrorCode.NOT_XLSX, f"main part type {content_type!r}")
    # Excel 4 macro sheets can hide in a package whatever its main type says.
    types = reader.xml("[Content_Types].xml")
    for override in types.iter(f"{{{CT_NS}}}Override"):
        declared = (override.get("ContentType") or "").lower()
        if "macrosheet" in declared or "vbaproject" in declared:
            raise ExcelError(ExcelErrorCode.MACRO_ENABLED, "package declares macro content")


# ---------------------------------------------------------------- styles


@dataclass(frozen=True)
class _Format:
    code: str
    builtin_id: int | None


def _formats(styles: etree._Element | None) -> list[_Format]:
    """The number format of each cell style, by style index."""
    if styles is None:
        return []
    custom: dict[int, str] = {}
    num_fmts = styles.find(_q("numFmts"))
    if num_fmts is not None:
        for num_fmt in num_fmts.iter(_q("numFmt")):
            try:
                custom[int(num_fmt.get("numFmtId") or "")] = num_fmt.get("formatCode") or ""
            except ValueError:
                continue
    found: list[_Format] = []
    cell_xfs = styles.find(_q("cellXfs"))
    if cell_xfs is not None:
        for xf in cell_xfs.iter(_q("xf")):
            try:
                format_id = int(xf.get("numFmtId") or "0")
            except ValueError:
                format_id = 0
            code = custom.get(format_id) or numfmt.BUILTIN_FORMATS.get(format_id, "General")
            found.append(_Format(code, format_id if format_id not in custom else None))
    return found


# ---------------------------------------------------------------- one worksheet


class _SheetReader:
    def __init__(
        self,
        strings: list[str],
        formats: list[_Format],
        date1904: bool,
        links: dict[str, Relationship],
        budget: list[int],
    ) -> None:
        self.strings = strings
        self.formats = formats
        self.date1904 = date1904
        self.links = links
        self.budget = budget  # cells left, shared across the workbook
        self.shared: dict[str, tuple[str, str]] = {}  # shared formula index -> (origin, text)

    def _format_of(self, style: str | None) -> _Format:
        if style is None:
            return _Format("General", 0)
        try:
            index = int(style)
        except ValueError:
            return _Format("General", 0)
        return self.formats[index] if 0 <= index < len(self.formats) else _Format("General", 0)

    def _formula(self, element: etree._Element | None, ref: str) -> str | None:
        if element is None:
            return None
        text = element.text or ""
        kind = element.get("t")
        index = element.get("si")
        if kind == "shared" and index is not None:
            if text:
                self.shared[index] = (ref, text)
            elif index in self.shared:
                origin, master = self.shared[index]
                text = translate(master, origin, ref)
        return text or None

    def cell(self, element: etree._Element, row: int, col: int) -> Cell | None:
        ref = cell_ref(row, col)
        cell_type = element.get("t") or "n"
        formula = self._formula(element.find(_q("f")), ref)
        stored = element.find(_q("v"))
        raw = stored.text if stored is not None and stored.text is not None else None
        style = self._format_of(element.get("s"))
        number_format = None if style.code.strip().lower() == "general" else style.code

        kind: CellKind
        if cell_type == "s":
            try:
                value = self.strings[int(raw or "")]
            except (ValueError, IndexError) as exc:
                raise ExcelError(ExcelErrorCode.UNREADABLE, "shared string index out of range") from exc
            kind, display = "text", value
        elif cell_type == "inlineStr":
            value = _text(element.find(_q("is")))
            kind, display = "text", value
        elif cell_type == "str":
            value = unicodedata.normalize("NFC", raw or "")
            kind, display = "text", value
        elif cell_type == "b":
            value = "TRUE" if (raw or "").strip() in ("1", "true") else "FALSE"
            kind, display = "bool", value
        elif cell_type == "e":
            value = (raw or "").strip()
            kind, display = "error", value
        elif cell_type == "d":
            value = (raw or "").strip()
            kind, display = "date", value
        else:
            number = _decimal_text(raw) if raw is not None else None
            if raw is not None and number is None:
                raise ExcelError(ExcelErrorCode.UNREADABLE, "a number cell holds something else")
            if number is None:
                value, display, kind = "", "", "empty"
            else:
                value = number
                category = numfmt.classify(style.code)
                kind = "date" if category in ("date", "time", "datetime") else "number"
                display = numfmt.render(
                    Decimal(number), style.code, format_id=style.builtin_id, date1904=self.date1904
                )

        if kind == "text" and value == "" and formula is None:
            return None
        if kind == "empty" and formula is None:
            return None
        self.budget[0] -= 1
        if self.budget[0] < 0:
            raise ExcelError(ExcelErrorCode.TOO_COMPLEX, "too many cells")
        return Cell(row, col, kind, value, display, formula, number_format if kind != "text" else None)

    def read(self, root: etree._Element) -> tuple[list[Cell], list[str]]:
        cells: dict[tuple[int, int], Cell] = {}
        data = root.find(_q("sheetData"))
        next_row = 1
        if data is not None:
            for row_element in data.iterchildren(_q("row")):
                row = _position(row_element.get("r"), next_row, MAX_ROW)
                next_row = row + 1
                next_col = 1
                for cell_element in row_element.iterchildren(_q("c")):
                    ref = cell_element.get("r")
                    if ref:
                        try:
                            cell_row, col = split_ref(ref)
                        except ValueError as exc:
                            raise ExcelError(ExcelErrorCode.UNREADABLE, "bad cell reference") from exc
                        if cell_row != row:
                            raise ExcelError(ExcelErrorCode.UNREADABLE, "cell outside its row")
                    else:
                        col = next_col
                    if col > MAX_COL:
                        raise ExcelError(ExcelErrorCode.UNREADABLE, "column off the sheet")
                    next_col = col + 1
                    cell = self.cell(cell_element, row, col)
                    if cell is not None:
                        cells[(row, col)] = cell

        merges: list[str] = []
        merge_cells = root.find(_q("mergeCells"))
        if merge_cells is not None:
            for merge in merge_cells.iterchildren(_q("mergeCell")):
                ref = (merge.get("ref") or "").upper()
                if _is_range(ref):
                    merges.append(ref)

        hyperlinks = root.find(_q("hyperlinks"))
        if hyperlinks is not None:
            for link in hyperlinks.iterchildren(_q("hyperlink")):
                target = self._link_target(link)
                ref = (link.get("ref") or "").upper()
                if not target or not _is_range(ref):
                    continue
                first = ref.split(":")[0]
                try:
                    position = split_ref(first)
                except ValueError:
                    continue
                cell = cells.get(position)
                if cell is not None:
                    cells[position] = Cell(
                        cell.row,
                        cell.col,
                        cell.kind,
                        cell.value,
                        cell.display,
                        cell.formula,
                        cell.number_format,
                        target,
                    )

        ordered = [cells[key] for key in sorted(cells)]
        return ordered, sorted(set(merges))

    def _link_target(self, link: etree._Element) -> str | None:
        """Where a hyperlink points, as written. Never opened."""
        rel_id = link.get(f"{{{R_NS}}}id")
        location = link.get("location")
        target = None
        if rel_id and rel_id in self.links and self.links[rel_id].external:
            target = self.links[rel_id].target
        elif location:
            target = f"#{location}"
        return target[:2000] if target else None


def _position(raw: str | None, fallback: int, ceiling: int) -> int:
    if raw is None:
        return fallback
    try:
        value = int(raw)
    except ValueError as exc:
        raise ExcelError(ExcelErrorCode.UNREADABLE, "bad row number") from exc
    if not 1 <= value <= ceiling:
        raise ExcelError(ExcelErrorCode.UNREADABLE, "row off the sheet")
    return value


def _is_range(ref: str) -> bool:
    try:
        for part in ref.split(":"):
            split_ref(part)
    except ValueError:
        return False
    return 1 <= len(ref.split(":")) <= 2


# ---------------------------------------------------------------- the workbook


_NOT_COMPARED = {
    "drawing": "charts, images or shapes",
    "comments": "comments",
    "threadedComment": "comments",
    "pivotTable": "pivot tables",
    "table": None,  # Excel tables are ordinary cells, which are compared
}


def extract_xlsx(data: bytes, limits: ExcelLimits | None = None) -> Workbook:
    """Read a .xlsx into the comparable model, or raise an ExcelError saying why not."""
    limits = limits or ExcelLimits()
    _check_container(data, limits)
    with _as_excel_errors():
        archive = safety.open_zip(data)
        with archive:
            safety.check_members(archive, limits.max_entries)
            reader = PartReader(archive, limits.max_total_bytes, limits.max_part_bytes)
            main, content_type, _core = reader.main_part()
            _check_types(reader, main, content_type)
            return _read_workbook(reader, main, limits)


def _read_workbook(reader: PartReader, main: str, limits: ExcelLimits) -> Workbook:
    root = reader.xml(main)
    if root.tag == f"{{{STRICT_NS}}}workbook":
        raise ExcelError(ExcelErrorCode.UNSUPPORTED, "Strict Open XML workbook")
    if root.tag != _q("workbook"):
        raise ExcelError(ExcelErrorCode.NOT_XLSX, "main part is not a workbook")

    properties = root.find(_q("workbookPr"))
    date1904 = properties is not None and (properties.get("date1904") or "").lower() in ("1", "true")
    relationships = reader.part_relationships(main)

    def related(suffix: str) -> etree._Element | None:
        for rel in relationships.values():
            if not rel.external and rel.type.endswith(suffix) and reader.has(rel.target):
                return reader.xml(rel.target)
        return None

    strings_root = related("/sharedStrings")
    strings = (
        [_text(item) for item in strings_root.iterchildren(_q("si"))] if strings_root is not None else []
    )
    formats = _formats(related("/styles"))

    listed = root.find(_q("sheets"))
    entries = list(listed.iterchildren(_q("sheet"))) if listed is not None else []
    if len(entries) > limits.max_sheets:
        raise ExcelError(ExcelErrorCode.TOO_COMPLEX, f"{len(entries)} sheets")

    warnings: list[str] = []
    not_compared: set[str] = set()
    chart_sheets = 0
    budget = [limits.max_cells]
    sheets: list[Sheet] = []
    seen_names: set[str] = set()
    for index, entry in enumerate(entries):
        name = unicodedata.normalize("NFC", entry.get("name") or f"Sheet{index + 1}")
        if name in seen_names:
            raise ExcelError(ExcelErrorCode.UNREADABLE, "two sheets share a name")
        seen_names.add(name)
        state_raw = entry.get("state") or "visible"
        state: SheetState = state_raw if state_raw in ("visible", "hidden", "veryHidden") else "visible"  # type: ignore[assignment]
        rel = relationships.get(entry.get(f"{{{R_NS}}}id") or "")
        kind: SheetKind
        if rel is None or rel.external or not reader.has(rel.target):
            raise ExcelError(ExcelErrorCode.UNREADABLE, "a sheet's part is missing")
        if rel.type.endswith("/worksheet"):
            kind = "worksheet"
        elif rel.type.endswith("/chartsheet"):
            kind, chart_sheets = "chartsheet", chart_sheets + 1
        else:
            kind = "other"
        if kind != "worksheet":
            sheets.append(Sheet(name, index, kind, state, ()))
            continue

        sheet_rels = reader.part_relationships(rel.target)
        for sheet_rel in sheet_rels.values():
            label = _NOT_COMPARED.get(sheet_rel.type.rsplit("/", 1)[-1])
            if label:
                not_compared.add(label)
        sheet_root = reader.xml(rel.target, limits.max_sheet_bytes)
        if sheet_root.tag != _q("worksheet"):
            raise ExcelError(ExcelErrorCode.UNREADABLE, "a worksheet part is not a worksheet")
        cells, merges = _SheetReader(strings, formats, date1904, sheet_rels, budget).read(sheet_root)
        sheets.append(Sheet(name, index, "worksheet", state, tuple(cells), tuple(merges)))

    if not any(sheet.kind == "worksheet" for sheet in sheets):
        raise ExcelError(ExcelErrorCode.NO_SHEETS, "no worksheets")

    if chart_sheets:
        noun = "chart sheet" if chart_sheets == 1 else "chart sheets"
        warnings.append(f"Has {chart_sheets} {noun}. Charts are not compared.")
    if not_compared:
        warnings.append(f"Has {', '.join(sorted(not_compared))}. These are not compared.")
    if any(rel.type.endswith("/externalLink") for rel in relationships.values()):
        warnings.append("Refers to other workbooks. Those links are not opened or compared.")
    if any(cell.kind == "empty" for sheet in sheets for cell in sheet.cells):
        warnings.append(
            "Some formulas have no stored result, so only their formula text can be compared. "
            "Open and save the workbook in Excel to store the results."
        )

    frozen = tuple(sheets)
    return Workbook(
        sheets=frozen,
        date1904=date1904,
        content_sha256=fingerprint(frozen, date1904),
        warnings=tuple(warnings),
    )


__all__ = ["ExcelLimits", "extract_xlsx"]
