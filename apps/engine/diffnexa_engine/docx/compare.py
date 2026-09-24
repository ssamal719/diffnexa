"""Comparing two Word documents.

Most of the work is done by code that already runs in production. Headings,
paragraphs and list items are compared by Website Change Detector's own layers
— the same block alignment, rename detection, word-level diffing and typed
numbers and dates — because a Word heading and a webpage heading are the same
kind of thing, and the same code should decide when one changed. Those layers
read only a node's id, role, text, words, path, headings and table position,
which a Word node has in exactly the same shape.

What is written here is only what a Word document genuinely adds:

1. **Document properties** — the title and subject, as document-level changes,
   kept apart from the body text.
2. **Structure the text alone cannot show** — a heading whose level changed, or
   a paragraph that became a list item, when the words are the same.
3. **Links** — compared exactly. Tracking parameters are not stripped as they
   are for webpages: in a document, the address written is the address meant.
4. **Tables** — paired by their content rather than their position, so adding a
   table does not make every later table look rewritten. Within a pair, rows
   are aligned like paragraphs and columns are matched by their header, so a
   renamed column header is one change and an inserted column is reported as
   cells added rather than as every cell shifting.

There is no volatility layer. A webpage has clocks and view counters; a Word
document says what its author wrote, so every change found is reported and
none is set aside as noise.

Every change is checked against both documents before the result is returned;
anything whose evidence cannot be proven is dropped and counted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.compare.normalize import MatchOptions, matching, normalize, normalize_key
from diffnexa_engine.compare.text_align import BlockPair, PairKind, align_blocks, word_segments
from diffnexa_engine.contracts.changes import (
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    DocxRef,
    Evidence,
    Side,
)
from diffnexa_engine.contracts.docx_traceability import verify_docx_traceability
from diffnexa_engine.docx.model import DocxDocument, DocxNode

# Website Change Detector's own comparison layers, reused unchanged.
from diffnexa_engine.web.compare import (
    PROSE_ROLES,
    _Builder,
    _cell_label,
    _emit_block_changes,
    _excerpt,
    _label_for,
    _node_evidence,
    _pair_renamed_headings,
    _subtype_for_heading,
    _subtype_for_prose,
    _typed_values,
)
from diffnexa_engine.web.snapshot import NodeRole

PROPERTY_FIELDS = (
    ("properties.title", "title", "Document title"),
    ("properties.subject", "subject", "Document subject"),
)

# Cells cited as evidence for a whole row or table: enough to find it, not the
# whole thing.
EVIDENCE_CELLS = 3


@dataclass
class DocxDiagnostics:
    dropped_untraceable: int = 0
    previous_warnings: tuple[str, ...] = ()
    revised_warnings: tuple[str, ...] = ()
    notes: list[str] = field(default_factory=list)


@dataclass
class DocxComparisonOutcome:
    result: ComparisonResult
    diagnostics: DocxDiagnostics
    previous: DocxDocument
    current: DocxDocument
    #: The matching options the comparison actually ran with.
    options: MatchOptions = field(default_factory=MatchOptions)


# ---------------------------------------------------------------- properties


def _property_evidence(document: DocxDocument, side: Side, field_name: str, value: str) -> Evidence:
    return Evidence(
        side=side,
        scope="document",
        field=field_name,
        snapshot_sha256=document.content_sha256,
        excerpt=_excerpt(value),
    )


def _compare_properties(builder: _Builder, old: DocxDocument, new: DocxDocument) -> None:
    for field_name, attribute, label in PROPERTY_FIELDS:
        before = getattr(old.properties, attribute)
        after = getattr(new.properties, attribute)
        if normalize_key(before or "") == normalize_key(after or ""):
            continue
        evidence = []
        if before:
            evidence.append(_property_evidence(old, Side.OLD, field_name, before))
        if after:
            evidence.append(_property_evidence(new, Side.NEW, field_name, after))
        kind = ChangeKind.MODIFIED if before and after else ChangeKind.ADDED if after else ChangeKind.REMOVED
        builder.add(
            kind=kind,
            category=ChangeCategory.METADATA,
            subtype=attribute,
            label=label,
            old_value=before or None,
            new_value=after or None,
            evidence=tuple(evidence),
        )


# ---------------------------------------------------------------- structure


def describe_block(node: DocxNode) -> str:
    """What kind of block a node is, in Word's own terms."""
    if node.role is NodeRole.HEADING:
        return f"Heading {node.level}"
    if node.role is NodeRole.LIST_ITEM:
        kind = {"bulleted": "Bulleted", "numbered": "Numbered"}.get(node.list_kind or "", "List")
        return f"{kind} list item, level {node.list_level or 1}"
    return "Paragraph"


def _structure_change(builder: _Builder, old: DocxDocument, new: DocxDocument, pair: BlockPair) -> None:
    """The same words, now a different kind of block."""
    old_node, new_node = pair.old, pair.new
    if old_node is None or new_node is None:
        return
    before, after = describe_block(old_node), describe_block(new_node)
    if before == after:
        return
    builder.add(
        kind=ChangeKind.MODIFIED,
        category=ChangeCategory.LAYOUT,
        subtype="heading_level" if old_node.role is NodeRole.HEADING else "block_type",
        label=new_node.text[:200],
        old_value=before,
        new_value=after,
        evidence=(_node_evidence(old, old_node, Side.OLD), _node_evidence(new, new_node, Side.NEW)),
    )


# ---------------------------------------------------------------- headings


def _whole_heading_changes(
    builder: _Builder, pairs: list[BlockPair], old: DocxDocument, new: DocxDocument
) -> list[BlockPair]:
    """Report a heading reworded in several places as one change; return the rest.

    A heading is a short label. "Fees and Payment" becoming "Fees, Payment and
    Invoicing" read as two word-level fragments is harder to follow than the
    heading before and after, so when a heading differs in more than one place
    it is reported whole. A heading changed in one place ("Payment Terms" to
    "Payment and Refund Terms") keeps the word-level change, like a paragraph.
    """
    rest: list[BlockPair] = []
    for pair in pairs:
        if (
            pair.kind is PairKind.MODIFIED
            and pair.old is not None
            and pair.new is not None
            and len(word_segments(pair.old, pair.new)) > 1
        ):
            builder.add(
                kind=ChangeKind.MODIFIED,
                category=ChangeCategory.TEXT,
                subtype="heading",
                label=_label_for(pair.new),
                old_value=pair.old.text,
                new_value=pair.new.text,
                confidence=round(pair.similarity, 3),
                evidence=(_node_evidence(old, pair.old, Side.OLD), _node_evidence(new, pair.new, Side.NEW)),
            )
        else:
            rest.append(pair)
    return rest


# ---------------------------------------------------------------- document order


def _in_document_order(changes, old: DocxDocument, new: DocxDocument):
    """Changes sorted by where they are, so a reader meets them in reading order.

    Document properties come first. Anything in the revised document is placed
    by its position there; something only in the original (a removed paragraph)
    by its position in the original. Ties keep the order they were found in.
    """

    def placed(document: DocxDocument) -> dict[str, float]:
        # Links are stored after the body; each is placed at its own paragraph.
        by_path = {node.path: index for index, node in enumerate(document.nodes)}
        positions: dict[str, float] = {}
        for index, node in enumerate(document.nodes):
            container = node.path.rsplit("/hyperlink[", 1)[0] if node.role is NodeRole.LINK else None
            positions[node.id] = by_path[container] + 0.5 if container in by_path else index
        return positions

    positions = {"old": placed(old), "new": placed(new)}

    def key(item):
        index, change = item
        if all(evidence.scope == "document" for evidence in change.evidence):
            return (0, 0, index)
        for side in ("new", "old"):
            cited = [
                positions[side][evidence.node_id]
                for evidence in change.evidence
                if evidence.side.value == side and evidence.node_id in positions[side]
            ]
            if cited:
                return (1, min(cited), index)
        return (2, 0, index)

    ordered = [change for _index, change in sorted(enumerate(changes), key=key)]
    return tuple(
        change.model_copy(update={"id": f"c{seq}", "seq": seq, "noise_reason": None})
        for seq, change in enumerate(ordered)
    )


# ---------------------------------------------------------------- links


def _compare_links(builder: _Builder, old: DocxDocument, new: DocxDocument) -> None:
    old_links = [node for node in old.nodes if node.role is NodeRole.LINK]
    new_links = [node for node in new.nodes if node.role is NodeRole.LINK]
    for pair in align_blocks(old_links, new_links):
        if pair.kind is PairKind.ADDED and pair.new is not None:
            builder.add(
                kind=ChangeKind.ADDED,
                category=ChangeCategory.LINK,
                label=pair.new.text[:200],
                new_value=pair.new.href,
                evidence=(_node_evidence(new, pair.new, Side.NEW),),
            )
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            builder.add(
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.LINK,
                label=pair.old.text[:200],
                old_value=pair.old.href,
                evidence=(_node_evidence(old, pair.old, Side.OLD),),
            )
        elif pair.old is not None and pair.new is not None and pair.old.href != pair.new.href:
            builder.add(
                kind=ChangeKind.MODIFIED,
                category=ChangeCategory.LINK,
                label=pair.new.text[:200],
                old_value=pair.old.href,
                new_value=pair.new.href,
                evidence=(_node_evidence(old, pair.old, Side.OLD), _node_evidence(new, pair.new, Side.NEW)),
            )


# ---------------------------------------------------------------- tables


@dataclass(frozen=True)
class _Block:
    """A table or a row, as something the block aligner can pair."""

    index: int
    cells: tuple[DocxNode, ...]
    text: str

    @property
    def tokens(self):  # the aligner only needs `text`; kept for the block protocol
        return tuple(token for cell in self.cells for token in cell.tokens)


def _tables(document: DocxDocument) -> list[_Block]:
    grouped: dict[int, list[DocxNode]] = {}
    for node in document.nodes:
        if node.role is NodeRole.TABLE_CELL and node.table is not None:
            grouped.setdefault(node.table.table_index, []).append(node)
    return [
        _Block(index, tuple(cells), " ".join(cell.text for cell in cells))
        for index, cells in sorted(grouped.items())
    ]


def _rows(table: _Block) -> list[_Block]:
    grouped: dict[int, list[DocxNode]] = {}
    for cell in table.cells:
        assert cell.table is not None
        grouped.setdefault(cell.table.row_index, []).append(cell)
    rows = []
    for index, cells in sorted(grouped.items()):
        ordered = tuple(sorted(cells, key=lambda cell: cell.table.column_index))  # type: ignore[union-attr]
        rows.append(_Block(index, ordered, " · ".join(cell.text for cell in ordered)))
    return rows


def _column(cell: DocxNode) -> int:
    assert cell.table is not None
    return cell.table.column_index


def _column_map(old_rows: list[_Block], new_rows: list[_Block]) -> dict[int, int]:
    """Which old column is which new column, matched by the header row's words.

    Columns whose headers are unchanged match; a run of changed headers of the
    same length is a rename and matches in order; anything left over is a
    column that was added or removed.
    """
    old_columns = sorted({_column(cell) for row in old_rows for cell in row.cells})
    new_columns = sorted({_column(cell) for row in new_rows for cell in row.cells})
    old_header = {_column(cell): cell.text for cell in old_rows[0].cells} if old_rows else {}
    new_header = {_column(cell): cell.text for cell in new_rows[0].cells} if new_rows else {}
    old_keys = [normalize_key(old_header.get(column, "")) for column in old_columns]
    new_keys = [normalize_key(new_header.get(column, "")) for column in new_columns]

    mapping: dict[int, int] = {}
    matcher = SequenceMatcher(a=old_keys, b=new_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("equal", "replace"):
            for offset in range(min(i2 - i1, j2 - j1)):
                mapping[old_columns[i1 + offset]] = new_columns[j1 + offset]
    return mapping


def _row_change(
    builder: _Builder, kind: ChangeKind, row: _Block, document: DocxDocument, side: Side, other=None
) -> None:
    value = row.text
    fields = {"old_value": value} if side is Side.OLD else {"new_value": value}
    evidence = tuple(_node_evidence(document, cell, side) for cell in row.cells[:EVIDENCE_CELLS])
    if other is not None:
        other_document, other_row = other
        fields = {"old_value": row.text, "new_value": other_row.text}
        evidence += tuple(
            _node_evidence(other_document, cell, Side.NEW) for cell in other_row.cells[:EVIDENCE_CELLS]
        )
    builder.add(
        kind=kind,
        category=ChangeCategory.TABLE,
        subtype="row",
        label=row.cells[0].text[:200] if row.cells else None,
        evidence=evidence,
        **fields,
    )


def _cell_change(
    builder: _Builder, kind: ChangeKind, cell: DocxNode, document: DocxDocument, side: Side
) -> None:
    fields = {"old_value": cell.text} if side is Side.OLD else {"new_value": cell.text}
    builder.add(
        kind=kind,
        category=ChangeCategory.TABLE,
        subtype="table_cell",
        label=_cell_label(cell),
        evidence=(_node_evidence(document, cell, side),),
        **fields,
    )


def _compare_cells(
    builder: _Builder,
    old_row: _Block,
    new_row: _Block,
    mapping: dict[int, int],
    old: DocxDocument,
    new: DocxDocument,
) -> None:
    new_by_column = {_column(cell): cell for cell in new_row.cells}
    matched_new: set[int] = set()

    for old_cell in old_row.cells:
        target = mapping.get(_column(old_cell))
        new_cell = new_by_column.get(target) if target is not None else None
        if new_cell is None:
            _cell_change(builder, ChangeKind.REMOVED, old_cell, old, Side.OLD)
            continue
        matched_new.add(_column(new_cell))
        # The same matching rule as paragraphs, so an option applies everywhere.
        if normalize_key(old_cell.text) == normalize_key(new_cell.text):
            continue
        typed = _typed_values(old_cell.text, new_cell.text)
        builder.add(
            kind=ChangeKind.MODIFIED,
            category=typed[0] if typed else ChangeCategory.TABLE,
            subtype="table_cell",
            label=_cell_label(new_cell),
            old_value=normalize(old_cell.text),
            new_value=normalize(new_cell.text),
            delta=typed[1] if typed else None,
            evidence=(_node_evidence(old, old_cell, Side.OLD), _node_evidence(new, new_cell, Side.NEW)),
        )

    for new_cell in new_row.cells:
        if _column(new_cell) not in matched_new:
            _cell_change(builder, ChangeKind.ADDED, new_cell, new, Side.NEW)


def _table_change(
    builder: _Builder, kind: ChangeKind, table: _Block, document: DocxDocument, side: Side
) -> None:
    fields = {"old_value": _excerpt(table.text)} if side is Side.OLD else {"new_value": _excerpt(table.text)}
    builder.add(
        kind=kind,
        category=ChangeCategory.TABLE,
        subtype="table",
        label=f"Table {table.index + 1}",
        evidence=tuple(_node_evidence(document, cell, side) for cell in table.cells[:EVIDENCE_CELLS]),
        **fields,
    )


def _compare_table(
    builder: _Builder, old_table: _Block, new_table: _Block, old: DocxDocument, new: DocxDocument
):
    old_rows, new_rows = _rows(old_table), _rows(new_table)
    mapping = _column_map(old_rows, new_rows)

    # The header rows are each other's, whatever their words: a renamed header
    # is a changed cell, not a replaced row.
    row_pairs: list[BlockPair] = []
    if len(old_rows) > 1 and len(new_rows) > 1:
        row_pairs.append(BlockPair(PairKind.MODIFIED, old_rows[0], new_rows[0]))
        row_pairs.extend(align_blocks(old_rows[1:], new_rows[1:]))
    else:
        row_pairs.extend(align_blocks(old_rows, new_rows))

    for pair in row_pairs:
        if pair.kind is PairKind.ADDED and pair.new is not None:
            _row_change(builder, ChangeKind.ADDED, pair.new, new, Side.NEW)
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            _row_change(builder, ChangeKind.REMOVED, pair.old, old, Side.OLD)
        elif pair.old is not None and pair.new is not None:
            if pair.kind is PairKind.MOVED:
                _row_change(builder, ChangeKind.MOVED, pair.old, old, Side.OLD, other=(new, pair.new))
            _compare_cells(builder, pair.old, pair.new, mapping, old, new)


def _pair_tables(old_tables: list[_Block], new_tables: list[_Block]) -> list[BlockPair]:
    """Tables paired by how many cells they share, best match first.

    Position alone would make an inserted table look like every later table
    rewritten; text similarity alone misses a small table with one cell
    changed. Sharing cells catches both: two versions of the same table share
    most of their cells.
    """

    def overlap(left: _Block, right: _Block) -> float:
        a = [normalize_key(cell.text) for cell in left.cells]
        b = [normalize_key(cell.text) for cell in right.cells]
        common = sum(min(a.count(text), b.count(text)) for text in set(a))
        return common / max(len(a) + len(b) - common, 1)

    candidates = sorted(
        (
            (-overlap(old_table, new_table), abs(i - j), i, j)
            for i, old_table in enumerate(old_tables)
            for j, new_table in enumerate(new_tables)
        ),
    )
    used_old: set[int] = set()
    used_new: set[int] = set()
    pairs: list[BlockPair] = []
    for negative, _distance, i, j in candidates:
        if -negative < 0.3 or i in used_old or j in used_new:
            continue
        used_old.add(i)
        used_new.add(j)
        identical = old_tables[i].text == new_tables[j].text
        pairs.append(
            BlockPair(PairKind.EQUAL if identical else PairKind.MODIFIED, old_tables[i], new_tables[j])
        )

    pairs.sort(key=lambda pair: (pair.new.index, pair.old.index))  # type: ignore[union-attr]
    pairs.extend(
        BlockPair(PairKind.REMOVED, table, None) for i, table in enumerate(old_tables) if i not in used_old
    )
    pairs.extend(
        BlockPair(PairKind.ADDED, None, table) for j, table in enumerate(new_tables) if j not in used_new
    )
    return pairs


def _moved(pairs: list[BlockPair]) -> set[int]:
    """Old indexes of paired tables whose order changed relative to the others.

    The tables that keep their relative order are the longest run that is
    increasing in both documents; every other paired table moved.
    """
    matched = sorted(
        (pair.old.index, pair.new.index) for pair in pairs if pair.old is not None and pair.new is not None
    )
    best: list[list[tuple[int, int]]] = []
    for item in matched:
        chains = [chain for chain in best if chain[-1][1] < item[1]]
        longest = max(chains, key=len) if chains else []
        best.append([*longest, item])
    keep = set(max(best, key=len)) if best else set()
    return {old_index for old_index, new_index in matched if (old_index, new_index) not in keep}


def _compare_tables(builder: _Builder, old: DocxDocument, new: DocxDocument) -> None:
    pairs = _pair_tables(_tables(old), _tables(new))
    moved = _moved(pairs)
    for pair in pairs:
        if pair.old is not None and pair.new is not None and pair.old.index in moved:
            builder.add(
                kind=ChangeKind.MOVED,
                category=ChangeCategory.TABLE,
                subtype="table",
                label=f"Table {pair.new.index + 1}",
                old_value=_excerpt(pair.old.text),
                new_value=_excerpt(pair.new.text),
                evidence=(
                    _node_evidence(old, pair.old.cells[0], Side.OLD),
                    _node_evidence(new, pair.new.cells[0], Side.NEW),
                ),
            )
        if pair.kind is PairKind.ADDED and pair.new is not None:
            _table_change(builder, ChangeKind.ADDED, pair.new, new, Side.NEW)
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            _table_change(builder, ChangeKind.REMOVED, pair.old, old, Side.OLD)
        elif pair.kind is PairKind.MODIFIED and pair.old is not None and pair.new is not None:
            _compare_table(builder, pair.old, pair.new, old, new)


# ---------------------------------------------------------------- entry point


def compare_docx(
    old: DocxDocument, new: DocxDocument, options: MatchOptions | None = None
) -> DocxComparisonOutcome:
    """Compare two Word documents. Deterministic: same two documents and options, same result.

    `options` says what counts as the same words — whether capitalisation and
    punctuation-only differences are ignored. It changes which differences are
    reported, never what the evidence quotes.
    """
    options = options or MatchOptions()
    with matching(options):
        outcome = _compare(old, new)
    outcome.options = options
    return outcome


def _comparable(node: DocxNode) -> bool:
    """Whether a block has anything left to compare under the current options."""
    return bool(normalize_key(node.text))


def _compare(old: DocxDocument, new: DocxDocument) -> DocxComparisonOutcome:
    diagnostics = DocxDiagnostics(
        previous_warnings=old.extraction.warnings,
        revised_warnings=new.extraction.warnings,
    )
    builder = _Builder()
    _compare_properties(builder, old, new)

    old_headings = [node for node in old.nodes if node.role is NodeRole.HEADING and _comparable(node)]
    new_headings = [node for node in new.nodes if node.role is NodeRole.HEADING and _comparable(node)]
    heading_pairs = _pair_renamed_headings(align_blocks(old_headings, new_headings), old, new)  # type: ignore[arg-type]
    word_level = _whole_heading_changes(builder, heading_pairs, old, new)
    _emit_block_changes(builder, word_level, old, new, _subtype_for_heading)  # type: ignore[arg-type]
    for pair in heading_pairs:
        if pair.kind in (PairKind.EQUAL, PairKind.MODIFIED):
            _structure_change(builder, old, new, pair)

    old_prose = [node for node in old.nodes if node.role in PROSE_ROLES and _comparable(node)]
    new_prose = [node for node in new.nodes if node.role in PROSE_ROLES and _comparable(node)]
    prose_pairs = align_blocks(old_prose, new_prose)
    _emit_block_changes(builder, prose_pairs, old, new, _subtype_for_prose)  # type: ignore[arg-type]
    for pair in prose_pairs:
        if pair.kind in (PairKind.EQUAL, PairKind.MODIFIED):
            _structure_change(builder, old, new, pair)

    _compare_links(builder, old, new)
    _compare_tables(builder, old, new)

    # A moved paragraph is part of what the author changed; in a document there
    # is nothing to set aside as noise, so every change is kept.
    changes = _in_document_order(builder.finish(), old, new)
    result = ComparisonResult(
        engine_version=ENGINE_VERSION,
        old_document=DocxRef(sha256=old.content_sha256, node_count=old.node_count),
        new_document=DocxRef(sha256=new.content_sha256, node_count=new.node_count),
        changes=changes,
    )

    issues = verify_docx_traceability(result.changes, old, new)
    if issues:
        bad = {issue.change_id for issue in issues}
        kept = [change for change in result.changes if change.id not in bad]
        renumbered = [
            change.model_copy(update={"id": f"c{index}", "seq": index}) for index, change in enumerate(kept)
        ]
        data = result.model_dump()
        data["changes"] = [change.model_dump() for change in renumbered]
        diagnostics.dropped_untraceable = len(result.changes) - len(kept)
        diagnostics.notes.append(
            f"{diagnostics.dropped_untraceable} change(s) were discarded because their evidence could "
            "not be traced back to the documents."
        )
        result = ComparisonResult.model_validate(data)

    return DocxComparisonOutcome(result=result, diagnostics=diagnostics, previous=old, current=new)


__all__ = ["DocxComparisonOutcome", "DocxDiagnostics", "compare_docx", "describe_block"]
