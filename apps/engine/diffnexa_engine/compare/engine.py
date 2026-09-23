"""The deterministic comparison engine.

`compare_documents(old, new)` is the whole public surface. It returns a
`ComparisonResult` built entirely from what the two documents say. There is no
AI here and no network access; the same two PDFs always produce the same result.

Order of work:

1. **Pages** are aligned, giving added, removed, moved and matched pages.
2. **Blocks** (paragraphs and headings) are built in reading order, and repeated
   headers and footers are marked as page furniture.
3. **Text** is aligned across the whole document, producing paired, added,
   removed and moved paragraphs.
4. **Values** inside each paired paragraph are examined: where a single run of
   words was replaced and both sides parse as a number or a date, one typed
   change is produced with the difference calculated, rather than a vague
   "text modified".
5. **Noise** is marked: changes confined to running headers or page numbering,
   and text that only moved.
6. **Evidence is verified.** Every change is checked against the actual
   documents by the Stage 1 traceability checker before it is returned. A change
   whose evidence cannot be traced is dropped and counted, never shown.

Step 6 is the safety net that makes the promise real: it is not possible for
this engine to return a change the documents do not support.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.compare.blocks import Block, build_blocks
from diffnexa_engine.compare.headers import mark_running_heads
from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.compare.pages import PageAlignment, PageLink, align_pages
from diffnexa_engine.compare.text_align import (
    BlockPair,
    PairKind,
    Segment,
    align_blocks,
    word_segments,
)
from diffnexa_engine.compare.values import (
    TypedValue,
    ValueKind,
    compare_values,
    parse_value,
    parse_whole_date,
)
from diffnexa_engine.contracts.changes import (
    Change,
    ChangeCategory,
    ChangeKind,
    ComparisonResult,
    DocumentRef,
    Evidence,
    Side,
)
from diffnexa_engine.contracts.traceability import verify_traceability
from diffnexa_engine.model.document import BBox, Document, Page, TextLayerStatus, Word

EXCERPT_CHARS = 240
LABEL_MAX_CHARS = 80

_VALUE_CATEGORIES = {
    ValueKind.NUMBER: ChangeCategory.NUMBER,
    ValueKind.MONEY: ChangeCategory.NUMBER,
    ValueKind.PERCENT: ChangeCategory.NUMBER,
    ValueKind.YEAR: ChangeCategory.NUMBER,
    ValueKind.DATE: ChangeCategory.DATE,
    ValueKind.IDENTIFIER: ChangeCategory.IDENTIFIER,
}


@dataclass
class ComparisonDiagnostics:
    """What the engine could not do, reported honestly alongside the result."""

    old_pages_without_text: list[int] = field(default_factory=list)
    new_pages_without_text: list[int] = field(default_factory=list)
    old_scanned_pages: list[int] = field(default_factory=list)
    new_scanned_pages: list[int] = field(default_factory=list)
    dropped_untraceable: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def ocr_required(self) -> bool:
        return bool(self.old_scanned_pages or self.new_scanned_pages)


@dataclass
class ComparisonOutcome:
    result: ComparisonResult
    diagnostics: ComparisonDiagnostics
    page_links: list[PageLink]


def compare_documents(old: Document, new: Document) -> ComparisonResult:
    """Compare two documents. Matches the Stage 1 `Comparator` interface."""
    return compare_documents_verbose(old, new).result


def compare_documents_verbose(old: Document, new: Document) -> ComparisonOutcome:
    diagnostics = _diagnose(old, new)
    page_links = align_pages(old, new)

    old_blocks = _prepared_blocks(old)
    new_blocks = _prepared_blocks(new)

    builder = _ChangeBuilder()
    _emit_page_changes(builder, page_links, old, new)
    _emit_text_changes(builder, align_blocks(old_blocks, new_blocks))

    changes = builder.finish()
    result = ComparisonResult(
        engine_version=ENGINE_VERSION,
        old_document=DocumentRef(sha256=old.source.sha256, page_count=old.page_count),
        new_document=DocumentRef(sha256=new.source.sha256, page_count=new.page_count),
        changes=changes,
    )

    result, dropped = _drop_untraceable(result, old, new)
    diagnostics.dropped_untraceable = dropped
    if dropped:
        diagnostics.notes.append(
            f"{dropped} change(s) were discarded because their evidence could not be "
            "traced back to the documents."
        )
    if diagnostics.ocr_required:
        diagnostics.notes.append(
            "Some pages are images with no text layer. Their text cannot be compared "
            "until OCR is available (planned for a later stage)."
        )
    return ComparisonOutcome(result=result, diagnostics=diagnostics, page_links=page_links)


# ---------------------------------------------------------------- preparation


def _diagnose(old: Document, new: Document) -> ComparisonDiagnostics:
    def without_text(document: Document) -> list[int]:
        return [p.number for p in document.pages if p.text_layer is not TextLayerStatus.PRESENT]

    def scanned(document: Document) -> list[int]:
        return [p.number for p in document.pages if p.likely_scanned]

    return ComparisonDiagnostics(
        old_pages_without_text=without_text(old),
        new_pages_without_text=without_text(new),
        old_scanned_pages=scanned(old),
        new_scanned_pages=scanned(new),
    )


def _prepared_blocks(document: Document) -> list[Block]:
    blocks = build_blocks(document)
    mark_running_heads(blocks, {page.number: page.height for page in document.pages})
    return blocks


# ---------------------------------------------------------------- evidence helpers


def _words_by_id(document: Document) -> dict[str, Word]:
    return document.word_index()


def _excerpt(text: str) -> str:
    """A shortened value for display. Not for evidence — see `_quoted_excerpt`."""
    cleaned = normalize(text)
    if len(cleaned) <= EXCERPT_CHARS:
        return cleaned
    return cleaned[: EXCERPT_CHARS - 1].rstrip() + "…"


def _quoted_excerpt(text: str) -> str:
    """A shortened quotation that is still literally part of what was quoted.

    Evidence excerpts are checked against the words they cite, and an excerpt
    ending in an ellipsis is no longer found in that text, so the change is
    rejected and discarded. Cutting at a word boundary with no added characters
    keeps the excerpt a true opening fragment of the cited words, which the
    traceability check accepts without being relaxed.
    """
    cleaned = normalize(text)
    if len(cleaned) <= EXCERPT_CHARS:
        return cleaned
    cut = cleaned[:EXCERPT_CHARS]
    boundary = cut.rfind(" ")
    return (cut[:boundary] if boundary > 0 else cut).rstrip()


def _block_evidence(block: Block, side: Side) -> list[Evidence]:
    """One piece of evidence per page the block occupies."""
    evidence: list[Evidence] = []
    for page in block.pages:
        page_words = [w for line in block.lines if line.page == page for w in line.words]
        evidence.append(
            Evidence(
                side=side,
                page=page,
                word_ids=tuple(w.id for w in page_words),
                bbox=block.bbox_for_page(page),
                excerpt=_quoted_excerpt(" ".join(w.text for w in page_words)),
            )
        )
    return evidence


def _truncated_excerpt_is_safe(cited: str, excerpt: str) -> bool:
    return cited in excerpt or excerpt in cited


def _segment_evidence(block: Block, word_ids: tuple[str, ...], side: Side) -> list[Evidence]:
    """Evidence pinned to the exact words that changed, within one paragraph."""
    words = {w.id: w for w in block.words}
    by_page: dict[int, list[Word]] = {}
    for word_id in word_ids:
        word = words.get(word_id)
        if word is None:
            continue
        page = int(word_id.split("-")[0][1:])
        by_page.setdefault(page, []).append(word)

    if not by_page:
        return _block_evidence(block, side)

    return [
        Evidence(
            side=side,
            page=page,
            word_ids=tuple(w.id for w in page_words),
            bbox=BBox.union([w.bbox for w in page_words]),
            excerpt=_context_excerpt(block, page_words),
        )
        for page, page_words in sorted(by_page.items())
    ]


def _context_excerpt(block: Block, words: list[Word]) -> str:
    """A readable snippet that always contains the cited words.

    The traceability checker requires the excerpt and the cited words to agree,
    which is deliberate: it stops a change quoting text it did not actually cite.
    So the snippet is the surrounding line when that line contains the cited
    words, and the cited words themselves otherwise.
    """
    cited = normalize(" ".join(word.text for word in words))
    wanted = {word.id for word in words}
    for line in block.lines:
        if wanted <= {word.id for word in line.words}:
            line_text = normalize(line.text)
            if cited and cited in line_text and len(line_text) <= EXCERPT_CHARS:
                return line_text
    return _quoted_excerpt(cited)


PAGE_EVIDENCE_MAX_WORDS = 60


def _page_evidence(page: Page, side: Side) -> Evidence:
    """Evidence for a whole page that was added or removed.

    The words cited and the excerpt shown must agree, because the traceability
    checker rejects evidence that quotes something other than what it cites —
    and rightly so. Truncating the excerpt at a character limit while still
    citing every word breaks that agreement on any text-dense page, and the
    change is then discarded: whole added pages vanished from the results.

    So the opening words are taken only up to the excerpt's length, and exactly
    those words are cited. The excerpt is a complete quotation of them, never an
    abbreviation of a longer list.
    """
    cited: list[Word] = []
    length = 0
    for word in page.words[:PAGE_EVIDENCE_MAX_WORDS]:
        addition = len(word.text) + (1 if cited else 0)
        if cited and length + addition > EXCERPT_CHARS:
            break
        cited.append(word)
        length += addition

    excerpt = normalize(" ".join(word.text for word in cited)) if cited else None
    return Evidence(
        side=side,
        page=page.number,
        word_ids=tuple(word.id for word in cited),
        bbox=BBox(x0=0, y0=0, x1=page.width, y1=page.height),
        excerpt=excerpt,
    )


# ---------------------------------------------------------------- change building


class _ChangeBuilder:
    def __init__(self) -> None:
        self._changes: list[Change] = []

    def add(self, **fields: object) -> None:
        seq = len(self._changes)
        self._changes.append(Change(id=f"c{seq}", seq=seq, **fields))  # type: ignore[arg-type]

    def finish(self) -> tuple[Change, ...]:
        merged = _merge_moves(self._changes)
        return tuple(
            change.model_copy(update={"id": f"c{index}", "seq": index}) for index, change in enumerate(merged)
        )


MIN_WORDS_FOR_MOVE = 5


def _merge_moves(changes: list[Change]) -> list[Change]:
    """Turn a removal and an identical addition into one "moved" change.

    Text that disappears in one place and reappears word-for-word somewhere else
    has moved; reporting it as a deletion plus an insertion would be two false
    changes. Only runs of at least five words are merged, so short repeated
    phrases are not mistaken for movement.
    """
    removals = [
        index
        for index, change in enumerate(changes)
        if change.kind is ChangeKind.REMOVED
        and change.category is ChangeCategory.TEXT
        and change.old_value
        and len(change.old_value.split()) >= MIN_WORDS_FOR_MOVE
    ]
    additions = [
        index
        for index, change in enumerate(changes)
        if change.kind is ChangeKind.ADDED
        and change.category is ChangeCategory.TEXT
        and change.new_value
        and len(change.new_value.split()) >= MIN_WORDS_FOR_MOVE
    ]
    if not removals or not additions:
        return list(changes)

    used_additions: set[int] = set()
    replaced: dict[int, Change] = {}
    dropped: set[int] = set()

    for removal_index in removals:
        removal = changes[removal_index]
        key = normalize(removal.old_value or "")
        match_index = next(
            (
                index
                for index in additions
                if index not in used_additions and normalize(changes[index].new_value or "") == key
            ),
            None,
        )
        if match_index is None:
            continue
        addition = changes[match_index]
        used_additions.add(match_index)
        dropped.add(match_index)
        replaced[removal_index] = removal.model_copy(
            update={
                "kind": ChangeKind.MOVED,
                "new_value": addition.new_value,
                "label": removal.label or addition.label,
                "noise_reason": "Identical text that moved position; its wording did not change.",
                "evidence": tuple(
                    [e for e in removal.evidence if e.side is Side.OLD]
                    + [e for e in addition.evidence if e.side is Side.NEW]
                ),
            }
        )

    return [replaced.get(index, change) for index, change in enumerate(changes) if index not in dropped]


def _emit_page_changes(builder: _ChangeBuilder, links: list[PageLink], old: Document, new: Document) -> None:
    for link in links:
        if link.alignment is PageAlignment.ADDED and link.new_page is not None:
            page = new.page(link.new_page)
            builder.add(
                kind=ChangeKind.ADDED,
                category=ChangeCategory.PAGE,
                label=f"Page {page.number} added",
                new_value=f"Page {page.number}",
                evidence=(_page_evidence(page, Side.NEW),),
            )
        elif link.alignment is PageAlignment.REMOVED and link.old_page is not None:
            page = old.page(link.old_page)
            builder.add(
                kind=ChangeKind.REMOVED,
                category=ChangeCategory.PAGE,
                label=f"Page {page.number} removed",
                old_value=f"Page {page.number}",
                evidence=(_page_evidence(page, Side.OLD),),
            )
        elif link.alignment is PageAlignment.MOVED and link.old_page and link.new_page:
            builder.add(
                kind=ChangeKind.MOVED,
                category=ChangeCategory.PAGE,
                label=f"Page moved from position {link.old_page} to {link.new_page}",
                old_value=f"Page {link.old_page}",
                new_value=f"Page {link.new_page}",
                confidence=round(link.similarity, 3),
                evidence=(
                    _page_evidence(old.page(link.old_page), Side.OLD),
                    _page_evidence(new.page(link.new_page), Side.NEW),
                ),
            )


def _emit_text_changes(builder: _ChangeBuilder, pairs: list[BlockPair]) -> None:
    for pair in pairs:
        if pair.kind is PairKind.EQUAL:
            continue
        if pair.kind is PairKind.ADDED and pair.new is not None:
            _emit_whole_block(builder, pair.new, ChangeKind.ADDED, Side.NEW)
        elif pair.kind is PairKind.REMOVED and pair.old is not None:
            _emit_whole_block(builder, pair.old, ChangeKind.REMOVED, Side.OLD)
        elif pair.kind is PairKind.MOVED and pair.old and pair.new:
            builder.add(
                kind=ChangeKind.MOVED,
                category=ChangeCategory.TEXT,
                label=_label_for(pair.new),
                old_value=_excerpt(pair.old.text),
                new_value=_excerpt(pair.new.text),
                noise_reason=("Identical text that moved position; its wording did not change."),
                evidence=tuple(_block_evidence(pair.old, Side.OLD) + _block_evidence(pair.new, Side.NEW)),
            )
        elif pair.kind is PairKind.MODIFIED and pair.old and pair.new:
            _emit_modified_block(builder, pair)


def _emit_whole_block(builder: _ChangeBuilder, block: Block, kind: ChangeKind, side: Side) -> None:
    text = _excerpt(block.text)
    if not text:
        return
    builder.add(
        kind=kind,
        category=ChangeCategory.TEXT,
        subtype="heading" if block.is_heading else None,
        label=_label_for(block),
        old_value=text if side is Side.OLD else None,
        new_value=text if side is Side.NEW else None,
        noise_reason=_running_head_reason(block),
        evidence=tuple(_block_evidence(block, side)),
    )


def _emit_modified_block(builder: _ChangeBuilder, pair: BlockPair) -> None:
    assert pair.old is not None and pair.new is not None
    segments = word_segments(pair.old, pair.new)
    if not segments:
        return

    noise = _running_head_reason(pair.old) or _running_head_reason(pair.new)
    confidence = round(pair.similarity, 3)

    # A date such as "30 September 2026" -> "15 October 2026" differs in two
    # places ("30"/"15" and "September"/"October") with the year unchanged, so a
    # word-level diff alone would report two unrelated number and text changes.
    # Dates are therefore resolved first, across the whole line.
    consumed_old, consumed_new = _emit_date_changes(
        builder, pair, segments, confidence=confidence, noise=noise
    )

    for segment in segments:
        if _segment_is_consumed(segment, consumed_old, consumed_new):
            continue
        typed = _typed_change(segment)
        if typed is not None:
            category, old_value, new_value, delta = typed
        else:
            category = ChangeCategory.TEXT
            old_value = segment.old_text or None
            new_value = segment.new_text or None
            delta = None

        kind = _segment_kind(segment)
        if kind is ChangeKind.MODIFIED and (old_value is None or new_value is None):
            # A modification must state both values; fall back to the paragraph text.
            old_value = old_value or _excerpt(pair.old.text)
            new_value = new_value or _excerpt(pair.new.text)

        evidence: list[Evidence] = []
        if segment.old_word_ids:
            evidence += _segment_evidence(pair.old, segment.old_word_ids, Side.OLD)
        if segment.new_word_ids:
            evidence += _segment_evidence(pair.new, segment.new_word_ids, Side.NEW)
        # A pure insertion or deletion inside a paragraph still has a counterpart
        # paragraph; cite it so a modification always has both sides.
        if kind is ChangeKind.MODIFIED:
            if not any(e.side is Side.OLD for e in evidence):
                evidence += _block_evidence(pair.old, Side.OLD)
            if not any(e.side is Side.NEW for e in evidence):
                evidence += _block_evidence(pair.new, Side.NEW)
        if not evidence:
            continue

        builder.add(
            kind=kind,
            category=category,
            subtype="heading" if pair.new.is_heading else None,
            label=_label_for(pair.new, segment),
            old_value=old_value,
            new_value=new_value,
            delta=delta,
            confidence=confidence,
            noise_reason=noise,
            evidence=tuple(evidence),
        )


def _segment_is_consumed(segment: Segment, consumed_old: set[str], consumed_new: set[str]) -> bool:
    """True when every changed word of the segment was already reported as a date."""
    old_ids = set(segment.old_word_ids)
    new_ids = set(segment.new_word_ids)
    if not old_ids and not new_ids:
        return True
    return old_ids <= consumed_old and new_ids <= consumed_new


def _emit_date_changes(
    builder: _ChangeBuilder,
    pair: BlockPair,
    segments: list[Segment],
    *,
    confidence: float,
    noise: str | None,
) -> tuple[set[str], set[str]]:
    """Report whole-date changes, and return the word IDs they account for."""
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
        old_value, old_words = old_span
        new_value, new_words = new_span
        if old_value.ambiguous or new_value.ambiguous:
            continue
        if old_value.as_date == new_value.as_date:
            continue

        delta = compare_values(old_value, new_value)
        builder.add(
            kind=ChangeKind.MODIFIED,
            category=ChangeCategory.DATE,
            label=_label_before(pair.new, new_words, new_value.text),
            old_value=old_value.text,
            new_value=new_value.text,
            delta=delta.summary if delta else None,
            confidence=confidence,
            noise_reason=noise,
            evidence=tuple(
                _segment_evidence(pair.old, tuple(w.id for w in old_words), Side.OLD)
                + _segment_evidence(pair.new, tuple(w.id for w in new_words), Side.NEW)
            ),
        )
        consumed_old.update(w.id for w in old_words)
        consumed_new.update(w.id for w in new_words)

    return consumed_old, consumed_new


def _date_span(block: Block, word_ids: tuple[str, ...]) -> tuple[TypedValue, list[Word]] | None:
    """Find a complete date on the line holding these words, and the words spelling it."""
    line = next(
        (line for line in block.lines if set(word_ids) & {word.id for word in line.words}),
        None,
    )
    if line is None:
        return None
    words = list(line.words)
    changed = set(word_ids)

    # Try every run of up to 6 consecutive words that includes a changed word.
    best: tuple[TypedValue, list[Word]] | None = None
    for start in range(len(words)):
        for end in range(start + 1, min(start + 7, len(words)) + 1):
            run = words[start:end]
            if not changed & {w.id for w in run}:
                continue
            parsed = parse_whole_date(" ".join(w.text for w in run))
            if parsed is None:
                continue
            if best is None or len(parsed.text) > len(best[0].text):
                best = (parsed, run)
    return best


def _label_before(block: Block, words: list[Word], value_text: str) -> str | None:
    """Text introducing a value on the same line, taken verbatim from the document."""
    line = _line_containing(block, tuple(w.id for w in words))
    if not line or value_text not in line:
        return None
    label = line.split(value_text)[0].strip(" :\u2013\u2014-\t")
    return label if 0 < len(label) <= LABEL_MAX_CHARS else None


def _segment_kind(segment: Segment) -> ChangeKind:
    if segment.old_word_ids and segment.new_word_ids:
        return ChangeKind.MODIFIED
    return ChangeKind.ADDED if segment.new_word_ids else ChangeKind.REMOVED


def _typed_change(
    segment: Segment,
) -> tuple[ChangeCategory, str, str, str | None] | None:
    """If both sides of a replaced run are the same kind of value, type the change."""
    if not (segment.old_word_ids and segment.new_word_ids):
        return None
    old_value = parse_value(segment.old_text)
    new_value = parse_value(segment.new_text)
    if old_value is None or new_value is None:
        return None
    category = _shared_category(old_value, new_value)
    if category is None:
        return None
    if category is ChangeCategory.DATE and (old_value.ambiguous or new_value.ambiguous):
        # An ambiguous date format could be read two ways; comparing it as a date
        # risks inventing a difference, so it stays a plain text change.
        return None

    delta = compare_values(old_value, new_value)
    return category, old_value.text, new_value.text, delta.summary if delta else None


def _shared_category(old: TypedValue, new: TypedValue) -> ChangeCategory | None:
    old_category = _VALUE_CATEGORIES.get(old.kind)
    new_category = _VALUE_CATEGORIES.get(new.kind)
    if old_category is None or old_category is not new_category:
        return None
    return old_category


def _label_for(block: Block, segment: Segment | None = None) -> str | None:
    """The nearest descriptive text, taken from the document itself.

    For "Total Vacancies: 627" the label is "Total Vacancies". Nothing is
    invented: if the paragraph has no label-like prefix, there is no label.
    """
    if segment is not None and segment.new_text:
        line = _line_containing(block, segment.new_word_ids)
        if line:
            prefix = line.split(segment.new_text)[0] if segment.new_text in line else ""
            label = prefix.strip(" :–—-\t")
            if 0 < len(label) <= LABEL_MAX_CHARS:
                return label
    if block.is_heading:
        text = normalize(block.text)
        return text[:LABEL_MAX_CHARS] if text else None
    return None


def _line_containing(block: Block, word_ids: tuple[str, ...]) -> str | None:
    wanted = set(word_ids)
    for line in block.lines:
        if wanted & {word.id for word in line.words}:
            return normalize(line.text)
    return None


def _running_head_reason(block: Block) -> str | None:
    if block.is_running_head:
        return "Repeated page header, footer or page number rather than document content."
    return None


# ---------------------------------------------------------------- safety net


def _drop_untraceable(result: ComparisonResult, old: Document, new: Document) -> tuple[ComparisonResult, int]:
    issues = verify_traceability(result, old, new)
    if not issues:
        return result, 0
    bad_ids = {issue.change_id for issue in issues}
    if "*" in bad_ids:  # the result does not belong to these documents at all
        raise ValueError("comparison result does not refer to the documents it was built from")

    kept = [change for change in result.changes if change.id not in bad_ids]
    renumbered = tuple(change.model_copy(update={"seq": index}) for index, change in enumerate(kept))
    data = result.model_dump()
    data["changes"] = [change.model_dump() for change in renumbered]
    return ComparisonResult.model_validate(data), len(result.changes) - len(kept)
