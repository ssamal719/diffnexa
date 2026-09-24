"""What a Word document says, in a form that can be compared and cited.

A .docx is a ZIP of XML files. Reading it produces this model: an ordered list
of content nodes — headings, paragraphs, list items, table cells and links —
each with a stable id, its structural path, the headings above it and its words
as individually citable tokens.

The node shape is deliberately the same one Website Change Detector uses
(`ContentNode`): a heading is a heading and a table cell is a table cell,
whichever file format it came from. That is what lets the proven comparison,
evidence and traceability code run on Word documents unchanged. What Word adds
— which kind of list an item is in, and at what level — is carried on a small
subclass rather than squeezed into fields meant for something else.

Nodes carry no URL, page number or bounding box: a Word document stores none
of those, and inventing them would put values in a result that nothing could
verify. The one exception is kept apart from the content, in `layout`: the page
each node was on when Microsoft Word last saved the file, read from the page
breaks Word recorded — and only when the file's own statistics confirm that
record describes this content (see layout.py). It is not part of the content
fingerprint, because where pages fall is not what the document says.
"""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from diffnexa_engine.docx.layout import DocxLayout
from diffnexa_engine.web.snapshot import ContentNode

DOCX_MODEL_VERSION: Literal["1"] = "1"
EXTRACTOR_VERSION = "2026.09.1"


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DocxNode(ContentNode):
    """One piece of a Word document's content.

    Paths are structural and 1-based, counted over the document body:
    `body/p[12]` is the twelfth body paragraph, `body/tbl[2]/tr[3]/tc[1]` the
    first column of the third row of the second table. Links are recorded
    separately with the path of the paragraph or cell they sit in.
    """

    list_kind: Literal["bulleted", "numbered"] | None = None
    list_level: int | None = Field(default=None, ge=1, le=9)


class DocxProperties(_Frozen):
    """The only document properties compared: the title and subject.

    Author, last-modified-by and the created and modified dates are deliberately
    not read. They identify people and change on every save, so comparing them
    would expose personal data and report a "change" every time.
    """

    title: str | None = Field(default=None, max_length=1000)
    subject: str | None = Field(default=None, max_length=1000)


class DocxExtractionInfo(_Frozen):
    extractor: str = "diffnexa-docx"
    extractor_version: str = EXTRACTOR_VERSION
    #: Images, charts, shapes, text boxes and other embedded objects. Counted so
    #: the report can say they exist; their content is never compared.
    embedded_objects: int = Field(default=0, ge=0)
    warnings: tuple[str, ...] = ()


class DocxDocument(_Frozen):
    schema_version: Literal["1"] = DOCX_MODEL_VERSION
    properties: DocxProperties = DocxProperties()
    nodes: tuple[DocxNode, ...] = ()
    extraction: DocxExtractionInfo = DocxExtractionInfo()
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    #: Where Word's pages fell, when the file records it; see layout.py.
    layout: DocxLayout = DocxLayout()

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    def node_index(self) -> dict[str, DocxNode]:
        return {node.id: node for node in self.nodes}


def content_fingerprint(nodes: tuple[DocxNode, ...], properties: DocxProperties) -> str:
    """A hash of what the document says, independent of how the file was zipped.

    Two saves of the same content produce the same fingerprint even though
    their ZIP timestamps differ, and evidence cites this fingerprint so it can
    always be checked against the document it came from.
    """
    canonical = {
        "properties": properties.model_dump(mode="json"),
        "nodes": [node.model_dump(mode="json") for node in nodes],
    }
    encoded = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


__all__ = [
    "DOCX_MODEL_VERSION",
    "DocxDocument",
    "DocxExtractionInfo",
    "DocxNode",
    "DocxProperties",
    "EXTRACTOR_VERSION",
    "content_fingerprint",
]
