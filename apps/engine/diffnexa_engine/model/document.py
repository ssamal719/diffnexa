"""Canonical document model.

Every input format is converted into this neutral structure before anything is
compared. The comparison engine only ever reads this model, so new sources of
text (OCR in V1.1, other formats later) plug in by producing the same objects.

Coordinate system (used everywhere in DiffNexa):
    * Units are PDF points (1/72 inch).
    * Origin is the top-left corner of the page *as displayed*, i.e. after the
      page's rotation has been applied. x grows to the right, y grows downward.
    * This matches what a person sees in a PDF viewer, which is what evidence
      highlights are drawn on.

Word IDs have the form ``p{page}-w{index}`` (index is 0-based extraction order
on that page). They are stable for the same file and the same engine version.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION: Literal["1"] = "1"
WORD_ID_PATTERN = re.compile(r"^p(?P<page>[1-9][0-9]*)-w(?P<index>0|[1-9][0-9]*)$")


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class TextSource(StrEnum):
    """Where a word's text came from."""

    TEXT_LAYER = "text_layer"  # read directly from the PDF's text
    OCR = "ocr"  # recognised from an image (planned for V1.1)


class TextLayerStatus(StrEnum):
    PRESENT = "present"  # readable text was found
    ABSENT = "absent"  # no text at all on the page (often a scanned page)
    UNREADABLE = "unreadable"  # text exists but most glyphs can't be mapped to characters


class BBox(_Frozen):
    x0: float
    y0: float
    x1: float
    y1: float

    @model_validator(mode="after")
    def _ordered(self) -> BBox:
        if self.x1 < self.x0 or self.y1 < self.y0:
            raise ValueError("bbox must satisfy x0 <= x1 and y0 <= y1")
        return self

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return self.width * self.height

    def within(self, width: float, height: float, tolerance: float = 1.0) -> bool:
        return (
            self.x0 >= -tolerance
            and self.y0 >= -tolerance
            and self.x1 <= width + tolerance
            and self.y1 <= height + tolerance
        )

    @staticmethod
    def union(boxes: list[BBox]) -> BBox:
        if not boxes:
            raise ValueError("cannot take the union of zero boxes")
        return BBox(
            x0=min(b.x0 for b in boxes),
            y0=min(b.y0 for b in boxes),
            x1=max(b.x1 for b in boxes),
            y1=max(b.y1 for b in boxes),
        )


class Word(_Frozen):
    id: str = Field(pattern=WORD_ID_PATTERN.pattern)
    text: str = Field(min_length=1)
    bbox: BBox
    font_name: str | None = None
    font_size: float | None = Field(default=None, ge=0)
    bold: bool = False
    italic: bool = False
    upright: bool = True
    source: TextSource = TextSource.TEXT_LAYER
    # 1.0 for text read from the text layer. OCR words carry the recogniser's confidence.
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ImageRegion(_Frozen):
    id: str
    bbox: BBox
    source_width: int | None = Field(default=None, ge=0)
    source_height: int | None = Field(default=None, ge=0)


class LinkRegion(_Frozen):
    id: str
    bbox: BBox
    uri: str | None = Field(default=None, max_length=2000)


class Page(_Frozen):
    number: int = Field(ge=1)
    label: str | None = Field(default=None, max_length=100)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: Literal[0, 90, 180, 270] = 0
    text_layer: TextLayerStatus
    likely_scanned: bool = False
    image_coverage: float = Field(default=0.0, ge=0.0, le=1.0)
    words: tuple[Word, ...] = ()
    images: tuple[ImageRegion, ...] = ()
    links: tuple[LinkRegion, ...] = ()

    @model_validator(mode="after")
    def _ids_belong_to_page(self) -> Page:
        seen: set[str] = set()
        for word in self.words:
            match = WORD_ID_PATTERN.match(word.id)
            if match is None or int(match.group("page")) != self.number:
                raise ValueError(f"word id {word.id!r} does not belong to page {self.number}")
            if word.id in seen:
                raise ValueError(f"duplicate word id {word.id!r}")
            seen.add(word.id)
        return self

    @property
    def word_count(self) -> int:
        return len(self.words)

    def text(self) -> str:
        return " ".join(w.text for w in self.words)


class DocumentMetadata(_Frozen):
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    creator: str | None = None
    producer: str | None = None
    creation_date: str | None = None
    modification_date: str | None = None


class DocumentSource(_Frozen):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(ge=1)
    pdf_version: str | None = None
    # True only for PDFs with an owner password (permission restrictions) that still
    # open without a password. PDFs that need a password to open are rejected earlier.
    is_encrypted: bool = False


class ExtractionInfo(_Frozen):
    engine_version: str
    extractor: str
    warnings: tuple[str, ...] = ()


class Document(_Frozen):
    schema_version: Literal["1"] = SCHEMA_VERSION
    source: DocumentSource
    metadata: DocumentMetadata = DocumentMetadata()
    pages: tuple[Page, ...] = Field(min_length=1)
    extraction: ExtractionInfo

    @model_validator(mode="after")
    def _pages_numbered_in_order(self) -> Document:
        for expected, page in enumerate(self.pages, start=1):
            if page.number != expected:
                raise ValueError(f"page numbers must run 1..n in order; got {page.number}")
        return self

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def page(self, number: int) -> Page:
        if number < 1 or number > len(self.pages):
            raise IndexError(f"page {number} does not exist (document has {len(self.pages)})")
        return self.pages[number - 1]

    def word_index(self) -> dict[str, Word]:
        """All words keyed by ID. IDs include the page number, so they are unique."""
        return {w.id: w for p in self.pages for w in p.words}
