"""Align the text of two documents and find what actually changed.

The algorithm, in three passes:

**Pass 1 — anchor on identical paragraphs.** Both documents become a list of
paragraph blocks in reading order. `difflib.SequenceMatcher` matches the runs of
paragraphs that are identical after normalisation. These anchors are reliable
even when material is inserted or removed around them.

**Pass 2 — pair edited paragraphs.** Inside each region the anchors could not
match, every old paragraph is scored against every new paragraph with
`difflib.SequenceMatcher.ratio()` on their normalised text. Pairs are taken
best-first, and only above `SIMILARITY_THRESHOLD`; anything unpaired is a plain
addition or removal. Pairing is done on text alone, so a paragraph that moved to
a different page still pairs with itself.

**Pass 3 — detect moves.** An unpaired removal whose text is identical to an
unpaired addition is one paragraph that moved, not a deletion plus an insertion.

Inside a paired paragraph, a word-level diff produces the precise replaced
segments, which is what makes "627 → 654" possible instead of reporting the
whole sentence as rewritten.

Why comparison runs across the whole document rather than page by page: if a
page is inserted, page-by-page comparison reports every later page as entirely
rewritten. Comparing the document's reading order and keeping each block's page
for evidence gives the correct answer and still points the user to the right page.

Known limitations (each has a test):

* Two paragraphs that are both heavily rewritten *and* swapped may pair with
  each other's positions rather than their true counterparts.
* A paragraph rewritten beyond `SIMILARITY_THRESHOLD` is reported as one removal
  plus one addition rather than a modification. That is honest — at that point
  it really is new text — but it means no old/new value pair for it.
* Text inside tables is compared as ordinary text; rows and columns are not yet
  reconstructed.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from enum import StrEnum

from diffnexa_engine.compare.blocks import Block
from diffnexa_engine.compare.normalize import normalize, normalize_key

SIMILARITY_THRESHOLD = 0.55
MIN_BLOCK_CHARS_FOR_FUZZY = 3


class PairKind(StrEnum):
    EQUAL = "equal"
    MODIFIED = "modified"
    ADDED = "added"
    REMOVED = "removed"
    MOVED = "moved"


@dataclass(frozen=True)
class BlockPair:
    kind: PairKind
    old: Block | None
    new: Block | None
    similarity: float = 1.0


@dataclass(frozen=True)
class Segment:
    """One replaced, inserted or deleted run of words inside a paired paragraph."""

    old_text: str
    new_text: str
    old_word_ids: tuple[str, ...]
    new_word_ids: tuple[str, ...]


def align_blocks(old_blocks: list[Block], new_blocks: list[Block]) -> list[BlockPair]:
    old_keys = [normalize_key(b.text) for b in old_blocks]
    new_keys = [normalize_key(b.text) for b in new_blocks]

    pairs: list[BlockPair] = []
    unmatched_old: list[Block] = []
    unmatched_new: list[Block] = []

    matcher = SequenceMatcher(a=old_keys, b=new_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                pairs.append(BlockPair(PairKind.EQUAL, old_blocks[i1 + offset], new_blocks[j1 + offset]))
            continue
        region_pairs, region_old, region_new = _pair_region(old_blocks[i1:i2], new_blocks[j1:j2])
        pairs.extend(region_pairs)
        unmatched_old.extend(region_old)
        unmatched_new.extend(region_new)

    pairs.extend(_detect_moves(unmatched_old, unmatched_new))
    return pairs


def _pair_region(
    old_region: list[Block], new_region: list[Block]
) -> tuple[list[BlockPair], list[Block], list[Block]]:
    """Pair up edited paragraphs within one region, best match first."""
    candidates: list[tuple[float, int, int]] = []
    for i, old in enumerate(old_region):
        for j, new in enumerate(new_region):
            score = _similarity(old.text, new.text)
            if score >= SIMILARITY_THRESHOLD:
                candidates.append((score, i, j))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))

    used_old: set[int] = set()
    used_new: set[int] = set()
    pairs: list[BlockPair] = []
    for score, i, j in candidates:
        if i in used_old or j in used_new:
            continue
        used_old.add(i)
        used_new.add(j)
        pairs.append(BlockPair(PairKind.MODIFIED, old_region[i], new_region[j], score))

    leftover_old = [b for i, b in enumerate(old_region) if i not in used_old]
    leftover_new = [b for j, b in enumerate(new_region) if j not in used_new]
    return pairs, leftover_old, leftover_new


def _similarity(left: str, right: str) -> float:
    a, b = normalize_key(left), normalize_key(right)
    if not a or not b:
        return 0.0
    if min(len(a), len(b)) < MIN_BLOCK_CHARS_FOR_FUZZY:
        return 1.0 if a == b else 0.0
    return SequenceMatcher(a=a, b=b, autojunk=False).ratio()


def _detect_moves(old_blocks: list[Block], new_blocks: list[Block]) -> list[BlockPair]:
    """Identical text that vanished in one place and appeared in another moved."""
    remaining_new = list(new_blocks)
    pairs: list[BlockPair] = []
    matched_old: set[int] = set()

    for index, old in enumerate(old_blocks):
        key = normalize_key(old.text)
        match = next((b for b in remaining_new if normalize_key(b.text) == key), None)
        if match is not None:
            remaining_new.remove(match)
            matched_old.add(index)
            pairs.append(BlockPair(PairKind.MOVED, old, match))

    pairs.extend(
        BlockPair(PairKind.REMOVED, block, None)
        for index, block in enumerate(old_blocks)
        if index not in matched_old
    )
    pairs.extend(BlockPair(PairKind.ADDED, None, block) for block in remaining_new)
    return pairs


def word_segments(old: Block, new: Block) -> list[Segment]:
    """The differing runs of words between two paired paragraphs."""
    old_words = list(old.words)
    new_words = list(new.words)
    old_keys = [normalize_key(w.text) for w in old_words]
    new_keys = [normalize_key(w.text) for w in new_words]

    segments: list[Segment] = []
    matcher = SequenceMatcher(a=old_keys, b=new_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        old_slice = old_words[i1:i2]
        new_slice = new_words[j1:j2]
        segments.append(
            Segment(
                old_text=normalize(" ".join(w.text for w in old_slice)),
                new_text=normalize(" ".join(w.text for w in new_slice)),
                old_word_ids=tuple(w.id for w in old_slice),
                new_word_ids=tuple(w.id for w in new_slice),
            )
        )
    return segments
