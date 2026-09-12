"""Comparing two snapshots of the same webpage.

The shape follows Tool 1 deliberately, and most of the hard parts are literally
the same code: paragraph alignment, move detection and word-level diffing come
from `compare/text_align.py`, and typed values — numbers, currency,
percentages, dates and their differences — come from `compare/values.py`. Only
the parts that genuinely differ are written here, because a webpage is
structured differently from a page of a PDF, not because comparison is
different.

Layers, in order:

1. **Identity** — the address, title, description and canonical link.
2. **Structure** — headings added, removed, renamed or moved.
3. **Text** — paragraphs, list items, quotes and preformatted blocks.
4. **Values** — typed changes found inside changed text.
5. **Links** — where an in-content link points, after tracking parameters have
   been removed, so a campaign tag is not a change.
6. **Tables** — rows matched by their first cell, columns by their header, and
   individual cells compared, so one changed price is one change and not a
   rewritten table.

Every change is checked against both snapshots before the result is returned.
Anything whose evidence cannot be proven is dropped and counted, never shown.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.compare.normalize import normalize, normalize_key
from diffnexa_engine.compare.text_align import (
    BlockPair,
    PairKind,
    Segment,
    align_blocks,
    word_segments,
)
from diffnexa_engine.compare.values import TypedValue, ValueKind, compare_values, parse_date, parse_value
from diffnexa_engine.contracts.changes import (
    Change,
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    Evidence,
    Side,
    SnapshotRef,
)
from diffnexa_engine.contracts.web_traceability import verify_web_traceability
from diffnexa_engine.web.snapshot import ContentNode, NodeRole, RenderNote, Snapshot
from diffnexa_engine.web.volatility import mark_volatile

EXCERPT_CHARS = 240
MAX_EVIDENCE_TOKENS = 60
MIN_WORDS_FOR_MOVE = 5

PROSE_ROLES = frozenset({NodeRole.PARAGRAPH, NodeRole.LIST_ITEM, NodeRole.QUOTE, NodeRole.PREFORMATTED})

METADATA_FIELDS = (
    ("metadata.title", "title", "Page title"),
    ("metadata.description", "meta_description", "Meta description"),
    ("metadata.canonical", "canonical_url", "Canonical link"),
)

_VALUE_CATEGORIES = {
    ValueKind.NUMBER: ChangeCategory.NUMBER,
    ValueKind.MONEY: ChangeCategory.NUMBER,
    ValueKind.PERCENT: ChangeCategory.NUMBER,
    ValueKind.YEAR: ChangeCategory.NUMBER,
    ValueKind.DATE: ChangeCategory.DATE,
    ValueKind.IDENTIFIER: ChangeCategory.IDENTIFIER,
}


@dataclass
class WebDiagnostics:
    """What the comparison could not do, reported alongside what it could."""

    dropped_untraceable: int = 0
    previous_warnings: tuple[str, ...] = ()
    revised_warnings: tuple[str, ...] = ()
    previous_render_note: RenderNote | None = None
    revised_render_note: RenderNote | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def needs_javascript(self) -> bool:
        return RenderNote.NEEDS_JAVASCRIPT in (self.previous_render_note, self.revised_render_note)


@dataclass
class WebComparisonOutcome:
    result: ComparisonResult
    diagnostics: WebDiagnostics


# ---------------------------------------------------------------- evidence


def _excerpt(text: str) -> str:
    """A quotation short enough to show and complete enough to verify.

    Cut at a word boundary with nothing appended, so the excerpt remains a true
    opening fragment of what it cites. Tool 1 learned this the hard way: an
    ellipsis makes the excerpt absent from the cited text, and the traceability
    check then discards a perfectly good change.
    """
    cleaned = normalize(text)
    if len(cleaned) <= EXCERPT_CHARS:
        return cleaned
    cut = cleaned[:EXCERPT_CHARS]
    boundary = cut.rfind(" ")
    return (cut[:boundary] if boundary > 0 else cut).rstrip()


def _node_evidence(
    snapshot: Snapshot, node: ContentNode, side: Side, token_ids: tuple[str, ...] | None = None
) -> Evidence:
    """Evidence pointing at a node, quoting exactly the words it cites."""
    tokens = (
        [token for token in node.tokens if token.id in set(token_ids)]
        if token_ids
        else list(node.tokens[:MAX_EVIDENCE_TOKENS])
    )
    if not tokens:
        tokens = list(node.tokens[:MAX_EVIDENCE_TOKENS])

    # Keep the quotation inside the excerpt limit, and cite only what it quotes.
    quoted: list[str] = []
    cited: list[str] = []
    length = 0
    for token in tokens:
        addition = len(token.text) + (1 if quoted else 0)
        if quoted and length + addition > EXCERPT_CHARS:
            break
        quoted.append(token.text)
        cited.append(token.id)
        length += addition

    return Evidence(
        side=side,
        scope="node",
        snapshot_sha256=snapshot.content_sha256,
        node_id=node.id,
        node_path=node.path,
        section_path=node.section_path,
        token_ids=tuple(cited),
        excerpt=normalize(" ".join(quoted)) or None,
    )


def _metadata_evidence(snapshot: Snapshot, side: Side, field_name: str, value: str) -> Evidence:
    """Evidence for something that belongs to the page as a whole.

    A title is not inside any node, so it uses document scope. The snapshot
    fingerprint is what makes it provable: the checker reads the value back out
    of that snapshot and compares.
    """
    return Evidence(
        side=side,
        scope="document",
        field=field_name,
        snapshot_sha256=snapshot.content_sha256,
        excerpt=_excerpt(value),
    )


# ---------------------------------------------------------------- change building


class _Builder:
    """Collects changes, and remembers the text each one sits inside.

    The surrounding text is not part of the change — the values and evidence are
    — but it is what lets the volatility rules tell a ticking clock from a price.
    """

    def __init__(self) -> None:
        self._changes: list[Change] = []
        self.contexts: dict[str, tuple[str, str]] = {}

    def add(self, context: tuple[str, str] | None = None, **fields: object) -> None:
        seq = len(self._changes)
        change = Change(id=f"c{seq}", seq=seq, **fields)  # type: ignore[arg-type]
        self._changes.append(change)
        if context:
            self.contexts[change.id] = context

    def finish(self) -> tuple[Change, ...]:
        return tuple(self._changes)


# ---------------------------------------------------------------- layer 1: identity


def _compare_metadata(builder: _Builder, old: Snapshot, new: Snapshot) -> None:
    if normalize(old.source.final_url) != normalize(new.source.final_url):
        builder.add(
            kind=ChangeKind.MODIFIED,
            category=ChangeCategory.METADATA,
            subtype="address",
            label="Page address",
            old_value=old.source.final_url,
            new_value=new.source.final_url,
            evidence=(
                _metadata_evidence(old, Side.OLD, "source.final_url", old.source.final_url),
                _metadata_evidence(new, Side.NEW, "source.final_url", new.source.final_url),
            ),
        )

    for field_name, attribute, label in METADATA_FIELDS:
        before = getattr(old.metadata, attribute)
        after = getattr(new.metadata, attribute)
        if normalize(before or "") == normalize(after or ""):
            continue

        evidence = []
        if before:
            evidence.append(_metadata_evidence(old, Side.OLD, field_name, before))
        if after:
            evidence.append(_metadata_evidence(new, Side.NEW, field_name, after))
        if not evidence:
            continue

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


# ---------------------------------------------------------------- layers 2-3: text


def _emit_block_changes(
    builder: _Builder,
    pairs: list[BlockPair[ContentNode]],
    old: Snapshot,
    new: Snapshot,
    subtype_of,
) -> None:
    for pair in pairs:
        if pair.kind is PairKind.EQUAL:
            continue

        if pair.kind is PairKind.ADDED and pair.new is not None:
            builder.add(
                kind=ChangeKind.ADDED,
                category=ChangeCategory.TEXT,
                subtype=subtype_of(pair.new),
                label=_label_for(pair.new),
                new_value=_excerpt(pair.new.text),
                context=(pair.new.text, pair.new.text),
                evidence=(_node_evidence(new, pair.new, Side.NEW),),
            )
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            builder.add(
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.TEXT,
                subtype=subtype_of(pair.old),
                label=_label_for(pair.old),
                old_value=_excerpt(pair.old.text),
                context=(pair.old.text, pair.old.text),
                evidence=(_node_evidence(old, pair.old, Side.OLD),),
            )
        elif pair.kind is PairKind.MOVED and pair.old and pair.new:
            moved_sections = pair.old.section_path != pair.new.section_path
            builder.add(
                kind=ChangeKind.MOVED,
                category=ChangeCategory.TEXT,
                subtype=subtype_of(pair.new),
                label=_label_for(pair.new),
                old_value=_excerpt(pair.old.text),
                new_value=_excerpt(pair.new.text),
                noise_reason=(
                    None
                    if moved_sections
                    else "Identical content that moved position; its wording did not change."
                ),
                evidence=(
                    _node_evidence(old, pair.old, Side.OLD),
                    _node_evidence(new, pair.new, Side.NEW),
                ),
            )
        elif pair.kind is PairKind.MODIFIED and pair.old and pair.new:
            _emit_modified(builder, pair, old, new, subtype_of)


def _emit_modified(
    builder: _Builder,
    pair: BlockPair[ContentNode],
    old: Snapshot,
    new: Snapshot,
    subtype_of,
) -> None:
    assert pair.old is not None and pair.new is not None
    segments = word_segments(pair.old, pair.new)
    if not segments:
        return

    confidence = round(pair.similarity, 3)
    consumed_old, consumed_new = _emit_dates(builder, pair, segments, old, new, confidence, subtype_of)

    for segment in segments:
        old_ids = set(segment.old_word_ids)
        new_ids = set(segment.new_word_ids)
        if old_ids <= consumed_old and new_ids <= consumed_new and (old_ids or new_ids):
            continue

        typed = _typed_segment(segment)
        if typed is not None:
            category, old_value, new_value, delta = typed
        else:
            category = ChangeCategory.TEXT
            old_value = segment.old_text or None
            new_value = segment.new_text or None
            delta = None

        kind = (
            ChangeKind.MODIFIED
            if segment.old_word_ids and segment.new_word_ids
            else ChangeKind.ADDED
            if segment.new_word_ids
            else ChangeKind.REMOVED
        )
        if kind is ChangeKind.MODIFIED and (old_value is None or new_value is None):
            old_value = old_value or _excerpt(pair.old.text)
            new_value = new_value or _excerpt(pair.new.text)

        evidence = []
        if segment.old_word_ids:
            evidence.append(_node_evidence(old, pair.old, Side.OLD, segment.old_word_ids))
        if segment.new_word_ids:
            evidence.append(_node_evidence(new, pair.new, Side.NEW, segment.new_word_ids))
        # A modification must be provable on both sides; an insertion inside a
        # paragraph still has a counterpart paragraph to cite.
        if kind is ChangeKind.MODIFIED:
            if not any(item.side is Side.OLD for item in evidence):
                evidence.append(_node_evidence(old, pair.old, Side.OLD))
            if not any(item.side is Side.NEW for item in evidence):
                evidence.append(_node_evidence(new, pair.new, Side.NEW))
        if not evidence:
            continue

        builder.add(
            kind=kind,
            category=category,
            subtype=subtype_of(pair.new),
            label=_label_for(pair.new),
            old_value=old_value,
            new_value=new_value,
            delta=delta,
            confidence=confidence,
            context=(pair.old.text, pair.new.text),
            evidence=tuple(evidence),
        )


def _emit_dates(
    builder: _Builder,
    pair: BlockPair[ContentNode],
    segments: list[Segment],
    old: Snapshot,
    new: Snapshot,
    confidence: float,
    subtype_of,
) -> tuple[set[str], set[str]]:
    """Report whole dates before word-level segments split them apart.

    "30 June 2026" becoming "15 July 2026" differs in two places with the year
    unchanged, so a word diff alone would report two unrelated changes.
    """
    assert pair.old is not None and pair.new is not None
    consumed_old: set[str] = set()
    consumed_new: set[str] = set()

    for segment in segments:
        if not (segment.old_word_ids and segment.new_word_ids):
            continue
        if set(segment.old_word_ids) <= consumed_old and set(segment.new_word_ids) <= consumed_new:
            continue

        old_span = _date_span(pair.old, segment.old_word_ids)
        new_span = _date_span(pair.new, segment.new_word_ids)
        if old_span is None or new_span is None:
            continue
        old_value, old_ids = old_span
        new_value, new_ids = new_span
        if old_value.ambiguous or new_value.ambiguous or old_value.as_date == new_value.as_date:
            continue

        delta = compare_values(old_value, new_value)
        builder.add(
            kind=ChangeKind.MODIFIED,
            category=ChangeCategory.DATE,
            subtype=subtype_of(pair.new),
            label=_label_for(pair.new),
            old_value=old_value.text,
            new_value=new_value.text,
            delta=delta.summary if delta else None,
            confidence=confidence,
            context=(pair.old.text, pair.new.text),
            evidence=(
                _node_evidence(old, pair.old, Side.OLD, old_ids),
                _node_evidence(new, pair.new, Side.NEW, new_ids),
            ),
        )
        consumed_old.update(old_ids)
        consumed_new.update(new_ids)

    return consumed_old, consumed_new


def _date_span(node: ContentNode, changed_ids: tuple[str, ...]) -> tuple[TypedValue, tuple[str, ...]] | None:
    """The longest complete date in this node that includes a changed word."""
    tokens = list(node.tokens)
    changed = set(changed_ids)
    best: tuple[TypedValue, tuple[str, ...]] | None = None

    for start in range(len(tokens)):
        for end in range(start + 1, min(start + 7, len(tokens)) + 1):
            run = tokens[start:end]
            if not changed & {token.id for token in run}:
                continue
            parsed = parse_date(" ".join(token.text for token in run))
            if parsed is None:
                continue
            if best is None or len(parsed.text) > len(best[0].text):
                best = (parsed, tuple(token.id for token in run))
    return best


def _typed_segment(segment: Segment) -> tuple[ChangeCategory, str, str, str | None] | None:
    if not (segment.old_word_ids and segment.new_word_ids):
        return None
    old_value = parse_value(segment.old_text)
    new_value = parse_value(segment.new_text)
    if old_value is None or new_value is None:
        return None
    old_category = _VALUE_CATEGORIES.get(old_value.kind)
    new_category = _VALUE_CATEGORIES.get(new_value.kind)
    if old_category is None or old_category is not new_category:
        return None
    if old_category is ChangeCategory.DATE and (old_value.ambiguous or new_value.ambiguous):
        return None
    delta = compare_values(old_value, new_value)
    return old_category, old_value.text, new_value.text, delta.summary if delta else None


def _label_for(node: ContentNode) -> str | None:
    """Where this sits, in the page's own words: its nearest heading."""
    if node.section_path:
        return node.section_path[-1]
    return None


# ---------------------------------------------------------------- layer 5: links


def _compare_links(builder: _Builder, old: Snapshot, new: Snapshot) -> None:
    old_links = [node for node in old.nodes if node.role is NodeRole.LINK]
    new_links = [node for node in new.nodes if node.role is NodeRole.LINK]

    for pair in align_blocks(old_links, new_links):
        if pair.kind is PairKind.ADDED and pair.new is not None:
            builder.add(
                kind=ChangeKind.ADDED,
                category=ChangeCategory.LINK,
                label=_label_for(pair.new),
                new_value=pair.new.href,
                evidence=(_node_evidence(new, pair.new, Side.NEW),),
            )
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            builder.add(
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.LINK,
                label=_label_for(pair.old),
                old_value=pair.old.href,
                evidence=(_node_evidence(old, pair.old, Side.OLD),),
            )
        elif pair.old is not None and pair.new is not None:
            # Tracking parameters were already removed when the page was read,
            # so two links differing only by a campaign tag are equal here.
            if (pair.old.href or "") == (pair.new.href or ""):
                continue
            builder.add(
                kind=ChangeKind.MODIFIED,
                category=ChangeCategory.LINK,
                label=_label_for(pair.new) or normalize(pair.new.text),
                old_value=pair.old.href,
                new_value=pair.new.href,
                context=(pair.old.href or "", pair.new.href or ""),
                evidence=(
                    _node_evidence(old, pair.old, Side.OLD),
                    _node_evidence(new, pair.new, Side.NEW),
                ),
            )


# ---------------------------------------------------------------- layer 6: tables


def _tables_of(snapshot: Snapshot) -> dict[int, list[ContentNode]]:
    tables: dict[int, list[ContentNode]] = {}
    for node in snapshot.nodes:
        if node.role is NodeRole.TABLE_CELL and node.table is not None:
            tables.setdefault(node.table.table_index, []).append(node)
    return tables


def _rows_of(cells: list[ContentNode]) -> dict[int, list[ContentNode]]:
    rows: dict[int, list[ContentNode]] = {}
    for cell in cells:
        assert cell.table is not None
        rows.setdefault(cell.table.row_index, []).append(cell)
    for row in rows.values():
        row.sort(key=lambda cell: cell.table.column_index)  # type: ignore[union-attr]
    return rows


def _row_key(row: list[ContentNode]) -> str:
    """A row is identified by its first cell, which is how a reader names it."""
    return normalize_key(row[0].text) if row else ""


def _column_key(cell: ContentNode) -> str:
    assert cell.table is not None
    header = cell.table.column_header
    return normalize_key(header) if header else f"#{cell.table.column_index}"


def _compare_tables(builder: _Builder, old: Snapshot, new: Snapshot) -> None:
    old_tables = _tables_of(old)
    new_tables = _tables_of(new)

    for index in sorted(set(old_tables) | set(new_tables)):
        old_rows = _rows_of(old_tables.get(index, []))
        new_rows = _rows_of(new_tables.get(index, []))

        old_by_key = {_row_key(row): row for row in old_rows.values() if _row_key(row)}
        new_by_key = {_row_key(row): row for row in new_rows.values() if _row_key(row)}

        # Rows are matched by their first cell where that names them uniquely,
        # and by position otherwise, so a reordered table is not a rewritten one.
        usable_keys = len(old_by_key) == len(old_rows) and len(new_by_key) == len(new_rows)

        if usable_keys:
            matched = [(old_by_key[key], new_by_key[key]) for key in old_by_key if key in new_by_key]
            removed = [row for key, row in old_by_key.items() if key not in new_by_key]
            added = [row for key, row in new_by_key.items() if key not in old_by_key]
        else:
            shared = sorted(set(old_rows) & set(new_rows))
            matched = [(old_rows[position], new_rows[position]) for position in shared]
            removed = [row for position, row in sorted(old_rows.items()) if position not in new_rows]
            added = [row for position, row in sorted(new_rows.items()) if position not in old_rows]

        for row in removed:
            builder.add(
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.TABLE,
                subtype="row",
                label=normalize(row[0].text) if row else None,
                old_value=" · ".join(normalize(cell.text) for cell in row),
                evidence=tuple(_node_evidence(old, cell, Side.OLD) for cell in row[:3]),
            )
        for row in added:
            builder.add(
                kind=ChangeKind.ADDED,
                category=ChangeCategory.TABLE,
                subtype="row",
                label=normalize(row[0].text) if row else None,
                new_value=" · ".join(normalize(cell.text) for cell in row),
                evidence=tuple(_node_evidence(new, cell, Side.NEW) for cell in row[:3]),
            )

        for old_row, new_row in matched:
            _compare_row(builder, old_row, new_row, old, new)


def _compare_row(
    builder: _Builder,
    old_row: list[ContentNode],
    new_row: list[ContentNode],
    old: Snapshot,
    new: Snapshot,
) -> None:
    """Compare cells within one row, matched by column header where there is one."""
    old_cells = {_column_key(cell): cell for cell in old_row}
    new_cells = {_column_key(cell): cell for cell in new_row}

    for key in sorted(set(old_cells) & set(new_cells)):
        old_cell, new_cell = old_cells[key], new_cells[key]
        if normalize(old_cell.text) == normalize(new_cell.text):
            continue

        typed = _typed_values(old_cell.text, new_cell.text)
        category = typed[0] if typed else ChangeCategory.TABLE
        delta = typed[1] if typed else None
        label = _cell_label(new_cell)

        builder.add(
            kind=ChangeKind.MODIFIED,
            category=category,
            subtype="table_cell",
            label=label,
            old_value=normalize(old_cell.text),
            new_value=normalize(new_cell.text),
            delta=delta,
            context=(old_cell.text, new_cell.text),
            evidence=(
                _node_evidence(old, old_cell, Side.OLD),
                _node_evidence(new, new_cell, Side.NEW),
            ),
        )


def _typed_values(old_text: str, new_text: str) -> tuple[ChangeCategory, str | None] | None:
    old_value = parse_value(old_text)
    new_value = parse_value(new_text)
    if old_value is None or new_value is None:
        return None
    old_category = _VALUE_CATEGORIES.get(old_value.kind)
    if old_category is None or old_category is not _VALUE_CATEGORIES.get(new_value.kind):
        return None
    if old_category is ChangeCategory.DATE and (old_value.ambiguous or new_value.ambiguous):
        return None
    delta = compare_values(old_value, new_value)
    return old_category, delta.summary if delta else None


def _cell_label(cell: ContentNode) -> str | None:
    assert cell.table is not None
    parts = [part for part in (cell.table.row_key, cell.table.column_header) if part]
    return " · ".join(parts) if parts else None


# ---------------------------------------------------------------- entry point


def _content_under(snapshot: Snapshot, heading: ContentNode) -> tuple[str, ...]:
    """The text sitting under a heading, as a way of recognising that heading.

    Used only for detecting renames, where the words themselves cannot help.
    """
    return tuple(
        normalize_key(node.text)
        for node in snapshot.nodes
        if node.role in PROSE_ROLES and node.section_path and node.section_path[-1] == heading.text
    )


def _pair_renamed_headings(
    pairs: list[BlockPair[ContentNode]], old: Snapshot, new: Snapshot
) -> list[BlockPair[ContentNode]]:
    """Recognise a heading that was renamed rather than replaced.

    Headings are short, and a rename often shares no words at all: "Resources"
    becoming "Further Reading" looks to a text comparison like one heading
    deleted and another added. Reporting it that way is not wrong exactly, but
    it is unhelpful and it loses the fact that the section survived.

    The signal that settles it is structural and already in the snapshot: the
    heading is at the same level, and the content underneath it is word for word
    the same. That is a rename, and nothing else produces that pattern. Where
    the content differs, no claim is made and the two are left as an addition
    and a removal.
    """
    removed = [pair for pair in pairs if pair.kind is PairKind.REMOVED and pair.old is not None]
    added = [pair for pair in pairs if pair.kind is PairKind.ADDED and pair.new is not None]
    if not removed or not added:
        return pairs

    renamed: dict[int, BlockPair[ContentNode]] = {}
    consumed: set[int] = set()

    for removed_pair in removed:
        old_heading = removed_pair.old
        assert old_heading is not None
        old_content = _content_under(old, old_heading)
        if not old_content:
            continue
        for added_pair in added:
            if id(added_pair) in consumed:
                continue
            new_heading = added_pair.new
            assert new_heading is not None
            if new_heading.level != old_heading.level:
                continue
            if _content_under(new, new_heading) != old_content:
                continue
            consumed.add(id(added_pair))
            renamed[id(removed_pair)] = BlockPair(PairKind.MODIFIED, old_heading, new_heading, similarity=1.0)
            break

    if not renamed and not consumed:
        return pairs

    return [renamed.get(id(pair), pair) for pair in pairs if id(pair) not in consumed]


def _subtype_for_prose(node: ContentNode) -> str | None:
    return "list_item" if node.role is NodeRole.LIST_ITEM else None


def _subtype_for_heading(_node: ContentNode) -> str | None:
    return "heading"


def compare_snapshots(old: Snapshot, new: Snapshot) -> ComparisonResult:
    """Compare two captures of a page. Deterministic: same snapshots, same result."""
    return compare_snapshots_verbose(old, new).result


def compare_snapshots_verbose(old: Snapshot, new: Snapshot) -> WebComparisonOutcome:
    diagnostics = WebDiagnostics(
        previous_warnings=old.extraction.warnings,
        revised_warnings=new.extraction.warnings,
        previous_render_note=old.render_note,
        revised_render_note=new.render_note,
    )

    builder = _Builder()
    _compare_metadata(builder, old, new)

    old_headings = [node for node in old.nodes if node.role is NodeRole.HEADING]
    new_headings = [node for node in new.nodes if node.role is NodeRole.HEADING]
    heading_pairs = _pair_renamed_headings(align_blocks(old_headings, new_headings), old, new)
    _emit_block_changes(builder, heading_pairs, old, new, _subtype_for_heading)

    old_prose = [node for node in old.nodes if node.role in PROSE_ROLES]
    new_prose = [node for node in new.nodes if node.role in PROSE_ROLES]
    _emit_block_changes(builder, align_blocks(old_prose, new_prose), old, new, _subtype_for_prose)

    _compare_links(builder, old, new)
    _compare_tables(builder, old, new)

    # Volatility is judged after the changes exist, so a volatile change keeps
    # its evidence and its values and is explained rather than discarded.
    changes = mark_volatile(builder.finish(), builder.contexts)
    result = ComparisonResult(
        engine_version=ENGINE_VERSION,
        old_document=SnapshotRef(
            sha256=old.content_sha256, url=old.source.final_url, node_count=old.node_count
        ),
        new_document=SnapshotRef(
            sha256=new.content_sha256, url=new.source.final_url, node_count=new.node_count
        ),
        changes=changes,
    )

    result, dropped = _drop_untraceable(result, old, new)
    diagnostics.dropped_untraceable = dropped
    if dropped:
        diagnostics.notes.append(
            f"{dropped} change(s) were discarded because their evidence could not be "
            "traced back to the captured pages."
        )
    if diagnostics.needs_javascript:
        diagnostics.notes.append(
            "One of these pages builds its content in the browser, so its text could not be read."
        )
    return WebComparisonOutcome(result=result, diagnostics=diagnostics)


def _drop_untraceable(result: ComparisonResult, old: Snapshot, new: Snapshot) -> tuple[ComparisonResult, int]:
    """The safety net: nothing is returned that cannot be proven."""
    issues = verify_web_traceability(result.changes, old, new)
    if not issues:
        return result, 0

    bad = {issue.change_id for issue in issues}
    kept = [change for change in result.changes if change.id not in bad]
    renumbered = tuple(
        change.model_copy(update={"id": f"c{index}", "seq": index}) for index, change in enumerate(kept)
    )
    data = result.model_dump()
    data["changes"] = [change.model_dump() for change in renumbered]
    return ComparisonResult.model_validate(data), len(result.changes) - len(kept)
