"""Turn a page of loose words into lines and paragraphs, in reading order.

Stage 1 extraction gives every word with its position. Comparison needs larger
units, because comparing word-by-word across a whole document reports every
line break as a change. This module builds those units.

How it works, and what it assumes:

* **Lines.** Words whose vertical spans overlap by more than half of the smaller
  word's height belong to the same line. Within a line, words are ordered left
  to right. This tolerates the small baseline jitter normal in PDFs.
* **Columns.** If a page has a clear vertical gutter — a full-height empty
  strip wide enough to separate two bodies of text — the page is split and each
  column is read top to bottom before moving to the next. Otherwise the page is
  read as one column.
* **Paragraphs.** Consecutive lines join into a paragraph while the vertical gap
  stays close to the normal line spacing and the left edge is consistent. A
  larger gap, an indent change, or a change of font size starts a new paragraph.
* **Headings.** A short paragraph that is bold, or noticeably larger than the
  document's usual body size, is marked as a heading. Headings are compared like
  any other text; the flag is kept so later stages can label changes usefully.
* **Hyphenation.** A line ending in a hyphen is rejoined with the next line when
  the result looks like one word split across lines.

Known limitations, tested in tests/test_blocks.py:

* Reading order across complex magazine-style layouts (more than two columns,
  text wrapping around images, sidebars) is approximated by the column rule
  above and may be wrong.
* Right-to-left scripts are not handled.
* A table is currently read as ordinary lines of text; DiffNexa does not yet
  reconstruct rows and columns (see docs/comparison-algorithm.md).
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

from diffnexa_engine.model.document import BBox, Document, Page, TextLayerStatus, Word

LINE_OVERLAP_RATIO = 0.5
PARAGRAPH_GAP_FACTOR = 1.35
SPACING_CLUSTER_FACTOR = 1.2  # gaps within 20% of each other are the same kind of gap
DEFAULT_LEADING_FACTOR = 1.25  # ordinary line spacing, as a multiple of font size
INDENT_TOLERANCE = 12.0  # points
HEADING_SIZE_FACTOR = 1.15
HEADING_MAX_WORDS = 18
MIN_GUTTER_WIDTH = 24.0  # points of empty vertical space to count as a column break
HYPHEN_END = re.compile(r"(\w)[-\u2010\u2011]$")
LOWER_START = re.compile(r"^[a-z\u00e0-\u00ff]")


@dataclass(frozen=True)
class Line:
    page: int
    words: tuple[Word, ...]
    column: int

    @property
    def text(self) -> str:
        return " ".join(word.text for word in self.words)

    @property
    def bbox(self) -> BBox:
        return BBox.union([word.bbox for word in self.words])

    @property
    def font_size(self) -> float:
        sizes = [w.font_size for w in self.words if w.font_size]
        return statistics.median(sizes) if sizes else 0.0

    @property
    def is_bold(self) -> bool:
        return bool(self.words) and all(word.bold for word in self.words)


@dataclass
class Block:
    """A paragraph, heading, or other run of lines read as one unit."""

    lines: list[Line] = field(default_factory=list)
    is_heading: bool = False
    is_running_head: bool = False  # repeated header/footer, set by headers.py

    @property
    def page(self) -> int:
        return self.lines[0].page

    @property
    def pages(self) -> tuple[int, ...]:
        return tuple(dict.fromkeys(line.page for line in self.lines))

    @property
    def words(self) -> tuple[Word, ...]:
        return tuple(word for line in self.lines for word in line.words)

    @property
    def tokens(self) -> tuple[Word, ...]:
        """The block's words, under the name the shared ContentBlock protocol uses.

        `words` is kept because the PDF code reads more naturally with it; this
        is the same tuple, so the two can never disagree.
        """
        return self.words

    @property
    def word_ids(self) -> tuple[str, ...]:
        return tuple(word.id for word in self.words)

    @property
    def text(self) -> str:
        """The block's text, with words hyphenated across lines rejoined."""
        parts: list[str] = []
        for index, line in enumerate(self.lines):
            text = line.text
            is_last = index == len(self.lines) - 1
            if not is_last:
                next_text = self.lines[index + 1].text
                if HYPHEN_END.search(text) and LOWER_START.match(next_text):
                    parts.append(text[:-1])
                    continue
            parts.append(text)
            if not is_last:
                parts.append(" ")
        return "".join(parts).strip()

    def bbox_for_page(self, page: int) -> BBox:
        boxes = [line.bbox for line in self.lines if line.page == page]
        return BBox.union(boxes)


def build_lines(page: Page) -> list[Line]:
    if not page.words:
        return []
    columns = _split_columns(page)
    lines: list[Line] = []
    for column_index, column_words in enumerate(columns):
        for grouped in _group_into_lines(column_words):
            lines.append(Line(page=page.number, words=tuple(grouped), column=column_index))
    return lines


def _group_into_lines(words: list[Word]) -> list[list[Word]]:
    remaining = sorted(words, key=lambda w: (w.bbox.y0, w.bbox.x0))
    rows: list[list[Word]] = []
    for word in remaining:
        placed = False
        for row in rows:
            if _same_line(row[-1], word):
                row.append(word)
                placed = True
                break
        if not placed:
            rows.append([word])
    for row in rows:
        row.sort(key=lambda w: w.bbox.x0)
    rows.sort(key=lambda row: (min(w.bbox.y0 for w in row), row[0].bbox.x0))
    return rows


def _same_line(left: Word, right: Word) -> bool:
    top = max(left.bbox.y0, right.bbox.y0)
    bottom = min(left.bbox.y1, right.bbox.y1)
    overlap = bottom - top
    if overlap <= 0:
        return False
    smaller = min(left.bbox.height, right.bbox.height)
    return smaller > 0 and overlap / smaller >= LINE_OVERLAP_RATIO


def _split_columns(page: Page) -> list[list[Word]]:
    """Split a page into columns at a clear full-height vertical gutter."""
    words = sorted(page.words, key=lambda w: w.bbox.x0)
    if len(words) < 12:
        return [list(page.words)]

    # Walk left to right tracking how far right any word has reached. A point
    # where nothing overlaps and the gap is wide is a gutter.
    reach = words[0].bbox.x1
    best_gap = 0.0
    best_at = 0.0
    for word in words[1:]:
        gap = word.bbox.x0 - reach
        if gap > best_gap:
            best_gap = gap
            best_at = reach + gap / 2
        reach = max(reach, word.bbox.x1)

    if best_gap < MIN_GUTTER_WIDTH:
        return [list(page.words)]

    left = [w for w in page.words if w.bbox.x1 <= best_at]
    right = [w for w in page.words if w.bbox.x0 >= best_at]
    if len(left) < 5 or len(right) < 5:
        return [list(page.words)]
    return [left, right]


def build_blocks(document: Document) -> list[Block]:
    """All blocks of a document, in reading order across pages."""
    body_size = _body_font_size(document)
    blocks: list[Block] = []
    for page in document.pages:
        if page.text_layer is not TextLayerStatus.PRESENT:
            continue
        lines = build_lines(page)
        blocks.extend(_lines_to_blocks(lines, body_size))
    return blocks


def _body_font_size(document: Document) -> float:
    sizes = [w.font_size for p in document.pages for w in p.words if w.font_size]
    return statistics.median(sizes) if sizes else 0.0


def _lines_to_blocks(lines: list[Line], body_size: float) -> list[Block]:
    blocks: list[Block] = []
    current: Block | None = None
    previous: Line | None = None
    spacing = _typical_spacing(lines)

    for line in lines:
        if current is None or previous is None or _starts_new_block(previous, line, spacing):
            current = Block(lines=[line])
            blocks.append(current)
        else:
            current.lines.append(line)
        previous = line

    for block in blocks:
        block.is_heading = _looks_like_heading(block, body_size)
    return blocks


def _typical_spacing(lines: list[Line]) -> float:
    """Estimate ordinary line spacing, ignoring the larger paragraph gaps.

    A plain median is wrong here. On a page of wrapped paragraphs the gaps come
    in two clusters — line spacing and the bigger paragraph spacing — and the
    median can land between them, so paragraph breaks stop being visible.

    Instead the smallest cluster of gaps is found: the smallest gap that at
    least one other gap is close to. That is line spacing, because every
    paragraph break is larger. Taking the median of that cluster keeps one freak
    tight line from dragging the estimate down.
    """
    gaps = sorted(
        gap
        for i in range(len(lines) - 1)
        if lines[i + 1].column == lines[i].column and (gap := lines[i + 1].bbox.y0 - lines[i].bbox.y0) > 0
    )
    if not gaps:
        return 0.0
    if len(gaps) == 1:
        # One gap alone cannot show which kind of gap it is, so fall back to what
        # the type itself implies: ordinary leading is about 1.25x the font size,
        # and anything noticeably larger is a paragraph break.
        implied = _implied_leading(lines)
        return min(gaps[0], implied) if implied else gaps[0]

    minimum_cluster = max(2, len(gaps) // 4)
    for candidate in gaps:
        cluster = [gap for gap in gaps if gap <= candidate * SPACING_CLUSTER_FACTOR]
        if len(cluster) >= minimum_cluster:
            return statistics.median(cluster)
    return gaps[0]


def _implied_leading(lines: list[Line]) -> float:
    sizes = [line.font_size for line in lines if line.font_size]
    return statistics.median(sizes) * DEFAULT_LEADING_FACTOR if sizes else 0.0


def _starts_new_block(previous: Line, line: Line, spacing: float) -> bool:
    if line.column != previous.column:
        return True
    gap = line.bbox.y0 - previous.bbox.y0
    if spacing > 0 and gap > spacing * PARAGRAPH_GAP_FACTOR:
        return True
    if abs(line.bbox.x0 - previous.bbox.x0) > INDENT_TOLERANCE:
        return True
    if previous.font_size and line.font_size:
        larger = max(previous.font_size, line.font_size)
        smaller = min(previous.font_size, line.font_size)
        if smaller > 0 and larger / smaller > 1.1:
            return True
    if previous.is_bold != line.is_bold:
        return True
    return False


def _looks_like_heading(block: Block, body_size: float) -> bool:
    if len(block.text.split()) > HEADING_MAX_WORDS:
        return False
    size = block.lines[0].font_size
    if body_size and size and size >= body_size * HEADING_SIZE_FACTOR:
        return True
    return all(line.is_bold for line in block.lines) and len(block.lines) <= 2
