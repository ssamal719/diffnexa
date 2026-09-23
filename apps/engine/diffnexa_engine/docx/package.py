"""Opening an untrusted .docx safely, entirely in memory.

A .docx is a ZIP archive of XML files, and both layers can be hostile:

* **The archive.** A ZIP can claim tiny sizes and expand to gigabytes, carry
  names like `../../etc/passwd`, repeat a name so different readers see
  different files, or hold thousands of entries. Nothing here is ever extracted
  to disk: each part that is needed is read into memory with a hard ceiling on
  how many bytes decompression may produce, whatever the archive claims.
* **The XML.** XML can declare entities that expand exponentially, or point at
  files and network addresses. The parser never loads a DTD, never resolves an
  entity and never touches the network, and any part carrying a DOCTYPE at all
  is refused — Word never writes one.

Only the parts needed to read the document's text are opened: the package and
document relationships, the content types, the main document, its styles and
numbering definitions, and the core properties. Images, macros, embedded files,
headers, footers, comments and everything else are never decompressed.

The archive and XML safety rules live in `diffnexa_engine.ooxml.safety`, shared
with Excel Compare. Every failure becomes a `DocxError` whose detail stays in
the server log and never contains document text.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

from lxml import etree

from diffnexa_engine.docx.errors import DocxError, DocxErrorCode
from diffnexa_engine.ooxml import safety
from diffnexa_engine.ooxml.safety import PackageProblem, PartReader, Relationship

MIB = 1024 * 1024

# Word's own content type for an ordinary document, and the ones refused.
DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
DOCX_TEMPLATE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
MACRO_TYPES = frozenset(
    {
        "application/vnd.ms-word.document.macroenabled.main+xml",
        "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
    }
)

# The archive and XML rules are shared with every Office format DiffNexa reads.
OLE_SIGNATURE = safety.OLE_SIGNATURE
ZIP_SIGNATURE = safety.ZIP_SIGNATURE

_PROBLEM_CODES = {
    "not_package": DocxErrorCode.NOT_DOCX,
    "unreadable": DocxErrorCode.UNREADABLE,
    "too_large": DocxErrorCode.TOO_LARGE,
    "too_complex": DocxErrorCode.TOO_COMPLEX,
    "encrypted": DocxErrorCode.ENCRYPTED,
    "macro": DocxErrorCode.MACRO_ENABLED,
}


@contextmanager
def _as_docx_errors() -> Iterator[None]:
    try:
        yield
    except PackageProblem as problem:
        raise DocxError(_PROBLEM_CODES[problem.kind], problem.detail) from problem


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class DocxLimits:
    """Ceilings on what one upload may cost. Each is a refusal, never a truncation."""

    max_file_bytes: int = 20 * MIB
    max_entries: int = 5_000
    max_document_bytes: int = 40 * MIB  # the decompressed main document
    max_part_bytes: int = 8 * MIB  # styles, numbering, relationships, properties
    max_total_bytes: int = 64 * MIB  # everything decompressed for one file
    max_nodes: int = 20_000

    @classmethod
    def from_env(cls) -> DocxLimits:
        return cls(max_file_bytes=_int_env("DIFFNEXA_DOCX_MAX_FILE_MB", 20) * MIB)


@dataclass
class DocxPackage:
    """The parsed parts of one document that the extractor needs."""

    document: etree._Element
    styles: etree._Element | None
    numbering: etree._Element | None
    core: etree._Element | None
    relationships: dict[str, Relationship] = field(default_factory=dict)
    #: Relationship types present on the main document, used only to say what
    #: the document contains that is not compared (headers, comments, ...).
    related_types: frozenset[str] = frozenset()


def parse_xml(data: bytes, what: str) -> etree._Element:
    """Parse one XML part, refusing anything a Word document never contains."""
    with _as_docx_errors():
        return safety.parse_xml(data, what)


def _check_container(data: bytes, limits: DocxLimits) -> None:
    if not data:
        raise DocxError(DocxErrorCode.EMPTY_FILE, "no bytes")
    if len(data) > limits.max_file_bytes:
        raise DocxError(DocxErrorCode.TOO_LARGE, f"{len(data)} bytes")
    kind = safety.container_kind(data)
    if kind == "ole-encrypted":
        raise DocxError(DocxErrorCode.ENCRYPTED, "OLE container holding an encrypted package")
    if kind == "ole":
        raise DocxError(DocxErrorCode.LEGACY_DOC, "OLE compound file")
    if kind != "zip":
        raise DocxError(DocxErrorCode.NOT_DOCX, "no ZIP signature")


def open_package(data: bytes, limits: DocxLimits | None = None) -> DocxPackage:
    """Validate and parse the parts of a .docx needed to read its text."""
    limits = limits or DocxLimits()
    _check_container(data, limits)
    with _as_docx_errors():
        archive = safety.open_zip(data)
        with archive:
            safety.check_members(archive, limits.max_entries)
            reader = PartReader(archive, limits.max_total_bytes, limits.max_part_bytes)
            main, content_type, core_name = reader.main_part()
            if content_type in MACRO_TYPES:
                raise DocxError(DocxErrorCode.MACRO_ENABLED, "macro-enabled main document")
            if content_type != DOCX_MAIN:
                raise DocxError(DocxErrorCode.NOT_DOCX, f"main part type {content_type!r}")

            relationships = reader.part_relationships(main)

            def related(suffix: str) -> etree._Element | None:
                for rel in relationships.values():
                    if not rel.external and rel.type.endswith(suffix) and reader.has(rel.target):
                        return reader.xml(rel.target)
                return None

            document = reader.xml(main, limits.max_document_bytes)
            return DocxPackage(
                document=document,
                styles=related("/styles"),
                numbering=related("/numbering"),
                core=reader.xml(core_name) if core_name else None,
                relationships=relationships,
                related_types=frozenset(rel.type.rsplit("/", 1)[-1] for rel in relationships.values()),
            )


__all__ = ["DocxLimits", "DocxPackage", "Relationship", "open_package", "parse_xml"]
