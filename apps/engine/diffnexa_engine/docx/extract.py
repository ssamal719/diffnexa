"""Reading a Word document's content into the comparable model.

Only the document body is read, in order, keeping its structure:

* **Headings** — a paragraph whose style is Word's "heading N" or "Title", or
  that carries an outline level, directly or through its style. The level is
  kept.
* **Lists** — a paragraph with numbering, directly or through its style. Whether
  the list is bulleted or numbered, and the item's level, come from the
  document's own numbering definitions. The number Word displays ("3.", "b)")
  is not part of the text: Word computes it, so renumbering is not a change.
* **Paragraphs** — everything else with text.
* **Tables** — one node per cell, positioned by the table's grid column so a
  merged cell does not shift its neighbours. The first row is treated as the
  header row. Text in a nested table is read as part of the cell it sits in.
* **Links** — external hyperlinks, recorded with their destination. A link is
  never opened.

What is deliberately **not** read, and why:

* **Tracked changes** that have not been accepted or rejected. Reading them as
  ordinary text would report a pending suggestion as if it were the document's
  content, so such documents are refused with a clear message. Formatting-only
  revisions (a changed font, a changed paragraph setting) do not alter the text
  and are ignored.
* **Comments**, **headers and footers**, **footnotes and endnotes**, **text
  boxes**, and **images, charts and other embedded objects**. They are not
  compared in V1. Their presence is reported so the result never implies they
  were checked.
* **Hidden text** (runs formatted as hidden directly) and **field codes** (the
  instructions behind a field; the field's displayed result is read).
"""

from __future__ import annotations

import re

from lxml import etree

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.docx.errors import DocxError, DocxErrorCode
from diffnexa_engine.docx.model import (
    DocxDocument,
    DocxExtractionInfo,
    DocxNode,
    DocxProperties,
    content_fingerprint,
)
from diffnexa_engine.docx.package import DocxLimits, DocxPackage, open_package
from diffnexa_engine.web.snapshot import NodeRole, TableRef, WebToken

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
DC = "http://purl.org/dc/elements/1.1/"


def w(tag: str) -> str:
    return f"{{{W}}}{tag}"


# Revisions that change what the document says. Any of these means the text
# depends on whether suggestions are accepted, so the document is refused.
CONTENT_REVISIONS = frozenset(w(tag) for tag in ("ins", "del", "moveFrom", "moveTo", "cellIns", "cellDel"))

# Subtrees that never contribute text to the comparison.
SKIPPED = frozenset(
    w(tag)
    for tag in (
        "rPr",
        "pPr",
        "tblPr",
        "trPr",
        "tcPr",
        "sectPr",
        "instrText",
        "delInstrText",
        "delText",
        "del",
        "moveFrom",
        "fldData",
        "txbxContent",
        "footnoteReference",
        "endnoteReference",
        "commentReference",
        "annotationRef",
    )
)
# Embedded objects: counted, never read.
OBJECTS = frozenset({w("drawing"), w("pict"), w("object"), f"{{{MC}}}AlternateContent"})
# Containers whose children are read as if they were in place.
TRANSPARENT = frozenset(
    w(tag) for tag in ("sdt", "sdtContent", "customXml", "smartTag", "fldSimple", "ins", "moveTo")
)

LINK_SCHEMES = ("http://", "https://", "mailto:")
HEADING_NAME = re.compile(r"^heading\s*([1-9])$", re.IGNORECASE)
MAX_STYLE_DEPTH = 20
MAX_TABLE_TEXT = 200


def _val(element: etree._Element | None, tag: str) -> str | None:
    if element is None:
        return None
    child = element.find(w(tag))
    return child.get(w("val")) if child is not None else None


def _is_on(element: etree._Element) -> bool:
    return (element.get(w("val")) or "true").lower() not in {"0", "false", "off"}


# ---------------------------------------------------------------- styles and numbering


class _Styles:
    """Paragraph styles, read far enough to know headings and lists."""

    def __init__(self, root: etree._Element | None) -> None:
        self.name: dict[str, str] = {}
        self.based_on: dict[str, str] = {}
        self.outline: dict[str, int] = {}
        self.numbering: dict[str, tuple[str, int]] = {}
        self.default: str | None = None
        if root is None:
            return
        for style in root.iter(w("style")):
            if style.get(w("type")) != "paragraph":
                continue
            style_id = style.get(w("styleId"))
            if not style_id:
                continue
            if (style.get(w("default")) or "").lower() in {"1", "true", "on"}:
                self.default = style_id
            name = _val(style, "name")
            if name:
                self.name[style_id] = name.strip().lower()
            based = _val(style, "basedOn")
            if based:
                self.based_on[style_id] = based
            ppr = style.find(w("pPr"))
            outline = _val(ppr, "outlineLvl")
            if outline is not None and outline.isdigit():
                self.outline[style_id] = int(outline)
            numbered = _numbering_of(ppr)
            if numbered is not None:
                self.numbering[style_id] = numbered

    def chain(self, style_id: str | None) -> list[str]:
        chain: list[str] = []
        current = style_id
        while current and current not in chain and len(chain) < MAX_STYLE_DEPTH:
            chain.append(current)
            current = self.based_on.get(current)
        return chain

    def heading_level(self, style_id: str | None) -> int | None:
        for current in self.chain(style_id):
            name = self.name.get(current, "")
            found = HEADING_NAME.match(name)
            if found:
                return int(found.group(1))
            if name == "title":
                return 1
            if current in self.outline:
                level = self.outline[current]
                return level + 1 if level < 9 else None
        return None

    def list_numbering(self, style_id: str | None) -> tuple[str, int] | None:
        for current in self.chain(style_id):
            if current in self.numbering:
                return self.numbering[current]
        return None


def _numbering_of(ppr: etree._Element | None) -> tuple[str, int] | None:
    if ppr is None:
        return None
    num_pr = ppr.find(w("numPr"))
    if num_pr is None:
        return None
    num_id = _val(num_pr, "numId")
    if num_id is None:
        return None
    level = _val(num_pr, "ilvl")
    return num_id, int(level) if level and level.isdigit() else 0


class _Numbering:
    """Which numbering definitions are bullets and which are numbers."""

    def __init__(self, root: etree._Element | None) -> None:
        self.abstract_of: dict[str, str] = {}
        self.formats: dict[tuple[str, int], str] = {}
        self.overrides: dict[tuple[str, int], str] = {}
        if root is None:
            return
        for abstract in root.iter(w("abstractNum")):
            abstract_id = abstract.get(w("abstractNumId"))
            for level in abstract.iter(w("lvl")):
                ilvl = level.get(w("ilvl"))
                fmt = _val(level, "numFmt")
                if abstract_id is not None and ilvl and ilvl.isdigit() and fmt:
                    self.formats[(abstract_id, int(ilvl))] = fmt
        for num in root.iter(w("num")):
            num_id = num.get(w("numId"))
            abstract_id = _val(num, "abstractNumId")
            if num_id is None:
                continue
            if abstract_id is not None:
                self.abstract_of[num_id] = abstract_id
            for override in num.iter(w("lvlOverride")):
                ilvl = override.get(w("ilvl"))
                level = override.find(w("lvl"))
                fmt = _val(level, "numFmt") if level is not None else None
                if ilvl and ilvl.isdigit() and fmt:
                    self.overrides[(num_id, int(ilvl))] = fmt

    def kind(self, num_id: str, level: int) -> str | None:
        fmt = self.overrides.get((num_id, level))
        if fmt is None:
            abstract = self.abstract_of.get(num_id)
            fmt = self.formats.get((abstract, level)) if abstract is not None else None
        if fmt is None:
            return None
        if fmt == "none":
            return "none"
        return "bulleted" if fmt == "bullet" else "numbered"


# ---------------------------------------------------------------- text


class _Text:
    """Collects a block's visible text, and the links and objects inside it."""

    def __init__(self, relationships) -> None:
        self.relationships = relationships
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.objects = 0

    def read(self, element: etree._Element) -> None:
        tag = element.tag
        if not isinstance(tag, str) or tag in SKIPPED:
            return
        if tag in OBJECTS:
            self.objects += 1
            return
        if tag == w("r"):
            rpr = element.find(w("rPr"))
            vanish = rpr.find(w("vanish")) if rpr is not None else None
            if vanish is not None and _is_on(vanish):
                return
        if tag == w("t"):
            self.parts.append(element.text or "")
            return
        if tag in (w("tab"), w("ptab"), w("br"), w("cr")):
            self.parts.append(" ")
            return
        if tag == w("noBreakHyphen"):
            self.parts.append("-")
            return
        if tag == w("hyperlink"):
            inner = _Text(self.relationships)
            for child in element:
                inner.read(child)
            self.parts.extend(inner.parts)
            self.objects += inner.objects
            href = self._href(element)
            text = normalize("".join(inner.parts))
            if href and text:
                self.links.append((text, href))
            return
        for child in element:
            self.read(child)

    def _href(self, element: etree._Element) -> str | None:
        rel_id = element.get(f"{{{R}}}id")
        if not rel_id:
            return None  # a link to a place inside this document
        rel = self.relationships.get(rel_id)
        if rel is None or not rel.external:
            return None
        target = rel.target.strip()
        return target[:2000] if target.lower().startswith(LINK_SCHEMES) else None

    @property
    def text(self) -> str:
        return normalize("".join(self.parts))


# ---------------------------------------------------------------- the body


class _Builder:
    def __init__(self, package: DocxPackage, limits: DocxLimits) -> None:
        self.package = package
        self.limits = limits
        self.styles = _Styles(package.styles)
        self.numbering = _Numbering(package.numbering)
        self.nodes: list[DocxNode] = []
        self.links: list[tuple[str, str, str, tuple[str, ...]]] = []
        self.headings: list[tuple[int, str]] = []
        self.paragraphs = 0
        self.tables = 0
        self.objects = 0
        self.alt_chunks = 0

    # -- node creation

    def _next_id(self) -> str:
        if len(self.nodes) + len(self.links) >= self.limits.max_nodes:
            raise DocxError(DocxErrorCode.TOO_COMPLEX, f"more than {self.limits.max_nodes} pieces of content")
        return f"n{len(self.nodes)}"

    def _add(self, text: str, path: str, role: NodeRole, **fields) -> None:
        node_id = self._next_id()
        self.nodes.append(
            DocxNode(
                id=node_id,
                role=role,
                path=path,
                section_path=tuple(heading for _level, heading in self.headings),
                text=text,
                tokens=tuple(
                    WebToken(id=f"{node_id}-t{index}", text=word) for index, word in enumerate(text.split())
                ),
                **fields,
            )
        )

    def _collect_links(self, reader: _Text, path: str) -> None:
        section = tuple(heading for _level, heading in self.headings)
        for index, (text, href) in enumerate(reader.links, start=1):
            self.links.append((text, href, f"{path}/hyperlink[{index}]", section))

    # -- blocks

    def blocks(self, container: etree._Element):
        """Paragraphs and tables in reading order, looking through content controls."""
        for child in container:
            tag = child.tag
            if tag in (w("p"), w("tbl")):
                yield child
            elif tag == w("altChunk"):
                self.alt_chunks += 1
            elif tag in TRANSPARENT:
                yield from self.blocks(child)

    def body(self, body: etree._Element) -> None:
        for block in self.blocks(body):
            if block.tag == w("p"):
                self.paragraph(block)
            else:
                self.table(block)

    def paragraph(self, p: etree._Element) -> None:
        self.paragraphs += 1
        path = f"body/p[{self.paragraphs}]"
        reader = _Text(self.package.relationships)
        for child in p:
            reader.read(child)
        self.objects += reader.objects
        text = reader.text
        if not text:
            return

        ppr = p.find(w("pPr"))
        style_id = _val(ppr, "pStyle") or self.styles.default
        direct_outline = _val(ppr, "outlineLvl")
        if direct_outline is not None and direct_outline.isdigit():
            level = int(direct_outline) + 1 if int(direct_outline) < 9 else None
        else:
            level = self.styles.heading_level(style_id)

        if level is not None:
            capped = min(level, 6)
            self.headings = [(lvl, txt) for lvl, txt in self.headings if lvl < capped]
            self._add(text, path, NodeRole.HEADING, level=capped)
            self.headings.append((capped, text))
            self._collect_links(reader, path)
            return

        numbering = _numbering_of(ppr)
        if numbering is None:
            numbering = self.styles.list_numbering(style_id)
        if numbering is not None and numbering[0] != "0":
            num_id, ilvl = numbering
            kind = self.numbering.kind(num_id, ilvl)
            if kind != "none":
                self._add(
                    text,
                    path,
                    NodeRole.LIST_ITEM,
                    list_kind=kind,
                    list_level=min(ilvl + 1, 9),
                )
                self._collect_links(reader, path)
                return

        self._add(text, path, NodeRole.PARAGRAPH)
        self._collect_links(reader, path)

    def _rows(self, table: etree._Element) -> list[etree._Element]:
        rows: list[etree._Element] = []
        for child in table:
            if child.tag == w("tr"):
                rows.append(child)
            elif child.tag in TRANSPARENT:
                rows.extend(self._rows(child))
        return rows

    def _cells(self, row: etree._Element) -> list[etree._Element]:
        cells: list[etree._Element] = []
        for child in row:
            if child.tag == w("tc"):
                cells.append(child)
            elif child.tag in TRANSPARENT:
                cells.extend(self._cells(child))
        return cells

    def _cell_text(self, cell: etree._Element, reader: _Text) -> None:
        """All the text in a cell, including any table nested inside it."""
        pieces: list[str] = []
        for block in self.blocks(cell):
            if block.tag == w("p"):
                inner = _Text(self.package.relationships)
                for child in block:
                    inner.read(child)
                reader.links.extend(inner.links)
                reader.objects += inner.objects
                if inner.text:
                    pieces.append(inner.text)
            else:
                for row in self._rows(block):
                    for nested in self._cells(row):
                        nested_reader = _Text(self.package.relationships)
                        self._cell_text(nested, nested_reader)
                        reader.links.extend(nested_reader.links)
                        reader.objects += nested_reader.objects
                        if nested_reader.parts:
                            pieces.append(nested_reader.text)
        reader.parts = [" ".join(pieces)] if pieces else []

    def table(self, table: etree._Element) -> None:
        self.tables += 1
        table_index = self.tables - 1
        rows = self._rows(table)

        grid: list[list[tuple[int, str, _Text]]] = []
        for row in rows:
            cells: list[tuple[int, str, _Text]] = []
            column = 0
            for cell in self._cells(row):
                tcpr = cell.find(w("tcPr"))
                span_value = _val(tcpr, "gridSpan")
                span = int(span_value) if span_value and span_value.isdigit() and int(span_value) > 0 else 1
                reader = _Text(self.package.relationships)
                self._cell_text(cell, reader)
                cells.append((column, reader.text, reader))
                column += span
            grid.append(cells)

        has_header = len(rows) >= 2
        header = {column: text for column, text, _reader in grid[0]} if grid and has_header else {}

        for row_number, cells in enumerate(grid, start=1):
            row_key = next((text for _column, text, _reader in cells if text), None)
            for column, text, reader in cells:
                self.objects += reader.objects
                path = f"body/tbl[{self.tables}]/tr[{row_number}]/tc[{column + 1}]"
                if text:
                    column_header = header.get(column) if row_number > 1 else None
                    self._add(
                        text,
                        path,
                        NodeRole.TABLE_CELL,
                        table=TableRef(
                            table_index=table_index,
                            row_index=row_number - 1,
                            column_index=column,
                            column_header=(column_header or None) and column_header[:MAX_TABLE_TEXT],
                            row_key=row_key[:MAX_TABLE_TEXT] if row_key else None,
                            is_header=has_header and row_number == 1,
                        ),
                    )
                self._collect_links(reader, path)

    # -- finishing

    def link_nodes(self) -> list[DocxNode]:
        nodes: list[DocxNode] = []
        for text, href, path, section in self.links:
            node_id = f"n{len(self.nodes) + len(nodes)}"
            nodes.append(
                DocxNode(
                    id=node_id,
                    role=NodeRole.LINK,
                    path=path[:500],
                    section_path=section,
                    text=text,
                    tokens=tuple(
                        WebToken(id=f"{node_id}-t{index}", text=word)
                        for index, word in enumerate(text.split())
                    ),
                    href=href,
                )
            )
        return nodes


def _properties(core: etree._Element | None) -> DocxProperties:
    def read(tag: str) -> str | None:
        if core is None:
            return None
        element = core.find(f"{{{DC}}}{tag}")
        value = normalize(element.text or "") if element is not None else ""
        return value[:1000] or None

    return DocxProperties(title=read("title"), subject=read("subject"))


def _refuse_tracked_changes(document: etree._Element) -> None:
    for element in document.iter():
        if element.tag in CONTENT_REVISIONS:
            raise DocxError(DocxErrorCode.TRACKED_CHANGES, "contains unaccepted content revisions")


def _warnings(builder: _Builder, related: frozenset[str]) -> tuple[str, ...]:
    notes: list[str] = []
    if builder.objects:
        noun = (
            "image or other embedded object" if builder.objects == 1 else "images or other embedded objects"
        )
        notes.append(f"Contains {builder.objects} {noun}. Their content is not compared.")
    if builder.alt_chunks:
        notes.append("Contains imported content from another file. That content is not compared.")
    unread = [
        label
        for kinds, label in (
            ({"header", "footer"}, "headers or footers"),
            ({"footnotes", "endnotes"}, "footnotes or endnotes"),
            ({"comments"}, "comments"),
        )
        if kinds & related
    ]
    if unread:
        notes.append(f"Has {', '.join(unread)}. These are not compared.")
    return tuple(notes)


def extract_docx(data: bytes, limits: DocxLimits | None = None) -> DocxDocument:
    """Read a .docx into the comparable model, or raise a DocxError saying why not."""
    limits = limits or DocxLimits()
    package = open_package(data, limits)
    document = package.document
    if document.tag != w("document"):
        raise DocxError(DocxErrorCode.UNREADABLE, "main part is not a WordprocessingML document")
    body = document.find(w("body"))
    if body is None:
        raise DocxError(DocxErrorCode.UNREADABLE, "document has no body")

    _refuse_tracked_changes(document)

    builder = _Builder(package, limits)
    builder.body(body)
    nodes = tuple(builder.nodes) + tuple(builder.link_nodes())
    properties = _properties(package.core)
    return DocxDocument(
        properties=properties,
        nodes=nodes,
        extraction=DocxExtractionInfo(
            embedded_objects=builder.objects,
            warnings=_warnings(builder, package.related_types),
        ),
        content_sha256=content_fingerprint(nodes, properties),
    )


__all__ = ["extract_docx"]
