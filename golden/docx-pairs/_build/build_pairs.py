"""Build the DOCX Compare golden documents.

Run from apps/engine with the dev extras installed:

    python ../../golden/docx-pairs/_build/build_pairs.py

Each pair folder gets before.docx and after.docx, written with python-docx so
they carry Word's own styles, numbering and table structures. The expected.yaml
beside them is written by hand and is never generated here: it is the human
statement of what really changed, which the engine is scored against.

The documents are realistic: a services agreement, a recruitment notice and a
leave policy, each with headings, lists, tables and links. Every pair starts
from one of them and makes the edits its name describes, so a pair differs
from its base only where its expected.yaml says it does.
"""

from __future__ import annotations

import copy
import sys
from collections.abc import Callable
from pathlib import Path

import docx
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------- building blocks


def hyperlink(paragraph, url: str, text: str) -> None:
    rel_id = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rel_id)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    style = OxmlElement("w:rStyle")
    style.set(qn("w:val"), "Hyperlink")
    properties.append(style)
    run.append(properties)
    node = OxmlElement("w:t")
    node.text = text
    run.append(node)
    link.append(run)
    paragraph._p.append(link)


def grid(document, rows) -> None:
    table = document.add_table(rows=len(rows), cols=max(len(row) for row in rows))
    table.style = "Table Grid"
    for i, row in enumerate(rows):
        for j, value in enumerate(row):
            table.cell(i, j).text = value
    for cell in table.rows[0].cells:
        for run in cell.paragraphs[0].runs:
            run.bold = True


# ---------------------------------------------------------------- the services agreement

AGREEMENT = {
    "title": "Master Services Agreement",
    "subject": "Northwind Facilities and Acme Maintenance",
    "sections": [
        (
            "1. Services",
            1,
            [
                (
                    "p",
                    "Acme Maintenance will provide planned and reactive maintenance at the Northwind site.",
                ),
                ("p", "The services include the following deliverables:"),
                ("bullet", "Monthly inspection report"),
                ("bullet", "Quarterly safety audit"),
                ("bullet", "Annual equipment review"),
            ],
        ),
        (
            "2. Fees and Payment",
            1,
            [
                ("p", "Invoices are payable within 30 days of the invoice date."),
                (
                    "table",
                    [
                        ("Service", "Fee", "Frequency"),
                        ("Planned maintenance", "$4,500", "Monthly"),
                        ("Reactive call-out", "$250", "Per visit"),
                        ("Safety audit", "$1,200", "Quarterly"),
                    ],
                ),
                ("p", "Late payments incur interest of 1.5% per month."),
            ],
        ),
        (
            "3. Term and Termination",
            1,
            [
                ("p", "This agreement starts on 1 October 2026 and runs for 24 months."),
                ("p", "Either party may terminate this agreement with 60 days written notice."),
                ("h2", "3.1 Termination steps"),
                ("number", "Send written notice to the other party"),
                ("number", "Agree a handover plan"),
                ("number", "Return all site access cards"),
            ],
        ),
        (
            "4. Governing Law",
            1,
            [
                ("p", "This agreement is governed by the laws of the State of Delaware."),
                (
                    "link",
                    (
                        "The full standard terms are published at ",
                        "https://acme.example.com/terms",
                        "acme.example.com/terms",
                    ),
                ),
            ],
        ),
    ],
}

# ---------------------------------------------------------------- the recruitment notice

NOTICE = {
    "title": "Recruitment Notice 12/2026",
    "subject": "Junior Assistant and Clerk posts",
    "sections": [
        (
            "Recruitment Notice 12/2026",
            0,
            [("p", "Applications are invited for the posts listed below in the State Public Service.")],
        ),
        (
            "Vacancies",
            1,
            [
                (
                    "table",
                    [
                        ("Post", "Vacancies", "Pay level"),
                        ("Junior Assistant", "627", "Level 4"),
                        ("Clerk", "212", "Level 3"),
                        ("Data Entry Operator", "95", "Level 3"),
                    ],
                ),
            ],
        ),
        (
            "Eligibility",
            1,
            [
                ("bullet", "A bachelor's degree from a recognised university"),
                ("bullet", "Minimum age 18 years and maximum age 30 years"),
                ("bullet", "Working knowledge of the state language"),
                ("p", "Maximum age: 30 years. Last date: 30 September 2026. Total vacancies: 934."),
            ],
        ),
        (
            "Important dates",
            1,
            [
                (
                    "table",
                    [
                        ("Event", "Date"),
                        ("Online applications open", "1 September 2026"),
                        ("Last date to apply", "30 September 2026"),
                        ("Written examination", "8 November 2026"),
                    ],
                ),
            ],
        ),
        (
            "How to apply",
            1,
            [
                ("number", "Register on the recruitment portal"),
                ("number", "Fill in the application form"),
                ("number", "Pay the application fee of 500 rupees"),
                ("number", "Download the confirmation page"),
                (
                    "link",
                    ("Apply online at ", "https://recruit.example.gov/apply", "recruit.example.gov/apply"),
                ),
            ],
        ),
    ],
}

# ---------------------------------------------------------------- the leave policy

POLICY = {
    "title": "Leave Policy",
    "subject": "Annual, sick and parental leave",
    "sections": [
        (
            "Leave Policy",
            0,
            [("p", "This policy applies to all permanent employees from 1 January 2027.")],
        ),
        (
            "Annual leave",
            1,
            [
                ("p", "Employees receive 20 days of paid annual leave each year."),
                ("p", "Up to 5 unused days may be carried over to the next year."),
            ],
        ),
        (
            "Sick leave",
            1,
            [
                ("p", "Employees receive 10 days of paid sick leave each year."),
                ("p", "A medical certificate is required for absences longer than 3 days."),
            ],
        ),
        (
            "Parental leave",
            1,
            [
                ("p", "Eligible employees may take parental leave as follows:"),
                ("bullet", "Primary carers: 16 weeks at full pay"),
                ("bullet", "Secondary carers: 4 weeks at full pay"),
                ("bullet2", "Can be taken within 12 months of the birth"),
            ],
        ),
    ],
}


def render(spec: dict, *, bold_paragraphs: bool = False) -> Callable[[docx.document.Document], None]:
    def build(document) -> None:
        document.core_properties.title = spec["title"]
        document.core_properties.subject = spec["subject"]
        document.core_properties.author = "Legal Operations"
        for heading, level, blocks in spec["sections"]:
            if heading is not None:
                document.add_heading(heading, level)
            for kind, value in blocks:
                if kind == "p":
                    paragraph = document.add_paragraph(value)
                    if bold_paragraphs:
                        paragraph.runs[0].bold = True
                        paragraph.runs[0].font.size = Pt(13)
                elif kind == "h2":
                    document.add_heading(value, 2)
                elif kind == "bullet":
                    document.add_paragraph(value, style="List Bullet")
                elif kind == "bullet2":
                    document.add_paragraph(value, style="List Bullet 2")
                elif kind == "number":
                    document.add_paragraph(value, style="List Number")
                elif kind == "table":
                    grid(document, value)
                elif kind == "link":
                    lead, url, text = value
                    paragraph = document.add_paragraph(lead)
                    hyperlink(paragraph, url, text)
                else:  # pragma: no cover - a typo in this file
                    raise ValueError(kind)

    return build


def save(path: Path, build) -> None:
    document = docx.Document()
    build(document)
    document.save(str(path))


# ---------------------------------------------------------------- edits


def section(spec: dict, heading: str) -> list:
    return next(blocks for name, _level, blocks in spec["sections"] if name == heading)


def replace(spec: dict, heading: str, old, new) -> None:
    blocks = section(spec, heading)
    index = next(i for i, block in enumerate(blocks) if block[1] == old)
    blocks[index] = (blocks[index][0], new)


def cell(spec: dict, heading: str, row: int, column: int, value: str) -> None:
    blocks = section(spec, heading)
    index = next(i for i, block in enumerate(blocks) if block[0] == "table")
    rows = [list(r) for r in blocks[index][1]]
    rows[row][column] = value
    blocks[index] = ("table", [tuple(r) for r in rows])


def edit(base: dict, change: Callable[[dict], None]) -> dict:
    spec = copy.deepcopy(base)
    change(spec)
    return spec


def _heading_level(spec, name, level):
    spec["sections"] = [(h, level if h == name else lv, b) for h, lv, b in spec["sections"]]


def _rename(spec, old, new):
    spec["sections"] = [(new if h == old else h, lv, b) for h, lv, b in spec["sections"]]


def _table_rows(spec, heading, change):
    blocks = section(spec, heading)
    index = next(i for i, block in enumerate(blocks) if block[0] == "table")
    rows = list(blocks[index][1])
    change(rows)
    blocks[index] = ("table", rows)


PAIRS: dict[str, tuple[dict, dict, dict]] = {}


def pair(name: str, base: dict, change: Callable[[dict], None] | None = None, **after_options) -> None:
    PAIRS[name] = (base, edit(base, change) if change else copy.deepcopy(base), after_options)


pair("no-change", AGREEMENT)
pair("formatting-only", POLICY, bold_paragraphs=True)
pair(
    "paragraph-added",
    AGREEMENT,
    lambda s: section(s, "3. Term and Termination").insert(
        2, ("p", "Either party may renew this agreement for a further 12 months by written agreement.")
    ),
)
pair("paragraph-removed", POLICY, lambda s: section(s, "Annual leave").pop(1))
pair(
    "paragraph-reworded",
    AGREEMENT,
    lambda s: replace(
        s,
        "4. Governing Law",
        "This agreement is governed by the laws of the State of Delaware.",
        "This agreement is governed by the laws of the State of New York.",
    ),
)
pair(
    "heading-added",
    POLICY,
    lambda s: s["sections"].append(
        ("Bereavement leave", 1, [("p", "Employees may take up to 5 days of paid bereavement leave.")])
    ),
)
pair(
    "heading-renamed",
    AGREEMENT,
    lambda s: _rename(s, "2. Fees and Payment", "2. Fees, Payment and Invoicing"),
)
pair("heading-level-changed", NOTICE, lambda s: _heading_level(s, "Important dates", 2))
pair(
    "list-item-added",
    AGREEMENT,
    lambda s: section(s, "1. Services").append(("bullet", "Emergency response within 4 hours")),
)
pair("list-item-removed", NOTICE, lambda s: section(s, "Eligibility").pop(2))
pair(
    "list-item-edited",
    POLICY,
    lambda s: replace(
        s, "Parental leave", "Secondary carers: 4 weeks at full pay", "Secondary carers: 6 weeks at full pay"
    ),
)
pair(
    "numbered-list-insert",
    NOTICE,
    lambda s: section(s, "How to apply").insert(2, ("number", "Upload a recent photograph and signature")),
)
pair(
    "paragraph-became-list-item",
    POLICY,
    lambda s: section(s, "Sick leave").__setitem__(
        1, ("bullet", "A medical certificate is required for absences longer than 3 days.")
    ),
)
pair(
    "table-row-added",
    NOTICE,
    lambda s: _table_rows(s, "Vacancies", lambda r: r.append(("Stenographer", "40", "Level 4"))),
)
pair("table-row-removed", AGREEMENT, lambda s: _table_rows(s, "2. Fees and Payment", lambda r: r.pop(2)))
pair("table-cell-number", NOTICE, lambda s: cell(s, "Vacancies", 1, 1, "654"))
pair("table-cell-date", NOTICE, lambda s: cell(s, "Important dates", 2, 1, "15 October 2026"))
pair(
    "table-added",
    POLICY,
    lambda s: section(s, "Annual leave").append(
        ("table", [("Years of service", "Annual leave"), ("0 to 4", "20 days"), ("5 or more", "25 days")])
    ),
)


def _dates_to_be_announced(s):
    blocks = section(s, "Important dates")
    blocks.clear()
    blocks.append(("p", "Dates will be announced on the recruitment portal."))


pair("table-removed", NOTICE, _dates_to_be_announced)
pair(
    "table-column-added",
    AGREEMENT,
    lambda s: _table_rows(
        s,
        "2. Fees and Payment",
        lambda r: r.__setitem__(
            slice(None),
            [
                (*row, extra)
                for row, extra in zip(
                    r, ("Notes", "Includes parts", "Business hours", "On site"), strict=True
                )
            ],
        ),
    ),
)
pair(
    "numeric-change",
    AGREEMENT,
    lambda s: replace(
        s,
        "3. Term and Termination",
        "Either party may terminate this agreement with 60 days written notice.",
        "Either party may terminate this agreement with 90 days written notice.",
    ),
)
pair(
    "date-change",
    POLICY,
    lambda s: replace(
        s,
        "Leave Policy",
        "This policy applies to all permanent employees from 1 January 2027.",
        "This policy applies to all permanent employees from 1 April 2027.",
    ),
)
pair(
    "several-values-one-paragraph",
    NOTICE,
    lambda s: replace(
        s,
        "Eligibility",
        "Maximum age: 30 years. Last date: 30 September 2026. Total vacancies: 934.",
        "Maximum age: 32 years. Last date: 15 October 2026. Total vacancies: 961.",
    ),
)
pair(
    "link-changed",
    NOTICE,
    lambda s: replace(
        s,
        "How to apply",
        ("Apply online at ", "https://recruit.example.gov/apply", "recruit.example.gov/apply"),
        ("Apply online at ", "https://recruit.example.gov/apply-2026", "recruit.example.gov/apply"),
    ),
)
pair("title-changed", AGREEMENT, lambda s: s.__setitem__("title", "Master Services Agreement (Revised)"))
pair(
    "paragraph-moved",
    AGREEMENT,
    lambda s: (
        section(s, "2. Fees and Payment").remove(("p", "Late payments incur interest of 1.5% per month.")),
        section(s, "4. Governing Law").insert(1, ("p", "Late payments incur interest of 1.5% per month.")),
    ),
)


def _mixed(s):
    _rename(s, "Eligibility", "Eligibility criteria")
    cell(s, "Vacancies", 1, 1, "654")
    _table_rows(s, "Vacancies", lambda r: r.append(("Stenographer", "40", "Level 4")))
    cell(s, "Important dates", 2, 1, "15 October 2026")
    section(s, "Eligibility criteria").pop(2)
    section(s, "How to apply").insert(3, ("number", "Upload a recent photograph and signature"))
    replace(
        s, "How to apply", "Pay the application fee of 500 rupees", "Pay the application fee of 600 rupees"
    )


pair("mixed-revision", NOTICE, _mixed)
pair(
    "capitalisation-only",
    AGREEMENT,
    lambda s: replace(
        s,
        "2. Fees and Payment",
        "Invoices are payable within 30 days of the invoice date.",
        "Invoices are payable within 30 days of the Invoice Date.",
    ),
)
pair(
    "punctuation-only",
    AGREEMENT,
    lambda s: replace(
        s,
        "3. Term and Termination",
        "Either party may terminate this agreement with 60 days written notice.",
        "Either party may terminate this agreement, with 60 days written notice.",
    ),
)


def main() -> int:
    # Named pairs only, when given; otherwise every pair is rebuilt.
    wanted = set(sys.argv[1:]) or set(PAIRS)
    for name, (before, after, options) in PAIRS.items():
        if name not in wanted:
            continue
        folder = ROOT / name
        folder.mkdir(parents=True, exist_ok=True)
        save(folder / "before.docx", render(before))
        save(folder / "after.docx", render(after, **options))
        if not (folder / "expected.yaml").exists():
            print(f"{name}: write expected.yaml by hand")
    print(f"Built {len(wanted & set(PAIRS))} pairs in {ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
