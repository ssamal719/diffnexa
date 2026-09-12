"""Match the pages of two versions, so an inserted page does not shift everything.

Pages are matched on their text content, not their position. Each page becomes a
bag of normalised words; two pages score by how much they share (Jaccard
similarity). Matching is greedy, best score first, above `MATCH_THRESHOLD`.

Pages that never find a partner are reported as added or removed. A matched pair
whose positions differ is recorded as moved, which is what page reordering looks
like.

Pages with no usable text — scanned images, and blank pages — cannot be matched
this way. They are matched positionally only when their neighbours on both sides
already match, and are otherwise left unmatched and flagged, never guessed at.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from diffnexa_engine.compare.normalize import normalize_key
from diffnexa_engine.model.document import Document, Page, TextLayerStatus

MATCH_THRESHOLD = 0.35
# Calling a page "reordered" needs much stronger evidence than matching it in place.
REORDER_THRESHOLD = 0.8


class PageAlignment(StrEnum):
    MATCHED = "matched"
    MOVED = "moved"
    ADDED = "added"
    REMOVED = "removed"


@dataclass(frozen=True)
class PageLink:
    alignment: PageAlignment
    old_page: int | None
    new_page: int | None
    similarity: float = 0.0
    comparable: bool = True  # false when a page has no usable text layer


def _fingerprint(page: Page) -> set[str]:
    return {normalize_key(word.text) for word in page.words if word.text.strip()}


def _similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    intersection = len(left & right)
    union = len(left | right)
    return intersection / union if union else 0.0


def align_pages(old: Document, new: Document) -> list[PageLink]:
    old_pages = list(old.pages)
    new_pages = list(new.pages)
    old_prints = {p.number: _fingerprint(p) for p in old_pages}
    new_prints = {p.number: _fingerprint(p) for p in new_pages}

    def score(old_number: int, new_number: int) -> float:
        return _similarity(old_prints[old_number], new_prints[new_number])

    matched = _align_in_order(old_pages, new_pages, score)
    used_new = {new_number for new_number, _ in matched.values()}

    moved = _detect_reordered(old_pages, new_pages, matched, used_new, score)
    _match_textless_neighbours(old_pages, new_pages, matched, used_new)
    _match_remaining_positionally(old_pages, new_pages, matched, used_new)

    links: list[PageLink] = []
    for page in old_pages:
        if page.number in matched:
            new_number, similarity = matched[page.number]
            alignment = PageAlignment.MOVED if page.number in moved else PageAlignment.MATCHED
            links.append(
                PageLink(
                    alignment=alignment,
                    old_page=page.number,
                    new_page=new_number,
                    similarity=similarity,
                    comparable=_comparable(page, new.page(new_number)),
                )
            )
        else:
            links.append(PageLink(PageAlignment.REMOVED, page.number, None, comparable=_comparable(page)))

    for page in new_pages:
        if page.number not in used_new:
            links.append(PageLink(PageAlignment.ADDED, None, page.number, comparable=_comparable(page)))

    links.sort(key=lambda link: (link.new_page or 10**6, link.old_page or 0))
    return links


def _align_in_order(old_pages: list[Page], new_pages: list[Page], score) -> dict[int, tuple[int, float]]:
    """Best order-preserving page alignment (Needleman-Wunsch, no gap penalty).

    Pages are matched in document order. This is what stops a sentence moving
    between pages from making the pages themselves look swapped: crossing
    matches are impossible here, and genuine reordering is handled afterwards by
    `_detect_reordered`, which demands much stronger evidence.
    """
    rows, columns = len(old_pages), len(new_pages)
    best = [[0.0] * (columns + 1) for _ in range(rows + 1)]
    for i in range(1, rows + 1):
        for j in range(1, columns + 1):
            pair_score = score(old_pages[i - 1].number, new_pages[j - 1].number)
            diagonal = best[i - 1][j - 1] + pair_score if pair_score >= MATCH_THRESHOLD else -1.0
            best[i][j] = max(best[i - 1][j], best[i][j - 1], diagonal)

    matched: dict[int, tuple[int, float]] = {}
    i, j = rows, columns
    while i > 0 and j > 0:
        pair_score = score(old_pages[i - 1].number, new_pages[j - 1].number)
        if pair_score >= MATCH_THRESHOLD and best[i][j] == best[i - 1][j - 1] + pair_score:
            matched[old_pages[i - 1].number] = (new_pages[j - 1].number, pair_score)
            i, j = i - 1, j - 1
        elif best[i][j] == best[i - 1][j]:
            i -= 1
        else:
            j -= 1
    return matched


def _detect_reordered(
    old_pages: list[Page],
    new_pages: list[Page],
    matched: dict[int, tuple[int, float]],
    used_new: set[int],
    score,
) -> set[int]:
    """Pair up leftover pages that are near-identical but out of order.

    The bar is deliberately high: a page is only called "moved" when its content
    still closely matches another unused page. Anything weaker is left to the
    ordinary added/removed and positional handling.
    """
    moved: set[int] = set()
    leftover_old = [p.number for p in old_pages if p.number not in matched]
    leftover_new = [p.number for p in new_pages if p.number not in used_new]

    candidates: list[tuple[float, int, int]] = []
    for old_number in leftover_old:
        for new_number in leftover_new:
            similarity = score(old_number, new_number)
            if similarity >= REORDER_THRESHOLD:
                candidates.append((similarity, old_number, new_number))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))

    for similarity, old_number, new_number in candidates:
        if old_number in matched or new_number in used_new:
            continue
        matched[old_number] = (new_number, similarity)
        used_new.add(new_number)
        moved.add(old_number)
    return moved


def _comparable(*pages: Page) -> bool:
    return all(page.text_layer is TextLayerStatus.PRESENT for page in pages)


def _match_textless_neighbours(
    old_pages: list[Page],
    new_pages: list[Page],
    matched: dict[int, tuple[int, float]],
    used_new: set[int],
) -> None:
    """Pair up scanned or blank pages only when their surroundings already agree."""
    for old_page in old_pages:
        if old_page.number in matched or old_page.text_layer is TextLayerStatus.PRESENT:
            continue
        candidate = _neighbour_implied_page(old_page.number, matched, len(new_pages))
        if candidate is None or candidate in used_new:
            continue
        new_page = new_pages[candidate - 1]
        if new_page.text_layer is TextLayerStatus.PRESENT:
            continue
        matched[old_page.number] = (candidate, 0.0)
        used_new.add(candidate)


def _neighbour_implied_page(
    old_number: int, matched: dict[int, tuple[int, float]], new_count: int
) -> int | None:
    before = matched.get(old_number - 1)
    after = matched.get(old_number + 1)
    if before is not None and after is not None and after[0] - before[0] == 2:
        return before[0] + 1
    if before is not None and after is None and before[0] + 1 <= new_count:
        return before[0] + 1
    if after is not None and before is None and after[0] - 1 >= 1:
        return after[0] - 1
    return None


def _match_remaining_positionally(
    old_pages: list[Page],
    new_pages: list[Page],
    matched: dict[int, tuple[int, float]],
    used_new: set[int],
) -> None:
    """Pair up whatever is left, in order.

    A page whose content was replaced outright shares few words with its
    counterpart, so similarity alone would call it one page removed and another
    added. But the page did not disappear — its contents changed. Once the
    confident matches are made, the leftovers on each side are paired in
    document order, and only a genuine surplus on one side is reported as an
    added or removed page.
    """
    leftover_old = [page.number for page in old_pages if page.number not in matched]
    leftover_new = [page.number for page in new_pages if page.number not in used_new]
    for old_number, new_number in zip(leftover_old, leftover_new, strict=False):
        matched[old_number] = (new_number, 0.0)
        used_new.add(new_number)
