"""Text normalisation used for *matching only*.

Two rules make this safe:

1. Normalised text is never shown to the user and never stored as a change
   value. Everything on screen is the original text from the PDF.
2. Normalisation only removes differences that a reader would not call a change:
   how text is wrapped, which kind of quote or dash a font used, and how many
   spaces sit between words.
"""

from __future__ import annotations

import re
import unicodedata

_QUOTES = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201a": "'",
    "\u201b": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u201e": '"',
    "\u201f": '"',
    "\u00ab": '"',
    "\u00bb": '"',
}
_DASHES = {
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2015": "-",
    "\u2212": "-",
}
_SPACES = {"\u00a0": " ", "\u2007": " ", "\u2009": " ", "\u202f": " ", "\u200b": ""}
_TRANSLATION = str.maketrans({**_QUOTES, **_DASHES, **_SPACES})

_WHITESPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Normalise for display-independent comparison, preserving case."""
    folded = unicodedata.normalize("NFKC", text).translate(_TRANSLATION)
    return _WHITESPACE.sub(" ", folded).strip()


def normalize_key(text: str) -> str:
    """A looser form used for alignment scoring only: also case-insensitive."""
    return normalize(text).casefold()


def tokens(text: str) -> list[str]:
    return normalize(text).split()
