"""Hostile, damaged and unsupported workbooks are refused safely.

Every case must end in a clear ExcelError with the right code — never an
unhandled exception, a hang, a file on disk, a network request, a calculated
formula or a running macro.
"""

from __future__ import annotations

import io
import warnings
import zipfile

import pytest

from diffnexa_engine.xlsx import ExcelError, ExcelErrorCode, ExcelLimits, extract_xlsx
from diffnexa_engine.xlsx.compare import compare_xlsx

from .helpers.stub_server import StubServer
from .helpers.xlsx_files import REL_BASE, package, replace_member, sheet_xml

SECRET_TEXT = "Confidential salary 185000"
GOOD = sheet_xml(f'<row r="1"><c r="A1" t="inlineStr"><is><t>{SECRET_TEXT}</t></is></c></row>')


def refused(data: bytes, limits: ExcelLimits | None = None) -> ExcelErrorCode:
    with pytest.raises(ExcelError) as caught:
        extract_xlsx(data, limits)
    # The detail is for the server log and never quotes workbook content.
    assert "salary" not in caught.value.detail
    return caught.value.code


# ---------------------------------------------------------------- not an .xlsx


def test_an_empty_file_is_refused():
    assert refused(b"") is ExcelErrorCode.EMPTY_FILE


def test_a_pdf_is_not_a_workbook():
    assert refused(b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n") is ExcelErrorCode.NOT_XLSX


def test_a_csv_is_not_a_workbook():
    assert refused(b"Plan,Price\nPro,299\n") is ExcelErrorCode.NOT_XLSX


def test_a_legacy_xls_file_is_named_as_such():
    assert refused(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 1024) is ExcelErrorCode.LEGACY_XLS


def test_a_password_protected_workbook_is_named_as_such():
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + "EncryptedPackage".encode("utf-16-le")
    assert refused(ole) is ExcelErrorCode.ENCRYPTED


def test_a_word_document_is_not_a_workbook():
    docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    assert refused(package({"S": GOOD}, content_type=docx)) is ExcelErrorCode.NOT_XLSX


def test_a_zip_that_is_not_an_office_file_is_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "hello")
    assert refused(buffer.getvalue()) is ExcelErrorCode.NOT_XLSX


@pytest.mark.parametrize(
    "content_type",
    [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
        "application/vnd.ms-excel.sheet.binary.macroEnabled.main",
    ],
)
def test_templates_and_binary_workbooks_are_unsupported(content_type):
    assert refused(package({"S": GOOD}, content_type=content_type)) is ExcelErrorCode.UNSUPPORTED


def test_a_strict_open_xml_workbook_is_unsupported():
    strict = (
        '<?xml version="1.0"?><workbook xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main" '
        'xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"><sheets/></workbook>'
    )
    assert (
        refused(replace_member(package({"S": GOOD}), "xl/workbook.xml", strict)) is ExcelErrorCode.UNSUPPORTED
    )


# ---------------------------------------------------------------- macros


def test_a_macro_enabled_workbook_is_refused():
    xlsm = "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
    assert refused(package({"S": GOOD}, content_type=xlsm)) is ExcelErrorCode.MACRO_ENABLED


def test_a_vba_project_is_refused_whatever_the_type_claims():
    data = package({"S": GOOD}, members=[("xl/vbaProject.bin", b"\x00\x01macro")])
    assert refused(data) is ExcelErrorCode.MACRO_ENABLED


def test_an_excel4_macro_sheet_is_refused():
    macro_sheet = (
        '<Override PartName="/xl/macrosheets/sheet1.xml" '
        'ContentType="application/vnd.ms-excel.macrosheet+xml"/>'
    )
    assert refused(package({"S": GOOD}, extra_types=macro_sheet)) is ExcelErrorCode.MACRO_ENABLED


# ---------------------------------------------------------------- the archive


def test_an_oversized_file_is_refused_before_it_is_opened():
    data = package({"S": GOOD})
    assert refused(data, ExcelLimits(max_file_bytes=len(data) - 1)) is ExcelErrorCode.TOO_LARGE


def test_the_default_limits():
    limits = ExcelLimits()
    assert (limits.max_file_bytes, limits.max_sheets, limits.max_cells) == (20 * 1024 * 1024, 60, 150_000)


def test_a_zip_bomb_is_stopped_at_the_decompression_ceiling():
    padding = " " * (65 * 1024 * 1024)
    bomb = sheet_xml(
        f'<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">{padding}</t></is></c></row>'
    )
    data = package({"S": bomb})
    assert len(data) < 300 * 1024
    assert refused(data) is ExcelErrorCode.TOO_LARGE


def test_the_total_decompressed_size_is_capped():
    big = sheet_xml(f'<row r="1"><c r="A1" t="inlineStr"><is><t>{"x" * 600_000}</t></is></c></row>')
    data = package({"A": big, "B": big})
    assert refused(data, ExcelLimits(max_total_bytes=1024 * 1024)) is ExcelErrorCode.TOO_LARGE


@pytest.mark.parametrize(
    "name", ["../evil.xml", "xl/../../evil.xml", "/etc/evil.xml", "xl\\evil.xml", "C:/evil.xml"]
)
def test_member_names_that_try_to_escape_are_refused(name):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        data = package({"S": GOOD}, members=[(name, "x")])
    assert refused(data) is ExcelErrorCode.UNREADABLE


def test_a_duplicated_member_name_is_refused():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        data = package({"S": GOOD}, members=[("xl/worksheets/sheet1.xml", sheet_xml(""))])
    assert refused(data) is ExcelErrorCode.UNREADABLE


def test_too_many_archive_entries_is_refused():
    data = package({"S": GOOD}, members=[(f"xl/media/{i}.bin", b"") for i in range(30)])
    assert refused(data, ExcelLimits(max_entries=10)) is ExcelErrorCode.TOO_COMPLEX


def test_an_encrypted_zip_member_is_refused():
    data = package({"S": GOOD})
    raw = bytearray(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.getinfo("xl/worksheets/sheet1.xml")
    raw[info.header_offset + 6] |= 0x1
    central = raw.rfind(b"PK\x01\x02")
    while central != -1:
        length = int.from_bytes(raw[central + 28 : central + 30], "little")
        if raw[central + 46 : central + 46 + length] == b"xl/worksheets/sheet1.xml":
            raw[central + 8] |= 0x1
            break
        central = raw.rfind(b"PK\x01\x02", 0, central)
    assert refused(bytes(raw)) is ExcelErrorCode.ENCRYPTED


def test_a_truncated_workbook_is_refused():
    data = package({"S": GOOD})
    assert refused(data[: len(data) // 2]) is ExcelErrorCode.UNREADABLE


def test_malformed_sheet_xml_is_refused():
    assert refused(package({"S": "<worksheet><sheetData><row>"})) is ExcelErrorCode.UNREADABLE


def test_a_missing_sheet_part_is_refused():
    data = package({"S": GOOD})
    source = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for info in source.infolist():
            if info.filename != "xl/worksheets/sheet1.xml":
                archive.writestr(info.filename, source.read(info))
    assert refused(out.getvalue()) is ExcelErrorCode.UNREADABLE


@pytest.mark.parametrize(
    "cell",
    [
        '<c r="ZZZZ1"><v>1</v></c>',  # not a cell address
        '<c r="A0"><v>1</v></c>',  # row zero
        '<c r="B2"><v>1</v></c>',  # outside its row
        '<c r="A1"><v>not a number</v></c>',  # a number cell holding text
        '<c r="A1" t="s"><v>99</v></c>',  # a shared string that does not exist
    ],
)
def test_impossible_cells_are_refused(cell):
    assert refused(package({"S": sheet_xml(f'<row r="1">{cell}</row>')})) is ExcelErrorCode.UNREADABLE


def test_nothing_is_written_to_disk(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    extract_xlsx(package({"S": GOOD}))
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------- XML entities, links and the network


@pytest.fixture
def server():
    stub = StubServer()
    try:
        yield stub
    finally:
        stub.stop()


def test_an_external_entity_is_never_resolved(server):
    xxe = (
        f'<?xml version="1.0"?><!DOCTYPE w [<!ENTITY x SYSTEM "{server.url("/secret")}">'
        '<!ENTITY y SYSTEM "file:///etc/passwd">]>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        '<row r="1"><c r="A1" t="inlineStr"><is><t>&x;&y;</t></is></c></row></sheetData></worksheet>'
    )
    assert refused(package({"S": xxe})) is ExcelErrorCode.UNREADABLE
    assert server.requests == []


def test_entity_expansion_is_refused():
    laughs = (
        '<?xml version="1.0"?><!DOCTYPE s [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&b;</t></si></sst>'
    )
    data = replace_member(package({"S": GOOD}, shared_strings=["x"]), "xl/sharedStrings.xml", laughs)
    assert refused(data) is ExcelErrorCode.UNREADABLE


def test_links_external_workbooks_and_images_are_never_fetched(server):
    external = 'TargetMode="External"/>'
    rels = (
        f'<Relationship Id="rL" Type="{REL_BASE}/hyperlink" Target="{server.url("/link")}" {external}'
        f'<Relationship Id="rF" Type="{REL_BASE}/hyperlink" Target="file:///etc/passwd" {external}'
        f'<Relationship Id="rI" Type="{REL_BASE}/image" Target="{server.url("/img.png")}" {external}'
    )
    xml = sheet_xml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Site</t></is></c>'
        '<c r="B1"><f>HYPERLINK("' + server.url("/formula") + '")</f><v>0</v></c>'
        '<c r="C1"><f>WEBSERVICE("' + server.url("/ws") + '")</f></c></row>',
        '<hyperlinks><hyperlink ref="A1" r:id="rL"/></hyperlinks>',
    )
    first = extract_xlsx(package({"S": xml}, sheet_rels={"S": rels}))
    second = extract_xlsx(package({"S": xml}, sheet_rels={"S": rels}))
    compare_xlsx(first, second)
    assert server.requests == [], "nothing a workbook points at is requested"
    assert first.sheets[0].cells[0].link == server.url("/link")
    # Formulas are text: HYPERLINK and WEBSERVICE are read, never run.
    assert first.sheets[0].cells[2].formula.startswith("WEBSERVICE(")


def test_formulas_are_never_calculated():
    """A formula's result is only ever what the file stored."""
    xml = sheet_xml('<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f>A1*1000</f><v>5</v></c></row>')
    cell = extract_xlsx(package({"S": xml})).sheets[0].cells[1]
    assert (cell.formula, cell.value) == ("A1*1000", "5")


def test_a_real_workbook_still_reads_after_all_these_checks():
    from .helpers.xlsx_files import workbook

    book = extract_xlsx(workbook(lambda b: b.active.append(["Everything", "is", "fine"])))
    assert [cell.value for cell in book.sheets[0].cells] == ["Everything", "is", "fine"]
