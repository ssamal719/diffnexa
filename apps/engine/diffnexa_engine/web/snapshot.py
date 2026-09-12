"""What DiffNexa keeps after reading a webpage.

A snapshot is the meaningful content of a page at a moment in time, in a form
that can be compared later. It is deliberately not the page: no scripts, no
styles, no markup, no images. Storing the extracted content rather than the raw
HTML means a snapshot is far smaller, cannot be re-rendered as a copy of
someone's site, and contains nothing that could execute.

Two design points carry over from the PDF side:

* `ContentNode` satisfies the shared `ContentBlock` protocol from W1, so text
  alignment, move detection and value typing work on web content without a line
  of new comparison code.
* Every node records where it came from — its DOM path, and the headings above
  it — so a change can always be traced back and explained. A webpage has no
  page numbers, so `section_path` does the job page numbers do for PDFs.

Nothing here is inferred. Every field is read from the page or derived
deterministically from it.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SNAPSHOT_SCHEMA_VERSION: Literal["1"] = "1"


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class NodeRole(StrEnum):
    """What a piece of content is, as the page itself declared it."""

    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE_CELL = "table_cell"
    QUOTE = "quote"
    PREFORMATTED = "preformatted"
    LINK = "link"


class MainRegionStrategy(StrEnum):
    """Which rule found the page's main content. Recorded so it is explainable."""

    MAIN_ELEMENT = "main_element"
    ARTICLE_ELEMENT = "article_element"
    SCORED_REGION = "scored_region"
    BODY_FALLBACK = "body_fallback"


class RenderNote(StrEnum):
    NEEDS_JAVASCRIPT = "needs_javascript"
    EMPTY_PAGE = "empty_page"


class WebToken(_Frozen):
    """One word, identified so evidence can cite exactly it."""

    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1)


class TableRef(_Frozen):
    """Where a cell sits, in the terms a reader would use."""

    table_index: int = Field(ge=0)
    row_index: int = Field(ge=0)
    column_index: int = Field(ge=0)
    column_header: str | None = Field(default=None, max_length=200)
    row_key: str | None = Field(default=None, max_length=200)
    is_header: bool = False


class ContentNode(_Frozen):
    """A heading, paragraph, list item, quote, table cell or link."""

    id: str = Field(pattern=r"^n[0-9]+$")
    role: NodeRole
    level: int | None = Field(default=None, ge=1, le=6)  # headings only
    path: str = Field(min_length=1, max_length=500)  # DOM path within the page
    section_path: tuple[str, ...] = ()  # the headings above this node
    text: str = Field(min_length=1)
    tokens: tuple[WebToken, ...] = ()
    href: str | None = Field(default=None, max_length=2000)
    table: TableRef | None = None

    @model_validator(mode="after")
    def _consistent(self) -> ContentNode:
        if self.role is NodeRole.HEADING and self.level is None:
            raise ValueError("a heading must record its level")
        if self.role is not NodeRole.HEADING and self.level is not None:
            raise ValueError("only headings have a level")
        if self.role is NodeRole.TABLE_CELL and self.table is None:
            raise ValueError("a table cell must record where it sits")
        for token in self.tokens:
            if not token.id.startswith(f"{self.id}-"):
                raise ValueError(f"token {token.id!r} does not belong to node {self.id}")
        return self


class SnapshotSource(_Frozen):
    """Where this snapshot came from."""

    url: str = Field(min_length=1, max_length=2048)
    final_url: str = Field(min_length=1, max_length=2048)
    fetched_at: str  # ISO-8601 UTC; deliberately excluded from the fingerprint
    http_status: int = Field(ge=100, le=599)
    content_type: str = Field(max_length=100)
    charset: str | None = Field(default=None, max_length=40)
    redirect_chain: tuple[str, ...] = ()


class SnapshotMetadata(_Frozen):
    title: str | None = Field(default=None, max_length=500)
    meta_description: str | None = Field(default=None, max_length=1000)
    canonical_url: str | None = Field(default=None, max_length=2048)
    lang: str | None = Field(default=None, max_length=20)


class ExtractionInfo(_Frozen):
    """How the content was found, so a person can judge whether to trust it."""

    extractor: str
    extractor_version: str
    noise_rules_version: str
    strategy: MainRegionStrategy
    warnings: tuple[str, ...] = ()
    removed_counts: dict[str, int] = Field(default_factory=dict)


class Snapshot(_Frozen):
    schema_version: Literal["1"] = SNAPSHOT_SCHEMA_VERSION
    source: SnapshotSource
    metadata: SnapshotMetadata = SnapshotMetadata()
    nodes: tuple[ContentNode, ...] = ()
    extraction: ExtractionInfo
    render_note: RenderNote | None = None
    # Fingerprint of the content, excluding when it was fetched.
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def word_count(self) -> int:
        return sum(len(node.tokens) for node in self.nodes)

    def node_index(self) -> dict[str, ContentNode]:
        return {node.id: node for node in self.nodes}

    def text(self) -> str:
        return "\n".join(node.text for node in self.nodes)


def content_fingerprint(nodes: tuple[ContentNode, ...], metadata: SnapshotMetadata, final_url: str) -> str:
    """A stable fingerprint of what the page said, not of when we looked.

    Two captures of an unchanged page produce the same fingerprint, which is
    what lets the product say "nothing has changed" with confidence, and what
    lets a later comparison prove both snapshots are the ones it was given.
    """
    payload = {
        "final_url": final_url,
        "metadata": metadata.model_dump(),
        "nodes": [
            {
                "id": node.id,
                "role": node.role.value,
                "level": node.level,
                "path": node.path,
                "section_path": list(node.section_path),
                "text": node.text,
                "href": node.href,
                "table": node.table.model_dump() if node.table else None,
            }
            for node in nodes
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
