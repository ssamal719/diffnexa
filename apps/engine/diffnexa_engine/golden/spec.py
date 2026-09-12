"""The `expected.yaml` format for a golden PDF pair.

A golden pair states the truth about two PDFs: what the extractor must find in
each, which changes really happened, and which things must never be reported.
Unknown fields are rejected, so a typo can't silently weaken a test.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from diffnexa_engine.contracts.changes import ChangeCategory, ChangeKind


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextExpectation(_Strict):
    page: int = Field(ge=1)
    text: str = Field(min_length=1)


class DocumentExpectation(_Strict):
    page_count: int | None = Field(default=None, ge=1)
    # Pages that must be detected as scanned (no text layer, mostly image).
    scanned_pages: list[int] | None = None
    must_contain: list[TextExpectation] = []


class ExtractionExpectations(_Strict):
    old: DocumentExpectation | None = None
    new: DocumentExpectation | None = None


class ExpectedChange(_Strict):
    category: ChangeCategory
    kind: ChangeKind | None = None
    label: str | None = None
    old: str | None = None
    new: str | None = None
    old_page: int | None = Field(default=None, ge=1)
    new_page: int | None = Field(default=None, ge=1)
    # "exact": values must equal after whitespace normalisation.
    # "contains": the expected value must appear inside the reported value
    # (useful for long paragraphs or moved text).
    match: Literal["exact", "contains"] = "exact"
    note: str | None = None

    @model_validator(mode="after")
    def _identifiable(self) -> ExpectedChange:
        if self.old is None and self.new is None and self.old_page is None and self.new_page is None:
            raise ValueError("an expected change needs an old/new value or a page to identify it")
        return self

    def describe(self) -> str:
        parts = [self.category.value]
        if self.kind:
            parts.append(self.kind.value)
        if self.label:
            parts.append(f"'{self.label}'")
        if self.old is not None or self.new is not None:
            parts.append(f"{self.old!r} -> {self.new!r}")
        pages = []
        if self.old_page:
            pages.append(f"old p{self.old_page}")
        if self.new_page:
            pages.append(f"new p{self.new_page}")
        if pages:
            parts.append(f"({', '.join(pages)})")
        return " ".join(parts)


class MustNotReport(_Strict):
    text: str = Field(min_length=1)
    reason: str | None = None


class UnchangedPages(_Strict):
    old: list[int] = []
    new: list[int] = []


class GoldenSpec(_Strict):
    pair: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = Field(min_length=1)
    source: Literal["synthetic", "public", "private-approved"]
    tags: list[str] = []
    extraction: ExtractionExpectations = ExtractionExpectations()
    expected_changes: list[ExpectedChange] = []
    unchanged_pages: UnchangedPages = UnchangedPages()
    must_not_report: list[MustNotReport] = []
    max_unexpected_changes: int = Field(default=0, ge=0)


class SpecError(Exception):
    pass


def load_spec(path: Path) -> GoldenSpec:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise SpecError(f"{path}: cannot read YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise SpecError(f"{path}: expected a YAML mapping at the top level")
    try:
        spec = GoldenSpec.model_validate(raw)
    except ValidationError as exc:
        raise SpecError(f"{path}: invalid golden spec\n{exc}") from exc
    if spec.pair != path.parent.name:
        raise SpecError(f"{path}: 'pair' is {spec.pair!r} but the folder is {path.parent.name!r}")
    return spec
