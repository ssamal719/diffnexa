"""Generate synthetic golden pairs with exactly known edits.

Real PDFs are the most important test material, but they rarely isolate one
problem at a time. These generated pairs each target one behaviour, including
false-positive traps (identical files, re-wrapped text, page-number footers,
rotated and scanned pages) where the correct answer is "nothing changed".

Every document is a fictional recruitment notice with a "Page n of N" footer,
because footers that change when pages are added are a classic source of noise.

Output is deterministic: the same code always produces byte-identical PDFs.
"""

from __future__ import annotations

import io
import shutil
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

PAGE_W, PAGE_H = 595.28, 841.89  # A4 in points
MARGIN = 72.0
BODY_WIDTH = PAGE_W - 2 * MARGIN
FOOTER = "Page {n} of {total}"


@dataclass(frozen=True)
class Block:
    kind: str  # "heading" | "line" | "para"
    text: str
    width: float = BODY_WIDTH


@dataclass
class DocSpec:
    pages: list[list[Block]]
    rotate: dict[int, int] = field(default_factory=dict)  # page number -> degrees
    scanned: set[int] = field(default_factory=set)  # pages rendered as images only
    # page number -> (font name, body size), for formatting-only differences
    font_overrides: dict[int, tuple[str, float]] = field(default_factory=dict)


INTRO = (
    "The Regional Public Service Board invites online applications from eligible "
    "candidates for the posts listed below. Candidates should read this notice "
    "carefully before applying, as incomplete applications will not be considered."
)
PARA_A = "Section A. Applications must be submitted through the official portal only."
PARA_B = "Section B. Admit cards will be issued to eligible candidates by email."
PARA_C = "Section C. The written examination will be held at district centres."
ELIGIBILITY = "Candidates must hold a bachelor's degree from a recognised university."
RESERVATION = (
    "Reservation for reserved categories will follow the rules issued by the "
    "state government and in force on the last date of application."
)
HOW_TO_APPLY = (
    "Candidates must upload a recent photograph and signature. The Board will not "
    "accept applications sent by post or in person."
)


def base_pages() -> list[list[Block]]:
    return [
        [
            Block("heading", "Recruitment Notice No. 12/2026"),
            Block("line", "Post: Junior Assistant"),
            Block("para", INTRO),
            Block("para", PARA_A),
            Block("para", PARA_B),
            Block("para", PARA_C),
        ],
        [
            Block("heading", "Vacancies and Eligibility"),
            Block("line", "Total Vacancies: 627"),
            Block("line", "Maximum age: 30 years"),
            Block("para", ELIGIBILITY),
        ],
        [
            Block("heading", "Important Dates"),
            Block("line", "Last date to apply: 30 September 2026"),
            Block("line", "Annual scheme budget: Rs. 1,23,45,678"),
            Block("para", HOW_TO_APPLY),
        ],
    ]


def _replace(pages: list[list[Block]], old: str, new: str) -> list[list[Block]]:
    hits = 0
    out: list[list[Block]] = []
    for page in pages:
        row = []
        for block in page:
            if old in block.text:
                hits += 1
                block = Block(block.kind, block.text.replace(old, new), block.width)
            row.append(block)
        out.append(row)
    if hits != 1:
        raise ValueError(f"expected exactly one occurrence of {old!r}, found {hits}")
    return out


# ---------------------------------------------------------------- rendering


def _page_lines(
    page: list[Block], font_override: tuple[str, float] | None = None
) -> list[tuple[str, float, str]]:
    """Lay out one page as (font, size, text) lines."""
    from reportlab.lib.utils import simpleSplit

    body_font, body_size = font_override or ("Helvetica", 11.0)
    lines: list[tuple[str, float, str]] = []
    for block in page:
        if block.kind == "heading":
            lines.append(("Helvetica-Bold", 16.0, block.text))
        elif block.kind == "line":
            lines.append((body_font, body_size, block.text))
        elif block.kind == "para":
            for part in simpleSplit(block.text, body_font, body_size, block.width):
                lines.append((body_font, body_size, part))
        else:
            raise ValueError(f"unknown block kind {block.kind!r}")
        lines.append(("gap", 8.0, ""))
    return lines


def _scanned_image(lines: list[tuple[str, float, str]], footer: str) -> Any:
    """Render text into a picture, as a scanner would produce."""
    from PIL import Image, ImageDraw, ImageFont

    scale = 150 / 72  # 150 dpi
    img = Image.new("L", (int(PAGE_W * scale), int(PAGE_H * scale)), color=255)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=int(12 * scale))
    except TypeError:  # very old Pillow without scalable default font
        font = ImageFont.load_default()
    y = MARGIN * scale
    for font_name, size, text in lines:
        if font_name == "gap":
            y += size * scale
            continue
        draw.text((MARGIN * scale, y), text, fill=0, font=font)
        y += (size + 5) * scale
    draw.text((PAGE_W * scale / 2 - 40 * scale, (PAGE_H - 40) * scale), footer, fill=0, font=font)
    return img


def render_pdf(spec: DocSpec, path: Path) -> None:
    import pikepdf
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(PAGE_W, PAGE_H), invariant=1)
    c.setTitle("Recruitment Notice No. 12/2026")
    c.setAuthor("Regional Public Service Board (synthetic test document)")
    total = len(spec.pages)
    for number, page in enumerate(spec.pages, start=1):
        lines = _page_lines(page, spec.font_overrides.get(number))
        footer = FOOTER.format(n=number, total=total)
        if number in spec.scanned:
            image = _scanned_image(lines, footer)
            c.drawImage(ImageReader(image), 0, 0, width=PAGE_W, height=PAGE_H)
        else:
            y = PAGE_H - MARGIN
            for font_name, size, text in lines:
                if font_name == "gap":
                    y -= size
                    continue
                c.setFont(font_name, size)
                c.drawString(MARGIN, y - size, text)
                y -= size + 4
            c.setFont("Helvetica", 9)
            c.drawCentredString(PAGE_W / 2, 36, footer)
        c.showPage()
    c.save()

    buffer.seek(0)
    with pikepdf.open(buffer) as pdf:
        for number, degrees in spec.rotate.items():
            pdf.pages[number - 1].rotate(degrees, relative=False)
        pdf.save(path, deterministic_id=True)


# ---------------------------------------------------------------- pair definitions


@dataclass(frozen=True)
class SyntheticPair:
    name: str
    old: DocSpec
    new: DocSpec
    expected: dict[str, Any]


def _spec(name: str, description: str, **fields: Any) -> dict[str, Any]:
    data: dict[str, Any] = {"pair": name, "description": description, "source": "synthetic"}
    data.update(fields)
    return data


def _three_page_extraction(**overrides: Any) -> dict[str, Any]:
    doc = {
        "page_count": 3,
        "scanned_pages": [],
        "must_contain": [
            {"page": 1, "text": "Recruitment Notice No. 12/2026"},
            {"page": 2, "text": "Total Vacancies: 627"},
            {"page": 3, "text": "Last date to apply: 30 September 2026"},
        ],
    }
    doc.update(overrides)
    return doc


def _identical() -> SyntheticPair:
    pages = base_pages()
    return SyntheticPair(
        "identical-notice",
        DocSpec(pages),
        DocSpec(base_pages()),
        _spec(
            "identical-notice",
            "Byte-identical documents. The only correct answer is zero changes.",
            tags=["false-positive-trap"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            unchanged_pages={"old": [1, 2, 3], "new": [1, 2, 3]},
        ),
    )


def _reflowed() -> SyntheticPair:
    new_pages = base_pages()
    new_pages[0] = [Block(b.kind, b.text, 380.0) if b.text == INTRO else b for b in new_pages[0]]
    return SyntheticPair(
        "reflowed-paragraph",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "reflowed-paragraph",
            "The introduction is re-wrapped to a narrower width. The words are identical, "
            "so no content change may be reported.",
            tags=["false-positive-trap", "line-wrap"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            unchanged_pages={"old": [2, 3], "new": [2, 3]},
            must_not_report=[{"text": "invites online applications", "reason": "only line breaks moved"}],
        ),
    )


def _number_change() -> SyntheticPair:
    return SyntheticPair(
        "vacancy-number-change",
        DocSpec(base_pages()),
        DocSpec(_replace(base_pages(), "Total Vacancies: 627", "Total Vacancies: 654")),
        _spec(
            "vacancy-number-change",
            "Vacancy count changes from 627 to 654 on page 2.",
            tags=["number"],
            extraction={
                "old": _three_page_extraction(),
                "new": _three_page_extraction(must_contain=[{"page": 2, "text": "Total Vacancies: 654"}]),
            },
            expected_changes=[
                {
                    "category": "number",
                    "kind": "modified",
                    "label": "Total Vacancies",
                    "old": "627",
                    "new": "654",
                    "old_page": 2,
                    "new_page": 2,
                }
            ],
            unchanged_pages={"old": [1, 3], "new": [1, 3]},
        ),
    )


def _date_change() -> SyntheticPair:
    return SyntheticPair(
        "deadline-date-change",
        DocSpec(base_pages()),
        DocSpec(_replace(base_pages(), "30 September 2026", "15 October 2026")),
        _spec(
            "deadline-date-change",
            "Application deadline moves from 30 September 2026 to 15 October 2026.",
            tags=["date"],
            extraction={
                "old": _three_page_extraction(),
                "new": _three_page_extraction(
                    must_contain=[{"page": 3, "text": "Last date to apply: 15 October 2026"}]
                ),
            },
            expected_changes=[
                {
                    "category": "date",
                    "kind": "modified",
                    "label": "Last date to apply",
                    "old": "30 September 2026",
                    "new": "15 October 2026",
                    "old_page": 3,
                    "new_page": 3,
                }
            ],
            unchanged_pages={"old": [1, 2], "new": [1, 2]},
        ),
    )


def _indian_number() -> SyntheticPair:
    return SyntheticPair(
        "indian-number-format",
        DocSpec(base_pages()),
        DocSpec(_replace(base_pages(), "Rs. 1,23,45,678", "Rs. 1,25,00,000")),
        _spec(
            "indian-number-format",
            "An amount written in Indian digit grouping changes (1,23,45,678 to 1,25,00,000).",
            tags=["number", "indian-format"],
            extraction={
                "old": _three_page_extraction(must_contain=[{"page": 3, "text": "Rs. 1,23,45,678"}]),
                "new": _three_page_extraction(must_contain=[{"page": 3, "text": "Rs. 1,25,00,000"}]),
            },
            expected_changes=[
                {
                    "category": "number",
                    "kind": "modified",
                    "label": "Annual scheme budget",
                    "old": "1,23,45,678",
                    "new": "1,25,00,000",
                    "match": "contains",
                    "old_page": 3,
                    "new_page": 3,
                }
            ],
            unchanged_pages={"old": [1, 2], "new": [1, 2]},
        ),
    )


def _inserted_page() -> SyntheticPair:
    new_pages = base_pages()
    new_pages.insert(
        2,
        [
            Block("heading", "Annexure: Revised Syllabus"),
            Block("para", "The written examination will include general knowledge and reasoning."),
        ],
    )
    return SyntheticPair(
        "inserted-page",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "inserted-page",
            "A new page 3 is inserted. Every 'Page n of 3' footer becomes 'Page n of 4', "
            "which must be treated as noise, and the old page 3 is now page 4.",
            tags=["page", "false-positive-trap", "footer"],
            extraction={
                "old": _three_page_extraction(),
                "new": {
                    "page_count": 4,
                    "scanned_pages": [],
                    "must_contain": [
                        {"page": 3, "text": "Annexure: Revised Syllabus"},
                        {"page": 4, "text": "Last date to apply: 30 September 2026"},
                    ],
                },
            },
            # The page itself is reported, and so is the text it introduced: a
            # reader needs to know what the new page actually says.
            expected_changes=[
                {"category": "page", "kind": "added", "new_page": 3},
                {
                    "category": "text",
                    "kind": "added",
                    "new": "Annexure: Revised Syllabus",
                    "match": "contains",
                    "new_page": 3,
                },
                {
                    "category": "text",
                    "kind": "added",
                    "new": "general knowledge and reasoning",
                    "match": "contains",
                    "new_page": 3,
                },
            ],
            unchanged_pages={"old": [1, 2, 3], "new": [1, 2, 4]},
            must_not_report=[{"text": "of 3", "reason": "page-count footer, not a content change"}],
        ),
    )


def _moved_paragraph() -> SyntheticPair:
    """Section C moves from page 1 to the end of page 3.

    A swap of two neighbouring paragraphs would be ambiguous — either one could
    fairly be called "the one that moved". Moving a single paragraph to another
    page has exactly one correct answer, and is the case that matters in real
    documents.
    """
    new_pages = base_pages()
    section_c = next(b for b in new_pages[0] if b.text == PARA_C)
    new_pages[0].remove(section_c)
    new_pages[2].append(section_c)
    return SyntheticPair(
        "moved-paragraph",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "moved-paragraph",
            "Section C moves from page 1 to page 3. Its wording is unchanged, so it "
            "must be reported as moved rather than as a deletion plus an addition.",
            tags=["moved-text"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            expected_changes=[
                {
                    "category": "text",
                    "kind": "moved",
                    "old": "The written examination",
                    "new": "The written examination",
                    "match": "contains",
                    "old_page": 1,
                    "new_page": 3,
                }
            ],
            unchanged_pages={"old": [2], "new": [2]},
        ),
    )


def _wording_change() -> SyntheticPair:
    return SyntheticPair(
        "eligibility-wording-change",
        DocSpec(base_pages()),
        DocSpec(_replace(base_pages(), "bachelor's degree", "master's degree")),
        _spec(
            "eligibility-wording-change",
            "The required qualification changes from a bachelor's degree to a master's degree.",
            tags=["text"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            expected_changes=[
                {
                    "category": "text",
                    "kind": "modified",
                    "old": "bachelor's",
                    "new": "master's",
                    "match": "contains",
                    "old_page": 2,
                    "new_page": 2,
                }
            ],
            unchanged_pages={"old": [1, 3], "new": [1, 3]},
        ),
    )


def _scanned() -> SyntheticPair:
    extraction = _three_page_extraction(
        scanned_pages=[2],
        must_contain=[
            {"page": 1, "text": "Recruitment Notice No. 12/2026"},
            {"page": 3, "text": "Last date to apply: 30 September 2026"},
        ],
    )
    return SyntheticPair(
        "scanned-page",
        DocSpec(base_pages(), scanned={2}),
        DocSpec(base_pages(), scanned={2}),
        _spec(
            "scanned-page",
            "Page 2 is an image with no text layer in both versions. It must be detected as "
            "scanned, and nothing may be reported as changed. (OCR is planned for V1.1.)",
            tags=["scanned", "ocr-v1.1", "false-positive-trap"],
            extraction={"old": extraction, "new": extraction},
            unchanged_pages={"old": [1, 2, 3], "new": [1, 2, 3]},
        ),
    )


def _rotated() -> SyntheticPair:
    return SyntheticPair(
        "rotated-page",
        DocSpec(base_pages(), rotate={2: 90}),
        DocSpec(base_pages(), rotate={2: 90}),
        _spec(
            "rotated-page",
            "Page 2 is rotated 90 degrees in both versions. Its words must be read whole "
            "and in order, and nothing may be reported as changed.",
            tags=["rotation", "false-positive-trap"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            unchanged_pages={"old": [1, 2, 3], "new": [1, 2, 3]},
        ),
    )


def _text_added() -> SyntheticPair:
    new_pages = base_pages()
    new_pages[1].append(Block("para", RESERVATION))
    return SyntheticPair(
        "text-added",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "text-added",
            "A new paragraph about reservation is added to page 2.",
            tags=["text"],
            extraction={
                "old": _three_page_extraction(),
                "new": _three_page_extraction(
                    must_contain=[{"page": 2, "text": "Reservation for reserved categories"}]
                ),
            },
            expected_changes=[
                {
                    "category": "text",
                    "kind": "added",
                    "new": "Reservation for reserved categories",
                    "match": "contains",
                    "new_page": 2,
                }
            ],
            unchanged_pages={"old": [1, 3], "new": [1, 3]},
        ),
    )


def _text_removed() -> SyntheticPair:
    new_pages = base_pages()
    new_pages[0] = [b for b in new_pages[0] if b.text != PARA_B]
    return SyntheticPair(
        "text-removed",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "text-removed",
            "The paragraph about admit cards is deleted from page 1.",
            tags=["text"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            expected_changes=[
                {
                    "category": "text",
                    "kind": "removed",
                    "old": "Admit cards will be issued",
                    "match": "contains",
                    "old_page": 1,
                }
            ],
            unchanged_pages={"old": [2, 3], "new": [2, 3]},
        ),
    )


def _page_removed() -> SyntheticPair:
    new_pages = base_pages()
    del new_pages[1]
    return SyntheticPair(
        "page-removed",
        DocSpec(base_pages()),
        DocSpec(new_pages),
        _spec(
            "page-removed",
            "Page 2 (vacancies and eligibility) is deleted. Every footer becomes "
            "'Page n of 2', which is noise, and the old page 3 is now page 2.",
            tags=["page", "footer"],
            extraction={
                "old": _three_page_extraction(),
                "new": {
                    "page_count": 2,
                    "scanned_pages": [],
                    "must_contain": [{"page": 2, "text": "Last date to apply"}],
                },
            },
            # The page, and the content lost with it.
            expected_changes=[
                {"category": "page", "kind": "removed", "old_page": 2},
                {
                    "category": "text",
                    "kind": "removed",
                    "old": "Vacancies and Eligibility",
                    "match": "contains",
                    "old_page": 2,
                },
                {
                    "category": "text",
                    "kind": "removed",
                    "old": "Total Vacancies: 627",
                    "match": "contains",
                    "old_page": 2,
                },
            ],
            unchanged_pages={"old": [1, 3], "new": [1, 2]},
            must_not_report=[{"text": "of 3", "reason": "page-count footer, not a content change"}],
        ),
    )


def _formatting_only() -> SyntheticPair:
    """Identical words, different type. No content change may be reported."""
    new_pages = base_pages()
    new_pages[1] = [Block(b.kind, b.text, b.width) for b in new_pages[1]]
    return SyntheticPair(
        "formatting-only",
        DocSpec(base_pages()),
        DocSpec(new_pages, font_overrides={2: ("Helvetica-Oblique", 12.0)}),
        _spec(
            "formatting-only",
            "Page 2 is set in a different font and size. The words are identical, so "
            "no content change may be reported.",
            tags=["false-positive-trap", "formatting"],
            extraction={"old": _three_page_extraction(), "new": _three_page_extraction()},
            unchanged_pages={"old": [1, 2, 3], "new": [1, 2, 3]},
            must_not_report=[{"text": "Total Vacancies", "reason": "only the typeface changed"}],
        ),
    )


def _multiple_changes() -> SyntheticPair:
    """One realistic corrigendum: several changes of different kinds at once."""
    pages = _replace(base_pages(), "Total Vacancies: 627", "Total Vacancies: 654")
    pages = _replace(pages, "30 September 2026", "15 October 2026")
    pages = _replace(pages, "Maximum age: 30 years", "Maximum age: 32 years")
    pages[1].append(Block("para", RESERVATION))
    return SyntheticPair(
        "multiple-changes",
        DocSpec(base_pages()),
        DocSpec(pages),
        _spec(
            "multiple-changes",
            "A corrigendum changing the vacancy count, the maximum age, the deadline, "
            "and adding a paragraph about reservation.",
            tags=["number", "date", "text", "realistic"],
            extraction={
                "old": _three_page_extraction(),
                "new": _three_page_extraction(
                    must_contain=[
                        {"page": 2, "text": "Total Vacancies: 654"},
                        {"page": 3, "text": "15 October 2026"},
                    ]
                ),
            },
            expected_changes=[
                {
                    "category": "number",
                    "kind": "modified",
                    "label": "Total Vacancies",
                    "old": "627",
                    "new": "654",
                    "old_page": 2,
                    "new_page": 2,
                },
                {
                    "category": "number",
                    "kind": "modified",
                    "label": "Maximum age",
                    "old": "30",
                    "new": "32",
                    "old_page": 2,
                    "new_page": 2,
                },
                {
                    "category": "date",
                    "kind": "modified",
                    "old": "30 September 2026",
                    "new": "15 October 2026",
                    "old_page": 3,
                    "new_page": 3,
                },
                {
                    "category": "text",
                    "kind": "added",
                    "new": "Reservation for reserved categories",
                    "match": "contains",
                    "new_page": 2,
                },
            ],
            unchanged_pages={"old": [1], "new": [1]},
        ),
    )


PAIR_BUILDERS: list[Callable[[], SyntheticPair]] = [
    _identical,
    _reflowed,
    _number_change,
    _date_change,
    _indian_number,
    _inserted_page,
    _moved_paragraph,
    _wording_change,
    _scanned,
    _rotated,
    _text_added,
    _text_removed,
    _page_removed,
    _formatting_only,
    _multiple_changes,
]


def generate_synthetic_pairs(out_dir: Path) -> list[Path]:
    """(Re)generate every synthetic pair under out_dir. Returns the pair folders."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    folders = []
    for build in PAIR_BUILDERS:
        pair = build()
        folder = out_dir / pair.name
        folder.mkdir()
        render_pdf(pair.old, folder / "old.pdf")
        render_pdf(pair.new, folder / "new.pdf")
        (folder / "expected.yaml").write_text(
            "# Generated by diffnexa_engine.golden.synthetic. Do not edit by hand.\n"
            + yaml.safe_dump(pair.expected, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        folders.append(folder)
    return folders
