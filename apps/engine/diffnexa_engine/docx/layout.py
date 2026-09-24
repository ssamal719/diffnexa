"""Which page each part of a Word document is on — when the file says so.

A .docx stores flowing text, not pages. Pages exist only when a word
processor lays the text out, and the result depends on its fonts, printer
settings and version. So DiffNexa never calculates pages itself: it neither
counts paragraphs nor estimates lines.

What it can do is read the layout Word recorded. Every time Microsoft Word
saves a document it writes a marker, `<w:lastRenderedPageBreak/>`, at the exact
point where each page began in its own layout, and it stores the page and word
counts it saw in the document statistics (docProps/app.xml). Hard page breaks
(`<w:br w:type="page"/>`) and "page break before" paragraphs are explicit in the
file too. Reading those gives the page every word was on when the document was
last saved — the page the author saw in Word.

That record is only trusted when it demonstrably describes this content:

* the statistics must exist and count words close to what the document
  actually contains — other programs (and python-docx's template) copy stale
  statistics such as "1 page, 0 words" into files they write;
* the number of pages the markers add up to must equal the page count Word
  stored.

If either check fails, the layout is reported as unavailable, with the reason,
and no page numbers are given at all. A missing page number is honest; a
wrong one sends someone to the wrong page of a 100-page contract.

This module decides nothing about what changed. It only says where.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from lxml import etree
from pydantic import BaseModel, ConfigDict, Field

EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"

#: How far the stored word count may differ from the words DiffNexa read and
#: still describe the same content. Word counts some things DiffNexa does not
#: read (text boxes, for instance) and splits a few words differently, so an
#: exact match is not expected; a stale template ("0 words") is far outside it.
WORD_COUNT_TOLERANCE = 0.15
WORD_COUNT_SLACK = 10


LayoutReason = Literal["no_statistics", "statistics_out_of_date", "pages_disagree", "empty"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class NodePage(_Frozen):
    """The page a node's first word is on, and where inside it any later pages begin.

    `breaks` holds word (token) indices within the node: every index listed is
    the first word of a new page, so a node spanning three pages has two.
    """

    page: int = Field(ge=1)
    breaks: tuple[int, ...] = ()

    def page_of_token(self, index: int) -> int:
        return self.page + sum(1 for start in self.breaks if start <= index)


class DocxLayout(_Frozen):
    #: "recorded": page numbers come from the layout Word saved in the file.
    #: "unavailable": the file carries no trustworthy layout; see `reason`.
    status: Literal["recorded", "unavailable"] = "unavailable"
    reason: LayoutReason | None = "no_statistics"
    #: The number of pages Word recorded, when the layout is trusted.
    pages: int | None = Field(default=None, ge=1)
    nodes: dict[str, NodePage] = Field(default_factory=dict)

    def page_of(self, node_id: str, token_index: int = 0) -> int | None:
        if self.status != "recorded":
            return None
        node = self.nodes.get(node_id)
        return node.page_of_token(token_index) if node is not None else None


# ---------------------------------------------------------------- reading the breaks


@dataclass
class PageTracker:
    """Counts page breaks in reading order while the body is read.

    A hard page break is usually followed by Word's own rendered-break marker
    at the start of the next page. Both describe one new page, so a marker that
    arrives before any content after a hard break is not counted again.
    """

    page: int = 1
    rendered: int = 0
    hard: int = 0
    content_seen: bool = False
    after_hard_break: bool = False

    def content(self) -> None:
        self.content_seen = True
        self.after_hard_break = False

    def rendered_break(self) -> bool:
        if self.after_hard_break:
            return False
        self.page += 1
        self.rendered += 1
        return True

    def hard_break(self) -> bool:
        self.page += 1
        self.hard += 1
        self.after_hard_break = True
        return True

    def snapshot(self) -> tuple[int, bool, bool]:
        return self.page, self.content_seen, self.after_hard_break

    def restore(self, state: tuple[int, bool, bool]) -> None:
        self.page, self.content_seen, self.after_hard_break = state


@dataclass
class BreakLog:
    """The page breaks met inside one block, as word indices within its text."""

    breaks: list[int] = field(default_factory=list)

    def shifted(self, offset: int) -> list[int]:
        return [index + offset for index in self.breaks]


def node_page(start_page: int, breaks: list[int], word_count: int) -> NodePage:
    """A node's page from the page it began on and the breaks met while reading it.

    A break before the first word moves the whole node to the next page; a break
    after the last word belongs to whatever follows.
    """
    leading = sum(1 for index in breaks if index <= 0)
    inside = tuple(sorted(index for index in breaks if 0 < index < word_count))
    return NodePage(page=start_page + leading, breaks=inside)


# ---------------------------------------------------------------- trusting the record


def _statistic(app: etree._Element | None, name: str) -> int | None:
    if app is None:
        return None
    element = app.find(f"{{{EP}}}{name}")
    text = (element.text or "").strip() if element is not None else ""
    return int(text) if text.isdigit() else None


def decide_layout(
    app: etree._Element | None,
    tracker: PageTracker,
    nodes: dict[str, NodePage],
    words_read: int,
) -> DocxLayout:
    """Trust the recorded pages only when the file's own statistics confirm them."""
    stored_pages = _statistic(app, "Pages")
    stored_words = _statistic(app, "Words")
    if words_read == 0:
        return DocxLayout(status="unavailable", reason="empty")
    if stored_pages is None or stored_pages < 1 or stored_words is None:
        return DocxLayout(status="unavailable", reason="no_statistics")
    allowed = max(WORD_COUNT_SLACK, round(words_read * WORD_COUNT_TOLERANCE))
    # "0 words" beside real text is a copied template, never a count.
    if stored_words == 0 or abs(stored_words - words_read) > allowed:
        return DocxLayout(status="unavailable", reason="statistics_out_of_date")
    if tracker.page != stored_pages:
        return DocxLayout(status="unavailable", reason="pages_disagree")
    return DocxLayout(status="recorded", reason=None, pages=stored_pages, nodes=nodes)


__all__ = [
    "BreakLog",
    "DocxLayout",
    "NodePage",
    "PageTracker",
    "decide_layout",
    "node_page",
]
