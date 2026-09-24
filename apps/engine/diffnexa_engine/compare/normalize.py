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
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

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


@dataclass(frozen=True)
class MatchOptions:
    """What counts as "the same words" when two versions are matched.

    The defaults are how every DiffNexa comparison has always matched text:
    capitalisation is ignored, punctuation is not. A comparison may choose
    otherwise for its own duration with `matching(...)`; nothing else is
    affected, and what is shown and quoted is always the original text.
    """

    ignore_case: bool = True
    ignore_punctuation: bool = False


_DEFAULT = MatchOptions()
_OPTIONS: ContextVar[MatchOptions | None] = ContextVar("diffnexa_match_options", default=None)


@contextmanager
def matching(options: MatchOptions) -> Iterator[None]:
    """Use these matching options for the comparison run inside this block."""
    token = _OPTIONS.set(options)
    try:
        yield
    finally:
        _OPTIONS.reset(token)


def current_matching() -> MatchOptions:
    return _OPTIONS.get() or _DEFAULT


def _without_punctuation(text: str) -> str:
    """Drop punctuation, except between two digits: "1,000" and "3.5" keep their meaning."""
    kept: list[str] = []
    for index, char in enumerate(text):
        if unicodedata.category(char).startswith("P"):
            between_digits = (
                0 < index < len(text) - 1 and text[index - 1].isdigit() and text[index + 1].isdigit()
            )
            if not between_digits:
                continue
        kept.append(char)
    return _WHITESPACE.sub(" ", "".join(kept)).strip()


def normalize_key(text: str) -> str:
    """The form used to decide whether two pieces of text match.

    Never shown or stored. By default it is `normalize` made case-insensitive;
    the current `MatchOptions` can make it case-sensitive, or drop punctuation.
    """
    options = current_matching()
    key = normalize(text)
    if options.ignore_punctuation:
        key = _without_punctuation(key)
    return key.casefold() if options.ignore_case else key


def tokens(text: str) -> list[str]:
    return normalize(text).split()
