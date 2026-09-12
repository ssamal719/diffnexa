"""Detect running headers and footers, and page numbering.

A line that repeats in the same position on most pages is furniture, not
content. "Page 2 of 3" becoming "Page 2 of 4" after a page is inserted is the
classic false positive in document comparison, so these lines are identified and
marked. They are not deleted: changes found in them are still produced, but
labelled as noise so the interface can hide them by default and the golden suite
can tell the difference between "did not report" and "reported as noise".
"""

from __future__ import annotations

import re
from collections import defaultdict

from diffnexa_engine.compare.blocks import Block
from diffnexa_engine.compare.normalize import normalize_key

# Fraction of pages a line must appear on (in the same band) to count as furniture.
REPEAT_RATIO = 0.6
MIN_PAGES_FOR_REPEAT = 3
BAND_RATIO = 0.12  # top/bottom 12% of the page height

_DIGITS = re.compile(r"\d+")
_PAGE_NUMBER_PATTERNS = (
    re.compile(r"^\d{1,4}$"),
    re.compile(r"^page\s+\d{1,4}(\s+of\s+\d{1,4})?$", re.IGNORECASE),
    re.compile(r"^-\s*\d{1,4}\s*-$"),
    re.compile(r"^\d{1,4}\s*/\s*\d{1,4}$"),
)


def _template(text: str) -> str:
    """Replace digits so "Page 2 of 3" and "Page 7 of 9" look like one template."""
    return _DIGITS.sub("#", normalize_key(text))


def looks_like_page_number(text: str) -> bool:
    stripped = normalize_key(text)
    return any(pattern.match(stripped) for pattern in _PAGE_NUMBER_PATTERNS)


def mark_running_heads(blocks: list[Block], page_heights: dict[int, float]) -> None:
    """Set `is_running_head` on blocks that repeat as page furniture."""
    pages = {block.page for block in blocks}
    if len(pages) < MIN_PAGES_FOR_REPEAT:
        # Too few pages to tell furniture from content by repetition alone;
        # fall back to recognising explicit page numbering only.
        for block in blocks:
            if _in_band(block, page_heights) and looks_like_page_number(block.text):
                block.is_running_head = True
        return

    seen: dict[tuple[str, str], set[int]] = defaultdict(set)
    for block in blocks:
        band = _band(block, page_heights)
        if band is None:
            continue
        seen[(band, _template(block.text))].add(block.page)

    threshold = max(MIN_PAGES_FOR_REPEAT, int(len(pages) * REPEAT_RATIO))
    repeated = {key for key, found in seen.items() if len(found) >= threshold}

    for block in blocks:
        band = _band(block, page_heights)
        if band is None:
            continue
        if (band, _template(block.text)) in repeated or looks_like_page_number(block.text):
            block.is_running_head = True


def _band(block: Block, page_heights: dict[int, float]) -> str | None:
    height = page_heights.get(block.page)
    if not height:
        return None
    box = block.bbox_for_page(block.page)
    if box.y1 <= height * BAND_RATIO:
        return "top"
    if box.y0 >= height * (1 - BAND_RATIO):
        return "bottom"
    return None


def _in_band(block: Block, page_heights: dict[int, float]) -> bool:
    return _band(block, page_heights) is not None
