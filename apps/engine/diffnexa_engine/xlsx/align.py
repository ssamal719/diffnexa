"""Which row (and which column) of one sheet is which row of the other.

Comparing row 3 with row 3 is wrong as soon as a row is inserted above it:
every later row would look rewritten. So rows and columns are first matched by
content, deterministically, and only matched cells are compared.

The method, used for both rows and columns:

1. **Exact anchors.** Items whose content is identical, in the same relative
   order, are matched (the longest common subsequence of their keys).
2. **Edited items between anchors.** In each gap between anchors, the remaining
   items are matched by similarity — the best-scoring monotonic matching, with a
   minimum similarity — so an edited row still finds its counterpart.
3. **Same-size gaps.** If a gap still holds the same number of unmatched items
   on both sides, they are matched in order: the same place in both sheets with
   its content rewritten, rather than one block removed and another added.
4. **Anything left** was added or removed.

Every step is ordered and tie-broken by position, so the same two sheets always
align the same way. Gaps too large to score pair by pair fall back to step 3,
then 4.
"""

from __future__ import annotations

from collections.abc import Callable, Hashable, Sequence
from difflib import SequenceMatcher
from typing import TypeVar

T = TypeVar("T")

#: Beyond this many comparisons in one gap, similarity matching is skipped.
MAX_GAP_COMPARISONS = 40_000


def _best_monotonic(
    old: Sequence[int],
    new: Sequence[int],
    similarity: Callable[[int, int], float],
    threshold: float,
) -> list[tuple[int, int]]:
    """The matching of old to new items, in order, with the highest total similarity."""
    n, m = len(old), len(new)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        row, below = score[i], score[i + 1]
        for j in range(m - 1, -1, -1):
            best = max(below[j], row[j + 1])
            s = similarity(old[i], new[j])
            if s >= threshold:
                best = max(best, s + below[j + 1])
            row[j] = best
    pairs: list[tuple[int, int]] = []
    i = j = 0
    while i < n and j < m:
        s = similarity(old[i], new[j])
        if s >= threshold and abs(score[i][j] - (s + score[i + 1][j + 1])) < 1e-12:
            pairs.append((old[i], new[j]))
            i, j = i + 1, j + 1
        elif abs(score[i][j] - score[i + 1][j]) < 1e-12:
            i += 1
        else:
            j += 1
    return pairs


def _fill_gap(
    old: list[int],
    new: list[int],
    similarity: Callable[[int, int], float],
    threshold: float,
) -> list[tuple[int, int]]:
    if not old or not new:
        return []
    matched: list[tuple[int, int]] = []
    if len(old) * len(new) <= MAX_GAP_COMPARISONS:
        matched = _best_monotonic(old, new, similarity, threshold)

    # Between the similarity matches, same-size runs are paired in order.
    result: list[tuple[int, int]] = []
    fences = [(-1, -1), *[(old.index(a), new.index(b)) for a, b in matched], (len(old), len(new))]
    for (i0, j0), (i1, j1) in zip(fences, fences[1:], strict=False):
        rest_old, rest_new = old[i0 + 1 : i1], new[j0 + 1 : j1]
        if rest_old and len(rest_old) == len(rest_new):
            result.extend(zip(rest_old, rest_new, strict=True))
        if i1 < len(old):
            result.append((old[i1], new[j1]))
    return result


def align(
    old: Sequence[int],
    new: Sequence[int],
    key: Callable[[str, int], Hashable],
    similarity: Callable[[int, int], float],
    threshold: float,
) -> list[tuple[int, int]]:
    """Pairs of (old item, new item), in order. `key(side, item)` gives exact-match keys."""
    old_keys = [key("old", item) for item in old]
    new_keys = [key("new", item) for item in new]
    pairs: list[tuple[int, int]] = []
    matcher = SequenceMatcher(a=old_keys, b=new_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            pairs.extend(zip(old[i1:i2], new[j1:j2], strict=True))
        else:
            pairs.extend(_fill_gap(list(old[i1:i2]), list(new[j1:j2]), similarity, threshold))
    return pairs


__all__ = ["MAX_GAP_COMPARISONS", "align"]
