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

Every failure becomes a `DocxError` whose detail stays in the server log and
never contains document text.
"""

from __future__ import annotations

import io
import os
import posixpath
import re
import zipfile
import zlib
from dataclasses import dataclass, field

from lxml import etree

from diffnexa_engine.docx.errors import DocxError, DocxErrorCode

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

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
OFFICE_DOCUMENT = "/officeDocument"
CORE_PROPERTIES = "/metadata/core-properties"

OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_SIGNATURE = b"PK\x03\x04"
ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")


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
class Relationship:
    type: str
    target: str
    external: bool


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


# A DOCTYPE or entity declaration, in any letter case. Word never writes one;
# markup inside text is always escaped, so a literal one is never content.
_DECLARATION = re.compile(rb"<!\s*(?:doctype|entity)", re.IGNORECASE)

_PARSER = etree.XMLParser(
    resolve_entities=False,
    no_network=True,
    load_dtd=False,
    dtd_validation=False,
    huge_tree=False,
    remove_comments=True,
    remove_pis=True,
)


def parse_xml(data: bytes, what: str) -> etree._Element:
    """Parse one XML part, refusing anything a Word document never contains."""
    if _DECLARATION.search(data):
        raise DocxError(DocxErrorCode.UNREADABLE, f"{what} declares a DOCTYPE or entity")
    try:
        return etree.fromstring(data, parser=_PARSER)
    except (etree.XMLSyntaxError, ValueError) as exc:
        raise DocxError(DocxErrorCode.UNREADABLE, f"{what} is not well-formed XML") from exc


def _safe_name(name: str) -> bool:
    if not name or "\x00" in name or "\\" in name or name.startswith("/"):
        return False
    parts = name.split("/")
    if any(part == ".." for part in parts):
        return False
    return ":" not in parts[0]


def _resolve(base_dir: str, target: str) -> str | None:
    """A relationship target as a member name, or None if it leaves the archive."""
    if target.startswith("/"):
        joined = target.lstrip("/")
    else:
        joined = posixpath.join(base_dir, target)
    resolved = posixpath.normpath(joined)
    if resolved.startswith("../") or resolved == ".." or resolved.startswith("/"):
        return None
    return resolved


class _Reader:
    def __init__(self, archive: zipfile.ZipFile, limits: DocxLimits) -> None:
        self.archive = archive
        self.limits = limits
        self.total = 0
        self.names = {info.filename: info for info in archive.infolist()}

    def has(self, name: str) -> bool:
        return name in self.names

    def read(self, name: str, ceiling: int) -> bytes:
        """Decompress one member, stopping the moment it passes its ceiling.

        The archive's own size fields are not trusted: the stream is read with
        a hard limit, so a part that lies about its size is caught by what it
        actually produces.
        """
        info = self.names[name]
        try:
            with self.archive.open(info) as stream:
                data = stream.read(ceiling + 1)
        except (zipfile.BadZipFile, zlib.error, EOFError, RuntimeError, NotImplementedError, OSError) as exc:
            raise DocxError(DocxErrorCode.UNREADABLE, f"cannot decompress {name}") from exc
        if len(data) > ceiling:
            raise DocxError(DocxErrorCode.TOO_LARGE, f"{name} decompresses past {ceiling} bytes")
        self.total += len(data)
        if self.total > self.limits.max_total_bytes:
            raise DocxError(DocxErrorCode.TOO_LARGE, "decompressed parts exceed the total ceiling")
        return data

    def xml(self, name: str, ceiling: int | None = None) -> etree._Element:
        return parse_xml(self.read(name, ceiling or self.limits.max_part_bytes), name)


def _relationships(reader: _Reader, rels_name: str, base_dir: str) -> dict[str, Relationship]:
    if not reader.has(rels_name):
        return {}
    root = reader.xml(rels_name)
    found: dict[str, Relationship] = {}
    for rel in root.iter(f"{{{REL_NS}}}Relationship"):
        rel_id = rel.get("Id") or ""
        rel_type = rel.get("Type") or ""
        target = rel.get("Target") or ""
        external = (rel.get("TargetMode") or "").lower() == "external"
        if not rel_id or not target:
            continue
        if external:
            found[rel_id] = Relationship(rel_type, target, True)
            continue
        resolved = _resolve(base_dir, target)
        if resolved is not None:
            found[rel_id] = Relationship(rel_type, resolved, False)
    return found


def _check_container(data: bytes, limits: DocxLimits) -> None:
    if not data:
        raise DocxError(DocxErrorCode.EMPTY_FILE, "no bytes")
    if len(data) > limits.max_file_bytes:
        raise DocxError(DocxErrorCode.TOO_LARGE, f"{len(data)} bytes")
    if data.startswith(OLE_SIGNATURE):
        # Both an old .doc and a password-protected .docx are OLE containers;
        # an encrypted package names its stream "EncryptedPackage".
        if ENCRYPTED_PACKAGE in data:
            raise DocxError(DocxErrorCode.ENCRYPTED, "OLE container holding an encrypted package")
        raise DocxError(DocxErrorCode.LEGACY_DOC, "OLE compound file")
    if not data.startswith(ZIP_SIGNATURE):
        raise DocxError(DocxErrorCode.NOT_DOCX, "no ZIP signature")


def _check_members(archive: zipfile.ZipFile, limits: DocxLimits) -> None:
    infos = archive.infolist()
    if len(infos) > limits.max_entries:
        raise DocxError(DocxErrorCode.TOO_COMPLEX, f"{len(infos)} archive entries")
    seen: set[str] = set()
    for info in infos:
        name = info.filename
        if not _safe_name(name):
            raise DocxError(DocxErrorCode.UNREADABLE, "unsafe member name")
        if name in seen:
            raise DocxError(DocxErrorCode.UNREADABLE, "duplicate member name")
        seen.add(name)
        if info.flag_bits & 0x1:
            raise DocxError(DocxErrorCode.ENCRYPTED, "encrypted ZIP member")
        if posixpath.basename(name).lower() == "vbaproject.bin":
            raise DocxError(DocxErrorCode.MACRO_ENABLED, "contains a VBA project")


def _main_part(reader: _Reader) -> tuple[str, str | None]:
    """The main document's member name, and the core properties' if present."""
    if not reader.has("[Content_Types].xml") or not reader.has("_rels/.rels"):
        raise DocxError(DocxErrorCode.NOT_DOCX, "not an Open XML package")
    package_rels = _relationships(reader, "_rels/.rels", "")
    main = next(
        (
            rel.target
            for rel in package_rels.values()
            if not rel.external and rel.type.endswith(OFFICE_DOCUMENT)
        ),
        None,
    )
    if main is None or not reader.has(main):
        raise DocxError(DocxErrorCode.NOT_DOCX, "no main document part")
    core = next(
        (
            rel.target
            for rel in package_rels.values()
            if not rel.external and rel.type.endswith(CORE_PROPERTIES)
        ),
        None,
    )

    types = reader.xml("[Content_Types].xml")
    content_type = None
    for override in types.iter(f"{{{CT_NS}}}Override"):
        if (override.get("PartName") or "").lstrip("/") == main:
            content_type = (override.get("ContentType") or "").strip().lower()
    if content_type in MACRO_TYPES:
        raise DocxError(DocxErrorCode.MACRO_ENABLED, "macro-enabled main document")
    if content_type != DOCX_MAIN:
        raise DocxError(DocxErrorCode.NOT_DOCX, f"main part type {content_type!r}")
    return main, core if core and reader.has(core) else None


def open_package(data: bytes, limits: DocxLimits | None = None) -> DocxPackage:
    """Validate and parse the parts of a .docx needed to read its text."""
    limits = limits or DocxLimits()
    _check_container(data, limits)
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, NotImplementedError, OSError) as exc:
        raise DocxError(DocxErrorCode.UNREADABLE, "not a readable ZIP archive") from exc

    with archive:
        _check_members(archive, limits)
        reader = _Reader(archive, limits)
        main, core_name = _main_part(reader)

        base_dir = posixpath.dirname(main)
        rels_name = posixpath.join(base_dir, "_rels", posixpath.basename(main) + ".rels")
        relationships = _relationships(reader, rels_name, base_dir)

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
