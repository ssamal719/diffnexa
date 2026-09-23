"""The result contract: what a detected change is, and what counts as evidence.

Rules enforced here (a change that breaks them cannot even be constructed):

1. Every change carries at least one piece of evidence.
2. Evidence points to a place in a source PDF: a page plus a location (word IDs
   and/or a bounding box). Only metadata changes may use document-level evidence.
3. Added changes need evidence from the new PDF, removed changes from the old PDF,
   modified and moved changes from both.
4. Modified changes state both the old and the new value.
5. AI output is a separate `AIAnnotation` type. It can only describe an existing
   change by ID; it has no fields for values, evidence or new changes.
6. A ComparisonResult rejects annotations that point to unknown change IDs, and
   evidence that points to pages outside the documents.

Full traceability against the actual extracted documents (do the word IDs exist,
is the box inside the page, does the excerpt match those words) is checked by
`diffnexa_engine.contracts.traceability.verify_traceability`.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from diffnexa_engine.model.document import BBox

RESULT_SCHEMA_VERSION: Literal["1"] = "1"


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Side(StrEnum):
    OLD = "old"
    NEW = "new"


class ChangeKind(StrEnum):
    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    MOVED = "moved"


class ChangeCategory(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    IDENTIFIER = "identifier"
    TABLE = "table"
    IMAGE = "image"
    PAGE = "page"
    LINK = "link"
    METADATA = "metadata"
    FORMATTING = "formatting"
    LAYOUT = "layout"


class ChangeType(StrEnum):
    """The named change types the interface and reports use.

    A change type is derived from `kind` + `category`, so there is exactly one
    place where the naming lives and the two can never disagree.
    """

    PAGE_ADDED = "PAGE_ADDED"
    PAGE_REMOVED = "PAGE_REMOVED"
    PAGE_MOVED = "PAGE_MOVED"
    TEXT_ADDED = "TEXT_ADDED"
    TEXT_REMOVED = "TEXT_REMOVED"
    TEXT_MODIFIED = "TEXT_MODIFIED"
    TEXT_MOVED = "TEXT_MOVED"
    NUMBER_CHANGED = "NUMBER_CHANGED"
    DATE_CHANGED = "DATE_CHANGED"
    IDENTIFIER_CHANGED = "IDENTIFIER_CHANGED"
    TABLE_CHANGED = "TABLE_CHANGED"
    IMAGE_CHANGED = "IMAGE_CHANGED"
    LINK_CHANGED = "LINK_CHANGED"
    METADATA_CHANGED = "METADATA_CHANGED"
    FORMATTING_CHANGED = "FORMATTING_CHANGED"
    LAYOUT_CHANGED = "LAYOUT_CHANGED"


_KIND_SUFFIX = {
    ChangeKind.ADDED: "ADDED",
    ChangeKind.REMOVED: "REMOVED",
    ChangeKind.MODIFIED: "MODIFIED",
    ChangeKind.MOVED: "MOVED",
}

# Categories whose changes are always named "<CATEGORY>_CHANGED", because an
# added or removed number is still a numeric change to the reader.
_ALWAYS_CHANGED = {
    ChangeCategory.NUMBER: ChangeType.NUMBER_CHANGED,
    ChangeCategory.DATE: ChangeType.DATE_CHANGED,
    ChangeCategory.IDENTIFIER: ChangeType.IDENTIFIER_CHANGED,
    ChangeCategory.TABLE: ChangeType.TABLE_CHANGED,
    ChangeCategory.IMAGE: ChangeType.IMAGE_CHANGED,
    ChangeCategory.LINK: ChangeType.LINK_CHANGED,
    ChangeCategory.METADATA: ChangeType.METADATA_CHANGED,
    ChangeCategory.FORMATTING: ChangeType.FORMATTING_CHANGED,
    ChangeCategory.LAYOUT: ChangeType.LAYOUT_CHANGED,
}


def derive_change_type(kind: ChangeKind, category: ChangeCategory) -> ChangeType:
    fixed = _ALWAYS_CHANGED.get(category)
    if fixed is not None:
        return fixed
    return ChangeType(f"{category.value.upper()}_{_KIND_SUFFIX[kind]}")


class Importance(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFORMATIONAL = "informational"


class Evidence(_Frozen):
    """Where a change came from, in terms the source format can actually answer.

    Three scopes, and a piece of evidence uses exactly one of them:

    * ``page`` — a place on a page of a document: a page number, plus the words
      or the area on it. This is what PDFs can prove.
    * ``document`` — a property of the file as a whole, such as its title. Only
      metadata changes may use it.
    * ``node`` — a place in a captured webpage: the snapshot it came from, the
      content node, and the words cited within that node. A webpage has no pages
      and no coordinates, so inventing them would be inventing evidence.

    The fields of one scope are forbidden on the others, checked below, so page
    evidence can never quietly become node evidence or the reverse.
    """

    side: Side
    scope: Literal["page", "document", "node"] = "page"

    # page scope
    page: int | None = Field(default=None, ge=1)
    bbox: BBox | None = None
    word_ids: tuple[str, ...] = ()

    # document scope, e.g. "metadata.title"
    field: str | None = Field(default=None, max_length=100)

    # node scope: a place in a captured webpage
    snapshot_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    node_id: str | None = Field(default=None, max_length=64)
    node_path: str | None = Field(default=None, max_length=500)
    section_path: tuple[str, ...] = ()
    token_ids: tuple[str, ...] = ()
    text_range: tuple[int, int] | None = None

    excerpt: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _has_location(self) -> Evidence:
        if self.excerpt is not None and not self.excerpt.strip():
            raise ValueError("excerpt must not be blank")

        page_fields = self.page is not None or self.bbox is not None or bool(self.word_ids)
        node_fields = (
            self.snapshot_sha256 is not None
            or self.node_id is not None
            or self.node_path is not None
            or bool(self.section_path)
            or bool(self.token_ids)
            or self.text_range is not None
        )

        if self.scope == "page":
            if node_fields:
                raise ValueError("page-scope evidence must not carry webpage fields")
            if self.page is None:
                raise ValueError("page-scope evidence must name a page")
            if self.bbox is None and not self.word_ids:
                raise ValueError("page-scope evidence needs word_ids or a bbox")
            if self.field is not None:
                raise ValueError("'field' is only allowed on document-scope evidence")

        elif self.scope == "document":
            if page_fields:
                raise ValueError("document-scope evidence must not name a page or location")
            # A title or description belongs to the whole source, not to any node,
            # so document scope stays the right home for it. When that source is a
            # webpage it still has to be provable, which is what the snapshot
            # fingerprint is for; the node-level fields remain forbidden.
            located_in_a_node = (
                self.node_id is not None
                or self.node_path is not None
                or bool(self.section_path)
                or bool(self.token_ids)
                or self.text_range is not None
            )
            if located_in_a_node:
                raise ValueError("document-scope evidence must not point inside a node")
            if not self.field:
                raise ValueError("document-scope evidence must name the field it refers to")

        else:  # node
            if page_fields:
                raise ValueError("node-scope evidence must not carry page or bbox fields")
            if self.field is not None:
                raise ValueError("'field' is only allowed on document-scope evidence")
            if not self.snapshot_sha256:
                raise ValueError("node-scope evidence must name the snapshot it came from")
            if not self.node_id:
                raise ValueError("node-scope evidence must name the node it came from")
            if not self.token_ids and self.text_range is None:
                raise ValueError("node-scope evidence needs token_ids or a text range")
            if self.text_range is not None:
                start, end = self.text_range
                if start < 0 or end <= start:
                    raise ValueError("a text range must be a positive span")
            if len(set(self.token_ids)) != len(self.token_ids):
                raise ValueError("token_ids must not repeat")
            if any(not token.startswith(f"{self.node_id}-") for token in self.token_ids):
                raise ValueError("every cited token must belong to the cited node")
        return self


class Change(_Frozen):
    id: str = Field(min_length=1, max_length=64)
    seq: int = Field(ge=0)
    kind: ChangeKind
    category: ChangeCategory
    subtype: str | None = Field(default=None, max_length=50)
    label: str | None = Field(default=None, max_length=200)
    old_value: str | None = Field(default=None, max_length=5000)
    new_value: str | None = Field(default=None, max_length=5000)
    # The calculated difference, where one is meaningful ("+27 (+4.31%)").
    delta: str | None = Field(default=None, max_length=200)
    evidence: tuple[Evidence, ...] = Field(min_length=1)
    # How certain the deterministic engine is that this pairing is right. It is
    # derived from measured evidence (alignment similarity), never guessed.
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    # Set when the engine believes this is not a meaningful change (e.g. "page number").
    noise_reason: str | None = Field(default=None, max_length=200)
    rule_importance: Importance | None = None

    @model_validator(mode="after")
    def _evidence_matches_kind(self) -> Change:
        sides = {e.side for e in self.evidence}
        if self.kind is ChangeKind.ADDED and Side.NEW not in sides:
            raise ValueError("an added change needs evidence from the new PDF")
        if self.kind is ChangeKind.REMOVED and Side.OLD not in sides:
            raise ValueError("a removed change needs evidence from the old PDF")
        if self.kind in (ChangeKind.MODIFIED, ChangeKind.MOVED) and sides != {Side.OLD, Side.NEW}:
            raise ValueError(f"a {self.kind.value} change needs evidence from both PDFs")
        if self.kind is ChangeKind.MODIFIED and (self.old_value is None or self.new_value is None):
            raise ValueError("a modified change must state both the old and the new value")
        if self.category is not ChangeCategory.METADATA and any(e.scope == "document" for e in self.evidence):
            raise ValueError("only metadata changes may use document-level evidence")
        scopes = {e.scope for e in self.evidence}
        if "node" in scopes and scopes - {"node"}:
            # A single change is evidenced from one source. Mixing a webpage node
            # with a document page would mean neither checker could verify it all.
            raise ValueError("a change cannot mix webpage evidence with document evidence")
        return self

    @property
    def change_type(self) -> ChangeType:
        return derive_change_type(self.kind, self.category)

    def evidence_pages(self, side: Side) -> set[int]:
        return {e.page for e in self.evidence if e.side is side and e.page is not None}


class AIAnnotation(_Frozen):
    """AI commentary on one existing change. Deliberately has no value or evidence fields."""

    change_id: str = Field(min_length=1, max_length=64)
    importance: Importance | None = None
    title: str | None = Field(default=None, max_length=120)
    explanation: str | None = Field(default=None, max_length=1000)
    impact: str | None = Field(default=None, max_length=1000)
    action_required: bool | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    needs_review: bool = False


class DocumentRef(_Frozen):
    """One side of a comparison, when that side is a paginated document."""

    kind: Literal["document"] = "document"
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    page_count: int = Field(ge=1)


class SnapshotRef(_Frozen):
    """One side of a comparison, when that side is a captured webpage.

    A webpage has no pages, so there is no page count here. Inventing one to fit
    the document shape would put a number in the result that nothing could
    verify. What a snapshot does have is the address it came from and how much
    content was found, and those are recorded instead.
    """

    kind: Literal["snapshot"] = "snapshot"
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    url: str = Field(min_length=1, max_length=2048)
    node_count: int = Field(ge=0)


class DocxRef(_Frozen):
    """One side of a comparison, when that side is a Word (.docx) document.

    A Word document has no fixed pages — pagination depends on the printer, the
    fonts and the window it is opened in — so, as for a webpage, no page count
    is recorded. The fingerprint is of the document's content, and it is what
    every piece of evidence from that document cites.
    """

    kind: Literal["docx"] = "docx"
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    node_count: int = Field(ge=0)


SourceRef = Annotated[DocumentRef | SnapshotRef | DocxRef, Field(discriminator="kind")]


class ComparisonResult(_Frozen):
    schema_version: Literal["1"] = RESULT_SCHEMA_VERSION
    engine_version: str
    old_document: SourceRef
    new_document: SourceRef
    changes: tuple[Change, ...] = ()
    annotations: tuple[AIAnnotation, ...] = ()

    @model_validator(mode="after")
    def _consistent(self) -> ComparisonResult:
        ids = [c.id for c in self.changes]
        if len(ids) != len(set(ids)):
            raise ValueError("change IDs must be unique")
        seqs = [c.seq for c in self.changes]
        if len(seqs) != len(set(seqs)):
            raise ValueError("change sequence numbers must be unique")

        sources = {Side.OLD: self.old_document, Side.NEW: self.new_document}
        for change in self.changes:
            for ev in change.evidence:
                source = sources[ev.side]
                if ev.page is not None:
                    if not isinstance(source, DocumentRef):
                        raise ValueError(
                            f"change {change.id} cites a page of the {ev.side.value} side, "
                            "which is a webpage or Word document and has none"
                        )
                    if ev.page > source.page_count:
                        raise ValueError(
                            f"change {change.id} cites page {ev.page} of the {ev.side.value} PDF, "
                            f"which has only {source.page_count} pages"
                        )
                # Content nodes exist in webpages and Word documents, never in a
                # paginated PDF.
                if ev.scope == "node" and not isinstance(source, SnapshotRef | DocxRef):
                    raise ValueError(
                        f"change {change.id} cites a content node on the {ev.side.value} side, "
                        "which is a paginated document"
                    )

        known = set(ids)
        annotated: set[str] = set()
        for ann in self.annotations:
            if ann.change_id not in known:
                raise ValueError(f"annotation refers to unknown change {ann.change_id!r}")
            if ann.change_id in annotated:
                raise ValueError(f"more than one annotation for change {ann.change_id!r}")
            annotated.add(ann.change_id)
        return self
