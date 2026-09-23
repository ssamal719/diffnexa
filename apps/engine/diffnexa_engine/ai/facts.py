"""The input contract for AI Change Analyst: deterministic facts, nothing else.

Every field here is copied from a comparison result the deterministic engine
produced. Nothing in this module (or anywhere in `diffnexa_engine.ai`) creates a
change: the facts describe changes that already exist, under the IDs the
comparison already gave them, with the evidence it already recorded.

The shapes are deliberately plain — strings a person can read — because they
serve three readers: the prompt (what the model is told), the validator (what
an AI statement may be checked against) and the interface (what is shown next
to each explanation, labelled as coming from the comparison, not from AI).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ToolId = Literal["pdf", "web", "policy", "competitor", "price", "docx", "excel"]
TOOLS: tuple[str, ...] = ("pdf", "web", "policy", "competitor", "price", "docx", "excel")

CHANGE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


class _Facts(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EvidenceFact(_Facts):
    """One piece of the comparison's evidence for a change, in the reader's terms."""

    #: "<change id>.e<n>", stable for one result: the n-th evidence item of that change.
    ref: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}\.e[1-9][0-9]{0,3}$")
    side: Literal["original", "revised"]
    #: Where it is: "Page 3", "Table 1, row 2, column 2", "Sheet “Pricing”, cell F5".
    location: str = Field(min_length=1, max_length=400)
    excerpt: str | None = None


class ChangeFacts(_Facts):
    """One deterministic change, as the comparison reported it."""

    id: str = Field(pattern=CHANGE_ID_PATTERN)
    #: Position in the comparison's own list of changes, from 0.
    order: int = Field(ge=0)
    kind: Literal["added", "removed", "modified", "moved"]
    category: str = Field(min_length=1, max_length=40)
    type_label: str = Field(min_length=1, max_length=80)
    label: str | None = None
    location: str = Field(min_length=1, max_length=400)
    original: str | None = None
    revised: str | None = None
    delta: str | None = None
    #: Deterministic classifications: policy topic, price category, competitor signal, group.
    signals: tuple[str, ...] = ()
    #: Further deterministic facts, e.g. a formula's stored result.
    details: tuple[str, ...] = ()
    #: The comparison itself classed this change as noise (a timestamp, a token).
    noise: bool = False
    evidence: tuple[EvidenceFact, ...] = Field(min_length=1)


class AnalysisFacts(_Facts):
    """Everything AI Change Analyst may know about one comparison."""

    tool: ToolId
    tool_name: str
    subject: str
    total_changes: int = Field(ge=0)
    changes: tuple[ChangeFacts, ...]
    #: Statements the deterministic result supports about what did NOT change.
    unchanged: tuple[str, ...] = ()
    #: How to read this tool's classifications, stated for the model and the reader.
    tool_notes: tuple[str, ...] = ()

    def change(self, change_id: str) -> ChangeFacts | None:
        return next((item for item in self.changes if item.id == change_id), None)

    @property
    def eligible(self) -> tuple[ChangeFacts, ...]:
        """The changes that may be explained: everything the comparison did not class as noise."""
        return tuple(item for item in self.changes if not item.noise)


__all__ = ["CHANGE_ID_PATTERN", "TOOLS", "AnalysisFacts", "ChangeFacts", "EvidenceFact", "ToolId"]
