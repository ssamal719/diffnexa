"""Building real .xlsx files for tests.

* `workbook(...)` makes an ordinary workbook with openpyxl, the way many tools
  write them (formulas without stored results).
* `saved_by_calc(...)` additionally opens and saves it with LibreOffice Calc,
  which calculates every formula and stores its result, the way Excel does. It
  is slower, so tests use it only where stored results matter.
* `package(...)` assembles a .xlsx by hand from XML strings, for what openpyxl
  will not write: hostile archives, macro content types, entity declarations,
  shared formulas, inline strings, 1904 dates.

Every test reads these through the real reader; nothing here converts a
workbook to text.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from xml.sax.saxutils import quoteattr

import openpyxl

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XLSX_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
WORKSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"


def workbook(build: Callable[[openpyxl.Workbook], None]) -> bytes:
    book = openpyxl.Workbook()
    build(book)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def calc_available() -> bool:
    return shutil.which("soffice") is not None


def saved_by_calc(data: bytes) -> bytes:
    """The same workbook after LibreOffice Calc has opened, calculated and saved it."""
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "book.xlsx"
        source.write_bytes(data)
        out = Path(directory) / "out"
        subprocess.run(
            [
                "soffice",
                f"-env:UserInstallation=file://{directory}/profile",
                "--headless",
                "--calc",
                "--convert-to",
                "xlsx",
                "--outdir",
                str(out),
                str(source),
            ],
            check=True,
            capture_output=True,
            timeout=180,
        )
        return (out / "book.xlsx").read_bytes()


def sheet_xml(rows: str, extra: str = "") -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{MAIN_NS}" xmlns:r="{R_NS}"><sheetData>{rows}</sheetData>{extra}</worksheet>'
    )


def package(
    sheets: dict[str, str] | None = None,
    *,
    content_type: str = XLSX_MAIN,
    shared_strings: list[str] | None = None,
    styles: str | None = None,
    workbook_pr: str = "",
    sheet_rels: dict[str, str] | None = None,
    sheet_states: dict[str, str] | None = None,
    extra_types: str = "",
    members: list[tuple[str, bytes | str]] | None = None,
) -> bytes:
    """A minimal but genuine .xlsx: content types, relationships, workbook and sheets."""
    sheets = (
        sheets if sheets is not None else {"Sheet1": sheet_xml('<row r="1"><c r="A1"><v>1</v></c></row>')}
    )
    names = list(sheets)
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="{WORKSHEET_TYPE}"/>'
        for i in range(len(names))
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/xl/workbook.xml" ContentType="{content_type}"/>'
        f"{overrides}{extra_types}</Types>"
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{REL_BASE}/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    states = sheet_states or {}
    sheet_entries = "".join(
        f'<sheet name="{name}" sheetId="{i + 1}" r:id="rId{i + 1}"'
        + (f' state="{states[name]}"' if name in states else "")
        + "/>"
        for i, name in enumerate(names)
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<workbook xmlns="{MAIN_NS}" xmlns:r="{R_NS}">{workbook_pr}'
        f"<sheets>{sheet_entries}</sheets></workbook>"
    )
    rels = "".join(
        f'<Relationship Id="rId{i + 1}" Type="{REL_BASE}/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
        for i in range(len(names))
    )
    n = len(names)
    if shared_strings is not None:
        rels += f'<Relationship Id="rId{n + 1}" Type="{REL_BASE}/sharedStrings" Target="sharedStrings.xml"/>'
    if styles is not None:
        rels += f'<Relationship Id="rId{n + 2}" Type="{REL_BASE}/styles" Target="styles.xml"/>'
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>'
    )
    entries: list[tuple[str, bytes | str]] = [
        ("[Content_Types].xml", content_types),
        ("_rels/.rels", package_rels),
        ("xl/workbook.xml", workbook_xml),
        ("xl/_rels/workbook.xml.rels", workbook_rels),
    ]
    for i, name in enumerate(names):
        entries.append((f"xl/worksheets/sheet{i + 1}.xml", sheets[name]))
        if sheet_rels and name in sheet_rels:
            entries.append(
                (
                    f"xl/worksheets/_rels/sheet{i + 1}.xml.rels",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    f"{sheet_rels[name]}</Relationships>",
                )
            )
    if shared_strings is not None:
        items = "".join(f'<si><t xml:space="preserve">{text}</t></si>' for text in shared_strings)
        entries.append(("xl/sharedStrings.xml", f'<?xml version="1.0"?><sst xmlns="{MAIN_NS}">{items}</sst>'))
    if styles is not None:
        entries.append(("xl/styles.xml", styles))
    entries += members or []
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return buffer.getvalue()


def styles_xml(formats: list[tuple[int, str | None]]) -> str:
    """Cell styles, one per entry: (numFmtId, custom format code or None for built-in)."""
    custom = [(fid, code) for fid, code in formats if code is not None]
    num_fmts = "".join(f'<numFmt numFmtId="{fid}" formatCode={quoteattr(code)}/>' for fid, code in custom)
    xfs = "".join(f'<xf numFmtId="{fid}"/>' for fid, _code in formats)
    return (
        f'<?xml version="1.0"?><styleSheet xmlns="{MAIN_NS}">'
        + (f'<numFmts count="{len(custom)}">{num_fmts}</numFmts>' if custom else "")
        + f'<cellXfs count="{len(formats)}">{xfs}</cellXfs></styleSheet>'
    )


def replace_member(data: bytes, name: str, payload: bytes | str) -> bytes:
    """The same archive with one member's content replaced."""
    source = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for info in source.infolist():
            content = payload if info.filename == name else source.read(info)
            archive.writestr(info.filename, content)
    return out.getvalue()
