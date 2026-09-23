"""Comparing two workbooks: what is found, where, and the evidence behind it.

Assertions are made on the response the website receives, so the places,
groups and evidence are checked exactly as the workspace will show them.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from diffnexa_engine.contracts.xlsx_traceability import verify_xlsx_traceability
from diffnexa_engine.xlsx import extract_xlsx
from diffnexa_engine.xlsx.api import serialize_excel_comparison
from diffnexa_engine.xlsx.compare import compare_xlsx

from .helpers.xlsx_files import package, sheet_xml, styles_xml, workbook

PLANS = [
    ["Plan", "Price", "Seats", "Renewal"],
    ["Starter", 99, 1, dt.date(2026, 9, 30)],
    ["Pro", 299, 3, dt.date(2026, 9, 30)],
    ["Team", 499, 10, dt.date(2026, 10, 15)],
]
PEOPLE = [["Name", "Role"], ["John", "Lead"], ["Asha", "Analyst"]]


def book(pricing=PLANS, people=PEOPLE, *, extra=None, people_title="Employees", order=None):
    def build(wb):
        sheet = wb.active
        sheet.title = "Pricing"
        for row in pricing:
            sheet.append(list(row))
        for r in range(2, len(pricing) + 1):
            sheet[f"B{r}"].number_format = '"$"#,##0.00'
            sheet[f"D{r}"].number_format = "d mmmm yyyy"
        if people is not None:
            staff = wb.create_sheet(people_title)
            for row in people:
                staff.append(list(row))
        if extra:
            extra(wb)
        if order:
            wb._sheets = [wb[name] for name in order]

    return workbook(build)


def run(old_bytes: bytes, new_bytes: bytes):
    old, new = extract_xlsx(old_bytes), extract_xlsx(new_bytes)
    outcome = compare_xlsx(old, new)
    return outcome, serialize_excel_comparison(outcome, processing_ms=0)


def compare(**changes):
    return run(book(), book(**changes))


def only(payload) -> dict:
    assert payload["counts"]["total"] == 1, [(c["kind"], c["label"]) for c in payload["changes"]]
    return payload["changes"][0]


def edited(rows, row, col, value):
    copy = [list(r) for r in rows]
    copy[row][col] = value
    return copy


# ---------------------------------------------------------------- no change


def test_identical_workbooks_have_no_changes():
    _, payload = compare()
    assert payload["counts"] == {"total": 0}
    assert payload["changes"] == []


def test_blank_cells_do_not_count():
    _, payload = run(book(), book(extra=lambda wb: wb["Pricing"].cell(row=9, column=9, value="")))
    assert payload["counts"]["total"] == 0


def test_a_format_change_alone_is_not_reported():
    def reformat(wb):
        wb["Pricing"]["B3"].number_format = "#,##0"

    _, payload = run(book(), book(extra=reformat))
    assert payload["counts"]["total"] == 0


# ---------------------------------------------------------------- cell values


def test_a_changed_number_names_its_sheet_and_cell():
    change = only(compare(pricing=edited(PLANS, 2, 1, 349))[1])
    assert (change["sheet"], change["ref"], change["group"]) == ("Pricing", "B3", "values")
    assert (change["category"], change["oldValue"], change["newValue"]) == ("number", "$299.00", "$349.00")
    assert change["delta"] == "+50 (+16.72%)"
    assert change["original"]["ref"] == "B3" and change["revised"]["ref"] == "B3"
    assert change["original"]["cell"]["value"] == "299"


def test_a_changed_date():
    change = only(compare(pricing=edited(PLANS, 2, 3, dt.date(2026, 10, 15)))[1])
    assert (change["category"], change["ref"]) == ("date", "D3")
    assert (change["oldValue"], change["newValue"], change["delta"]) == (
        "30 September 2026",
        "15 October 2026",
        "15 days later",
    )


def test_a_changed_text():
    change = only(compare(people=[PEOPLE[0], ["Jonathan", "Lead"], PEOPLE[2]])[1])
    assert (change["sheet"], change["ref"], change["category"]) == ("Employees", "A2", "text")
    assert (change["oldValue"], change["newValue"]) == ("John", "Jonathan")


def test_an_added_cell():
    offices = [["Name", "Role", "Office"], ["John", "Lead", None], ["Asha", "Analyst", "Pune"]]
    change = only(run(book(people=offices), book(people=edited(offices, 1, 2, "Remote")))[1])
    assert (change["kind"], change["ref"], change["newValue"]) == ("added", "C2", "Remote")
    assert change["original"] == {
        "sheet": "Employees",
        "ref": "C2",
        "exact": True,
        "note": "This cell is empty in the original.",
        "cell": None,
        "cells": [],
    }


def test_a_value_in_a_column_that_was_empty_is_a_new_column():
    change = only(compare(people=[PEOPLE[0], ["John", "Lead", "Remote"], PEOPLE[2]])[1])
    assert (change["subtype"], change["kind"], change["ref"]) == ("column", "added", "C2")


def test_a_removed_cell():
    change = only(compare(pricing=edited(PLANS, 3, 2, None))[1])
    assert (change["kind"], change["ref"], change["oldValue"]) == ("removed", "C4", "10")


def test_percentages_differ_in_percentage_points():
    def with_rate(rate):
        def extra(wb):
            wb["Pricing"]["F2"] = rate
            wb["Pricing"]["F2"].number_format = "0%"

        return extra

    _, payload = run(book(extra=with_rate(0.18)), book(extra=with_rate(0.2)))
    change = only(payload)
    assert (change["oldValue"], change["newValue"], change["delta"]) == ("18%", "20%", "+2 percentage points")


def test_a_number_that_is_not_a_date_is_never_treated_as_one():
    def with_value(value):
        return lambda wb: wb["Pricing"].__setitem__("F2", value)

    change = only(run(book(extra=with_value(46295)), book(extra=with_value(46310)))[1])
    assert (change["category"], change["newValue"], change["delta"]) == ("number", "46310", "+15 (+0.03%)")


def test_text_that_is_a_date_is_compared_as_a_date():
    def with_text(text):
        return lambda wb: wb["Pricing"].__setitem__("F2", text)

    change = only(
        run(book(extra=with_text("30 September 2026")), book(extra=with_text("15 October 2026")))[1]
    )
    assert (change["category"], change["delta"]) == ("date", "15 days later")


# ---------------------------------------------------------------- formulas


HEADER = (
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Price</t></is></c>'
    '<c r="B1" t="inlineStr"><is><t>Seats</t></is></c>'
    '<c r="C1" t="inlineStr"><is><t>Total</t></is></c></row>'
)


def formulas(total_formula: str, stored: str = "897"):
    rows = (
        f"{HEADER}"
        f'<row r="2"><c r="A2"><v>299</v></c><c r="B2"><v>3</v></c><c r="C2"><f>{total_formula}</f>'
        f"<v>{stored}</v></c></row>"
    )
    return package({"Totals": sheet_xml(rows)})


def test_a_changed_formula_is_one_change_with_formula_and_result():
    change = only(run(formulas("A2*B2", "897"), formulas("A2*B2*0.9", "807.3"))[1])
    assert (change["category"], change["group"], change["ref"]) == ("formula", "formulas", "C2")
    assert (change["oldValue"], change["newValue"]) == ("=A2*B2", "=A2*B2*0.9")
    assert change["original"]["cell"]["display"] == "897"
    assert change["revised"]["cell"]["display"] == "807.3"
    assert change["revised"]["cell"]["formula"] == "=A2*B2*0.9"


def test_a_changed_result_of_an_unchanged_formula_says_so():
    old = package(
        {"S": sheet_xml('<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f>A1*10</f><v>20</v></c></row>')}
    )
    new = package(
        {"S": sheet_xml('<row r="1"><c r="A1"><v>3</v></c><c r="B1"><f>A1*10</f><v>30</v></c></row>')}
    )
    _, payload = run(old, new)
    by_ref = {change["ref"]: change for change in payload["changes"]}
    assert set(by_ref) == {"A1", "B1"}
    assert (by_ref["B1"]["subtype"], by_ref["B1"]["oldValue"], by_ref["B1"]["newValue"]) == (
        "calculated",
        "20",
        "30",
    )


def test_a_formula_replaced_by_a_typed_value():
    old = formulas("A2*B2")
    new = package(
        {
            "Totals": sheet_xml(
                HEADER
                + '<row r="2"><c r="A2"><v>299</v></c><c r="B2"><v>3</v></c><c r="C2"><v>897</v></c></row>'
            )
        }
    )
    change = only(run(old, new)[1])
    assert (change["category"], change["oldValue"], change["newValue"]) == ("formula", "=A2*B2", "897")


# ---------------------------------------------------------------- rows and columns


def test_an_inserted_row_is_one_change_and_later_cells_keep_their_counterparts():
    rows = [list(r) for r in PLANS]
    rows.insert(2, ["Growth", 199, 5, dt.date(2026, 9, 30)])
    rows[3][1] = 349  # Pro, now on row 4
    _, payload = compare(pricing=rows)
    kinds = [(c["subtype"], c["kind"], c["ref"]) for c in payload["changes"]]
    assert kinds == [("row", "added", "A3:D3"), ("cell", "modified", "B4")]
    added, price = payload["changes"]
    assert added["original"]["exact"] is False and "new in the revised sheet" in added["original"]["note"]
    assert (price["original"]["ref"], price["revised"]["ref"]) == ("B3", "B4")
    assert (price["oldValue"], price["newValue"]) == ("$299.00", "$349.00")


def test_a_removed_row():
    rows = [list(r) for r in PLANS]
    del rows[1]
    change = only(compare(pricing=rows)[1])
    assert (change["subtype"], change["kind"], change["ref"], change["group"]) == (
        "row",
        "removed",
        "A2:D2",
        "structure",
    )
    assert change["oldValue"].startswith("Starter · $99.00 · 1")
    assert change["revised"]["exact"] is False


def test_an_inserted_column():
    rows = [
        list(r[:2]) + [c] + list(r[2:]) for r, c in zip(PLANS, ["Tier", "Basic", "Mid", "Top"], strict=True)
    ]

    def reformat(wb):
        for r in range(2, 5):
            wb["Pricing"][f"E{r}"].number_format = "d mmmm yyyy"

    _, payload = run(book(), book(pricing=rows, extra=reformat))
    change = only(payload)
    assert (change["subtype"], change["kind"], change["ref"]) == ("column", "added", "C1:C4")
    assert change["newValue"] == "Tier · Basic · Mid · Top"


def test_a_removed_column():
    rows = [[r[0], r[1], r[3]] for r in PLANS]

    def reformat(wb):
        for r in range(2, 5):
            wb["Pricing"][f"C{r}"].number_format = "d mmmm yyyy"

    change = only(run(book(), book(pricing=rows, extra=reformat))[1])
    assert (change["subtype"], change["kind"], change["ref"]) == ("column", "removed", "C1:C4")


def test_a_moved_row_is_reported_as_moved():
    rows = [PLANS[0], PLANS[2], PLANS[3], PLANS[1]]
    _, payload = compare(pricing=rows)
    moved = [c for c in payload["changes"] if c["kind"] == "moved"]
    assert len(moved) == 1 and (moved[0]["oldValue"], moved[0]["newValue"]) == ("Row 2", "Row 4")


def test_blank_rows_inserted_above_shift_positions_but_are_not_changes():
    def with_gap(wb):
        wb["Pricing"].insert_rows(2, amount=2)

    _, payload = run(book(), book(extra=with_gap))
    assert payload["counts"]["total"] == 0
    rows = next(s for s in payload["sheets"] if s["revised"] == "Pricing")["rows"]
    assert [3, 5] in rows  # original row 3 is now row 5


# ---------------------------------------------------------------- sheets


def test_an_added_sheet():
    def extra(wb):
        wb.create_sheet("Settings").append(["Currency", "USD"])

    change = only(run(book(), book(extra=extra))[1])
    assert (change["subtype"], change["kind"], change["sheet"], change["ref"]) == (
        "sheet",
        "added",
        "Settings",
        None,
    )
    assert change["revised"]["cells"] == ["A1", "B1"]


def test_a_removed_sheet():
    change = only(run(book(), book(people=None))[1])
    assert (change["subtype"], change["kind"], change["sheet"]) == ("sheet", "removed", "Employees")


def test_a_renamed_sheet_is_inferred_from_its_content():
    change = only(compare(people_title="Staff")[1])
    assert (change["subtype"], change["oldValue"], change["newValue"]) == (
        "sheet_rename",
        "Employees",
        "Staff",
    )


def test_a_renamed_and_edited_sheet():
    _, payload = compare(people_title="Staff", people=[PEOPLE[0], ["Jonathan", "Lead"], PEOPLE[2]])
    assert [(c["subtype"], c["sheet"], c["ref"]) for c in payload["changes"]] == [
        ("sheet_rename", "Staff", None),
        ("cell", "Staff", "A2"),
    ]


def test_unrelated_sheets_are_not_mistaken_for_a_rename():
    change_list = compare(
        people=[["Region", "Target"], ["North", 100], ["South", 250]], people_title="Targets"
    )[1]["changes"]
    assert sorted((c["subtype"], c["kind"]) for c in change_list) == [
        ("sheet", "added"),
        ("sheet", "removed"),
    ]


def test_sheets_that_changed_places():
    def extra(wb):
        wb.create_sheet("Notes").append(["Draft"])

    _, payload = run(book(extra=extra), book(extra=extra, order=["Notes", "Pricing", "Employees"]))
    moved = [c for c in payload["changes"] if c["subtype"] == "sheet_order"]
    assert [(c["sheet"], c["oldValue"], c["newValue"]) for c in moved] == [
        ("Notes", "Sheet 3 of 3", "Sheet 1 of 3")
    ]


# ---------------------------------------------------------------- links


def test_a_changed_hyperlink():
    def link(url):
        def extra(wb):
            wb["Pricing"]["A2"].hyperlink = url

        return extra

    change = only(
        run(book(extra=link("https://example.com/starter")), book(extra=link("https://example.com/basic")))[1]
    )
    assert (change["group"], change["ref"]) == ("links", "A2")
    assert (change["oldValue"], change["newValue"]) == (
        "https://example.com/starter",
        "https://example.com/basic",
    )


# ---------------------------------------------------------------- evidence and determinism

SEVERAL = dict(
    pricing=[PLANS[0], PLANS[1], edited(PLANS, 2, 1, 349)[2], edited(PLANS, 3, 3, dt.date(2026, 11, 1))[3]],
    people=[PEOPLE[0], ["Jonathan", "Lead"], PEOPLE[2], ["Mei", "Designer"]],
    people_title="Staff",
)


def test_several_changes_across_sheets_are_each_found_once():
    _, payload = compare(**SEVERAL)
    assert [(c["sheet"], c["subtype"], c["ref"]) for c in payload["changes"]] == [
        ("Pricing", "cell", "B3"),
        ("Pricing", "cell", "D4"),
        ("Staff", "sheet_rename", None),
        ("Staff", "cell", "A2"),
        ("Staff", "row", "A4:B4"),
    ]
    assert [c["number"] for c in payload["changes"]] == [1, 2, 3, 4, 5]


def test_groups_account_for_every_change_exactly_once():
    _, payload = compare(**SEVERAL)
    listed = sorted(i for group in payload["groups"] for i in group["changeIds"])
    assert listed == sorted(c["id"] for c in payload["changes"])
    assert [g["id"] for g in payload["groups"]] == ["values", "formulas", "structure", "links"]


def test_every_change_traces_back_to_the_workbook_it_cites():
    outcome, payload = compare(**SEVERAL)
    assert verify_xlsx_traceability(outcome.result.changes, outcome.previous, outcome.current) == []
    assert payload["diagnostics"]["droppedUntraceable"] == 0
    books = {"old": outcome.previous, "new": outcome.current}
    for change in outcome.result.changes:
        assert change.evidence
        for evidence in change.evidence:
            assert evidence.snapshot_sha256 == books[evidence.side.value].content_sha256
            sheet = books[evidence.side.value].sheet(evidence.sheet)
            assert sheet is not None
            if evidence.cell_ref:
                assert evidence.cell_ref in {cell.ref for cell in sheet.cells}


def test_before_values_come_from_the_original_and_after_values_from_the_revision():
    outcome, payload = compare(**SEVERAL)
    for change in payload["changes"]:
        if change["subtype"] != "cell":
            continue
        original = outcome.previous.sheet(change["original"]["sheet"]).grid()
        revised = outcome.current.sheet(change["revised"]["sheet"]).grid()
        from diffnexa_engine.xlsx.formula import split_ref

        if change["original"]["cell"]:
            assert (
                original[split_ref(change["original"]["ref"])].display
                == change["original"]["cell"]["display"]
            )
        if change["revised"]["cell"]:
            assert (
                revised[split_ref(change["revised"]["ref"])].display == change["revised"]["cell"]["display"]
            )


def test_tampered_evidence_is_caught():
    outcome, _ = compare(**SEVERAL)
    change = outcome.result.changes[0]
    wrong = change.model_copy(
        update={"evidence": (change.evidence[0].model_copy(update={"excerpt": "$1.00"}), change.evidence[1])}
    )
    assert verify_xlsx_traceability([wrong], outcome.previous, outcome.current)


def test_the_response_is_identical_every_time_apart_from_timing():
    old, new = book(), book(**SEVERAL)
    runs = []
    for _ in range(3):
        payload = serialize_excel_comparison(
            compare_xlsx(extract_xlsx(old), extract_xlsx(new)), processing_ms=0
        )
        runs.append(json.dumps(payload, sort_keys=True))
    assert runs[0] == runs[1] == runs[2]


def test_the_same_workbooks_saved_again_give_the_same_response():
    first = serialize_excel_comparison(compare_xlsx(extract_xlsx(book()), extract_xlsx(book(**SEVERAL))), 0)
    second = serialize_excel_comparison(compare_xlsx(extract_xlsx(book()), extract_xlsx(book(**SEVERAL))), 0)
    assert first == second


def test_nothing_is_ranked_or_judged():
    _, payload = compare(**SEVERAL)
    text = json.dumps(payload["changes"]).lower()
    for word in ("important", "minor", "major", "critical", "risky", "favorable", "unfavorable"):
        assert word not in text


def test_the_grids_carry_every_cell_of_both_workbooks():
    outcome, payload = compare(**SEVERAL)
    for side, book_ in (("original", outcome.previous), ("revised", outcome.current)):
        sent = {g["name"]: len(g["cells"]) for g in payload["grids"][side]}
        assert sent == {sheet.name: len(sheet.cells) for sheet in book_.sheets}


@pytest.mark.parametrize("rows", [2_000])
def test_a_large_workbook_with_one_change(rows):
    def big(price):
        def build(wb):
            sheet = wb.active
            sheet.append(["SKU", "Name", "Price", "Stock", "Warehouse", "Updated"])
            for i in range(1, rows + 1):
                sheet.append([f"SKU-{i:05d}", f"Item {i}", 10 + i % 97, i % 50, f"W{i % 7}", 46000 + i % 300])
            sheet["C1500"] = price

        return build

    _, payload = run(workbook(big(123)), workbook(big(124)))
    change = only(payload)
    assert (change["ref"], change["oldValue"], change["newValue"]) == ("C1500", "123", "124")


def test_styles_do_not_leak_into_values():
    styles = styles_xml([(0, None), (164, '"$"#,##0.00')])
    old = package({"S": sheet_xml('<row r="1"><c r="A1" s="1"><v>299</v></c></row>')}, styles=styles)
    new = package({"S": sheet_xml('<row r="1"><c r="A1"><v>299</v></c></row>')}, styles=styles)
    assert run(old, new)[1]["counts"]["total"] == 0
