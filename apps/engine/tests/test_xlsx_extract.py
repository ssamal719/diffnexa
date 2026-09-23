"""Reading workbooks into the comparable model.

Ordinary workbooks are written with openpyxl (and, where stored formula results
matter, saved by LibreOffice Calc, which calculates as Excel does). Structures
openpyxl will not write are assembled by hand.
"""

from __future__ import annotations

import datetime as dt

import pytest

from diffnexa_engine.xlsx import ExcelError, ExcelErrorCode, ExcelLimits, extract_xlsx

from .helpers.xlsx_files import (
    calc_available,
    package,
    replace_member,
    saved_by_calc,
    sheet_xml,
    styles_xml,
    workbook,
)


def cells(book, sheet: str | None = None) -> dict[str, tuple[str, str, str, str | None]]:
    target = book.sheets[0] if sheet is None else book.sheet(sheet)
    return {cell.ref: (cell.kind, cell.value, cell.display, cell.formula) for cell in target.cells}


# ---------------------------------------------------------------- values


def test_text_numbers_booleans_and_errors_are_read_as_stored():
    xml = sheet_xml(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>299.50</v></c>'
        '<c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#DIV/0!</v></c>'
        '<c r="E1" t="inlineStr"><is><t>Inline note</t></is></c></row>'
    )
    book = extract_xlsx(package({"Data": xml}, shared_strings=["Pro plan"]))
    assert cells(book) == {
        "A1": ("text", "Pro plan", "Pro plan", None),
        "B1": ("number", "299.5", "299.5", None),
        "C1": ("bool", "TRUE", "TRUE", None),
        "D1": ("error", "#DIV/0!", "#DIV/0!", None),
        "E1": ("text", "Inline note", "Inline note", None),
    }


def test_rich_text_is_joined_and_phonetic_guides_are_skipped():
    strings = (
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<si><r><t>Total </t></r><r><rPr><b/></rPr><t>due</t></r><rPh><t>guide</t></rPh></si></sst>"
    )
    xml = sheet_xml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>')
    data = replace_member(
        package({"S": xml}, shared_strings=["placeholder"]), "xl/sharedStrings.xml", strings
    )
    assert cells(extract_xlsx(data))["A1"][1] == "Total due"


def test_empty_cells_and_blank_strings_are_not_cells():
    xml = sheet_xml(
        '<row r="1"><c r="A1" s="0"/><c r="B1" t="inlineStr"><is><t></t></is></c><c r="C1"><v>5</v></c></row>'
    )
    assert list(cells(extract_xlsx(package({"S": xml})))) == ["C1"]


def test_cells_without_addresses_are_placed_in_order():
    xml = sheet_xml("<row><c><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c></row>")
    assert {ref: v[1] for ref, v in cells(extract_xlsx(package({"S": xml}))).items()} == {
        "A1": "1",
        "B1": "2",
        "A2": "3",
    }


# ---------------------------------------------------------------- number formats and dates


def formatted(format_code: str | None, value: str, *, builtin: int = 164, pr: str = "") -> tuple[str, str]:
    styles = styles_xml([(0, None), (builtin, format_code)])
    xml = sheet_xml(f'<row r="1"><c r="A1" s="1"><v>{value}</v></c></row>')
    cell = extract_xlsx(package({"S": xml}, styles=styles, workbook_pr=pr)).sheets[0].cells[0]
    return cell.kind, cell.display


def test_a_number_is_a_date_only_when_its_format_says_so():
    assert formatted("d mmmm yyyy", "46295") == ("date", "30 September 2026")
    assert formatted("0", "46295") == ("number", "46295")
    assert formatted("General", "46295") == ("number", "46295")


def test_the_locale_short_date_is_shown_unambiguously():
    assert formatted(None, "46295", builtin=14) == ("date", "30 Sep 2026")


def test_the_1904_date_system_is_respected():
    # 44833 days after 1 January 1904 is 30 September 2026.
    assert formatted("yyyy-mm-dd", "44833", pr='<workbookPr date1904="1"/>') == ("date", "2026-09-30")


def test_currency_percent_and_grouping_are_shown_as_formatted():
    assert formatted('"$"#,##0.00', "1299") == ("number", "$1,299.00")
    assert formatted("0.0%", "0.256") == ("number", "25.6%")
    assert formatted('"₹"#,##0', "249999") == ("number", "₹249,999")
    assert formatted("#,##0.00;(#,##0.00)", "-1500") == ("number", "(1,500.00)")


def test_text_that_looks_like_a_date_stays_text():
    xml = sheet_xml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>')
    book = extract_xlsx(package({"S": xml}, shared_strings=["30 September 2026"]))
    assert cells(book)["A1"][:2] == ("text", "30 September 2026")


def test_real_dates_written_by_a_spreadsheet_tool_are_dates():
    def build(book):
        sheet = book.active
        sheet["A1"] = dt.date(2026, 9, 30)
        sheet["A1"].number_format = "d mmmm yyyy"
        sheet["B1"] = 46295

    found = cells(extract_xlsx(workbook(build)))
    assert found["A1"][0] == "date" and found["A1"][2] == "30 September 2026"
    assert found["B1"][0] == "number"


# ---------------------------------------------------------------- formulas


def test_formulas_are_kept_as_text_and_never_calculated():
    def build(book):
        sheet = book.active
        sheet["A1"], sheet["B1"], sheet["C1"] = 2, 3, "=A1*B1"

    book = extract_xlsx(workbook(build))
    assert cells(book)["C1"] == ("empty", "", "", "A1*B1")
    assert any("no stored result" in warning for warning in book.warnings)


@pytest.mark.skipif(not calc_available(), reason="LibreOffice is not installed")
def test_stored_formula_results_are_read_when_the_saving_application_stored_them():
    def build(book):
        sheet = book.active
        sheet["A1"], sheet["B1"], sheet["C1"] = 2, 3, "=A1*B1"

    book = extract_xlsx(saved_by_calc(workbook(build)))
    assert cells(book)["C1"] == ("number", "6", "6", "A1*B1")
    assert not book.warnings


def test_shared_formulas_are_given_each_cells_own_formula():
    xml = sheet_xml(
        '<row r="2"><c r="C2"><f t="shared" ref="C2:C4" si="0">A2*B2</f><v>6</v></c></row>'
        '<row r="3"><c r="C3"><f t="shared" si="0"/><v>12</v></c></row>'
        '<row r="4"><c r="C4"><f t="shared" si="0"/><v>20</v></c></row>'
    )
    found = cells(extract_xlsx(package({"S": xml})))
    assert [found[ref][3] for ref in ("C2", "C3", "C4")] == ["A2*B2", "A3*B3", "A4*B4"]


# ---------------------------------------------------------------- sheets, links, merges


def test_sheets_keep_their_order_and_visibility():
    xml = sheet_xml('<row r="1"><c r="A1"><v>1</v></c></row>')
    book = extract_xlsx(
        package({"Summary": xml, "Hidden": xml, "Data": xml}, sheet_states={"Hidden": "hidden"})
    )
    assert [(s.name, s.index, s.state) for s in book.sheets] == [
        ("Summary", 0, "visible"),
        ("Hidden", 1, "hidden"),
        ("Data", 2, "visible"),
    ]


def test_hyperlinks_are_recorded_as_text_and_merges_as_ranges():
    rels = (
        '<Relationship Id="rL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        'hyperlink" Target="https://example.com/terms" TargetMode="External"/>'
    )
    xml = sheet_xml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Terms</t></is></c>'
        '<c r="B1" t="inlineStr"><is><t>Go</t></is></c></row>',
        '<mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells>'
        '<hyperlinks><hyperlink ref="A1" r:id="rL"/><hyperlink ref="B1" location="Data!A1"/></hyperlinks>',
    )
    sheet = extract_xlsx(package({"S": xml}, sheet_rels={"S": rels})).sheets[0]
    assert {cell.ref: cell.link for cell in sheet.cells} == {
        "A1": "https://example.com/terms",
        "B1": "#Data!A1",
    }
    assert sheet.merges == ("C1:D1",)


def test_charts_and_comments_are_noted_as_not_compared():
    def build(book):
        from openpyxl.comments import Comment

        book.active["A1"] = "Value"
        book.active["A1"].comment = Comment("Reviewer note", "R")

    book = extract_xlsx(workbook(build))
    assert any("comments" in warning and "not compared" in warning for warning in book.warnings)
    assert "Reviewer note" not in repr(book)


# ---------------------------------------------------------------- identity and limits


def test_the_fingerprint_depends_on_content_not_on_the_zip():
    def build(book):
        book.active["A1"] = "Same"
        book.active["B2"] = 42

    assert extract_xlsx(workbook(build)).content_sha256 == extract_xlsx(workbook(build)).content_sha256

    def other(book):
        build(book)
        book.active["C3"] = 1

    assert extract_xlsx(workbook(other)).content_sha256 != extract_xlsx(workbook(build)).content_sha256


def test_too_many_cells_is_refused_not_truncated():
    rows = "".join(f'<row r="{r}"><c r="A{r}"><v>{r}</v></c></row>' for r in range(1, 31))
    with pytest.raises(ExcelError) as caught:
        extract_xlsx(package({"S": sheet_xml(rows)}), ExcelLimits(max_cells=20))
    assert caught.value.code is ExcelErrorCode.TOO_COMPLEX


def test_too_many_sheets_is_refused():
    xml = sheet_xml('<row r="1"><c r="A1"><v>1</v></c></row>')
    with pytest.raises(ExcelError) as caught:
        extract_xlsx(package({f"S{i}": xml for i in range(5)}), ExcelLimits(max_sheets=4))
    assert caught.value.code is ExcelErrorCode.TOO_COMPLEX


def test_a_workbook_with_no_worksheets_is_refused():
    with pytest.raises(ExcelError) as caught:
        extract_xlsx(package({}))
    assert caught.value.code is ExcelErrorCode.NO_SHEETS


def test_an_empty_sheet_is_a_sheet_with_no_cells():
    book = extract_xlsx(
        package({"Blank": sheet_xml(""), "Data": sheet_xml('<row r="1"><c r="A1"><v>1</v></c></row>')})
    )
    assert [(s.name, len(s.cells)) for s in book.sheets] == [("Blank", 0), ("Data", 1)]
