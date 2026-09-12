"""The format-neutral shape that text comparison works on.

DiffNexa reads documents in more than one format, and each format loses or keeps
different information. A PDF has no paragraphs — only characters at coordinates —
so the PDF adapter reconstructs paragraphs from geometry. An HTML page never
lost its paragraphs; reconstructing them from pixel positions would be absurd.

What both formats *do* have is the same at the level where text is compared: an
ordered run of blocks, each with text and the individual words inside it. That
is what these protocols describe, and it is all `compare/text_align.py` needs.

Why protocols rather than a base class: a `Block` from the PDF adapter and a
future content node from a web page have nothing in common structurally — one
carries bounding boxes and page numbers, the other DOM paths. Forcing them into
a shared base class would mean one of them inventing fields it cannot honestly
fill, and invented positions are invented evidence. A protocol lets each adapter
keep its own truthful shape and simply agree on the part that is genuinely
shared.

Anything richer — where a block sits, what it looks like, how to cite it as
evidence — stays with the adapter that can answer it truthfully.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable


@runtime_checkable
class ContentToken(Protocol):
    """One word, identified well enough to be cited as evidence.

    The PDF adapter's `Word` satisfies this. So will a web adapter's token.
    """

    @property
    def id(self) -> str:
        """Stable within its document, so evidence can point at exactly this word."""
        ...

    @property
    def text(self) -> str: ...


@runtime_checkable
class ContentBlock(Protocol):
    """A paragraph, heading, list item or similar run of text.

    `text` is the whole block as a reader would see it. `tokens` are the words
    inside it, in order, so a change can be narrowed to the words that actually
    differ rather than the whole block.
    """

    @property
    def text(self) -> str: ...

    @property
    def tokens(self) -> Sequence[ContentToken]: ...
