"""Reading an untrusted Office Open XML package safely, entirely in memory.

Word (.docx) and Excel (.xlsx) files are both ZIP archives of XML parts, and
both layers can be hostile:

* **The archive.** A ZIP can claim tiny sizes and expand to gigabytes, carry
  names like `../../etc/passwd`, repeat a name so different readers see
  different files, or hold thousands of entries. Nothing is ever extracted to
  disk: each part that is needed is read into memory with a hard ceiling on how
  many bytes decompression may produce, whatever the archive claims.
* **The XML.** XML can declare entities that expand exponentially, or point at
  files and network addresses. The parser never loads a DTD, never resolves an
  entity and never touches the network, and any part carrying a DOCTYPE or an
  entity declaration is refused — Office never writes one.

Every failure is a `PackageProblem` with a kind the format's own reader turns
into its own error code. Details name the problem, never the file's content.
"""

from __future__ import annotations

import io
import posixpath
import re
import zipfile
import zlib
from dataclasses import dataclass
from typing import Literal

from lxml import etree

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
OFFICE_DOCUMENT = "/officeDocument"
CORE_PROPERTIES = "/metadata/core-properties"

OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_SIGNATURE = b"PK\x03\x04"
ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")

ProblemKind = Literal["not_package", "unreadable", "too_large", "too_complex", "encrypted", "macro"]


class PackageProblem(Exception):
    """Something wrong with the package itself, before its content is read."""

    def __init__(self, kind: ProblemKind, detail: str) -> None:
        super().__init__(detail)
        self.kind: ProblemKind = kind
        self.detail = detail


# A DOCTYPE or entity declaration, in any letter case. Office never writes one;
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
    """Parse one XML part, refusing anything an Office file never contains."""
    if _DECLARATION.search(data):
        raise PackageProblem("unreadable", f"{what} declares a DOCTYPE or entity")
    try:
        return etree.fromstring(data, parser=_PARSER)
    except (etree.XMLSyntaxError, ValueError) as exc:
        raise PackageProblem("unreadable", f"{what} is not well-formed XML") from exc


def safe_name(name: str) -> bool:
    """A member name that stays inside the archive."""
    if not name or "\x00" in name or "\\" in name or name.startswith("/"):
        return False
    parts = name.split("/")
    if any(part == ".." for part in parts):
        return False
    return ":" not in parts[0]


def resolve(base_dir: str, target: str) -> str | None:
    """A relationship target as a member name, or None if it leaves the archive."""
    if target.startswith("/"):
        joined = target.lstrip("/")
    else:
        joined = posixpath.join(base_dir, target)
    resolved = posixpath.normpath(joined)
    if resolved.startswith("../") or resolved == ".." or resolved.startswith("/"):
        return None
    return resolved


def container_kind(data: bytes) -> Literal["zip", "ole", "ole-encrypted", "other"]:
    """What kind of file this is, from its first bytes.

    Legacy Office files (.doc, .xls) and password-protected modern ones are both
    OLE compound files; an encrypted package names its stream "EncryptedPackage".
    """
    if data.startswith(OLE_SIGNATURE):
        return "ole-encrypted" if ENCRYPTED_PACKAGE in data else "ole"
    if data.startswith(ZIP_SIGNATURE):
        return "zip"
    return "other"


def open_zip(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, NotImplementedError, OSError) as exc:
        raise PackageProblem("unreadable", "not a readable ZIP archive") from exc


def check_members(archive: zipfile.ZipFile, max_entries: int) -> None:
    """Refuse archives with too many entries, unsafe or repeated names, encrypted
    members, or a VBA project."""
    infos = archive.infolist()
    if len(infos) > max_entries:
        raise PackageProblem("too_complex", f"{len(infos)} archive entries")
    seen: set[str] = set()
    for info in infos:
        name = info.filename
        if not safe_name(name):
            raise PackageProblem("unreadable", "unsafe member name")
        if name in seen:
            raise PackageProblem("unreadable", "duplicate member name")
        seen.add(name)
        if info.flag_bits & 0x1:
            raise PackageProblem("encrypted", "encrypted ZIP member")
        if posixpath.basename(name).lower() == "vbaproject.bin":
            raise PackageProblem("macro", "contains a VBA project")


@dataclass
class Relationship:
    type: str
    target: str
    external: bool


class PartReader:
    """Reads named parts of an open archive, each with its own ceiling, and all
    of them together under one total."""

    def __init__(self, archive: zipfile.ZipFile, max_total_bytes: int, max_part_bytes: int) -> None:
        self.archive = archive
        self.max_total_bytes = max_total_bytes
        self.max_part_bytes = max_part_bytes
        self.total = 0
        self.names = {info.filename: info for info in archive.infolist()}

    def has(self, name: str) -> bool:
        return name in self.names

    def read(self, name: str, ceiling: int) -> bytes:
        """Decompress one member, stopping the moment it passes its ceiling.

        The archive's own size fields are not trusted: the stream is read with a
        hard limit, so a part that lies about its size is caught by what it
        actually produces.
        """
        info = self.names[name]
        try:
            with self.archive.open(info) as stream:
                data = stream.read(ceiling + 1)
        except (zipfile.BadZipFile, zlib.error, EOFError, RuntimeError, NotImplementedError, OSError) as exc:
            raise PackageProblem("unreadable", f"cannot decompress {name}") from exc
        if len(data) > ceiling:
            raise PackageProblem("too_large", f"{name} decompresses past {ceiling} bytes")
        self.total += len(data)
        if self.total > self.max_total_bytes:
            raise PackageProblem("too_large", "decompressed parts exceed the total ceiling")
        return data

    def xml(self, name: str, ceiling: int | None = None) -> etree._Element:
        return parse_xml(self.read(name, ceiling or self.max_part_bytes), name)

    def relationships(self, rels_name: str, base_dir: str) -> dict[str, Relationship]:
        """A part's relationships. Internal targets are resolved inside the
        archive; anything that would leave it is dropped. External targets are
        kept as text and never opened."""
        if not self.has(rels_name):
            return {}
        root = self.xml(rels_name)
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
            resolved = resolve(base_dir, target)
            if resolved is not None:
                found[rel_id] = Relationship(rel_type, resolved, False)
        return found

    def part_relationships(self, part: str) -> dict[str, Relationship]:
        base_dir = posixpath.dirname(part)
        return self.relationships(
            posixpath.join(base_dir, "_rels", posixpath.basename(part) + ".rels"), base_dir
        )

    def main_part(self) -> tuple[str, str | None, str | None]:
        """The main part's member name, its declared content type, and the core
        properties part if there is one."""
        if not self.has("[Content_Types].xml") or not self.has("_rels/.rels"):
            raise PackageProblem("not_package", "not an Open XML package")
        package_rels = self.relationships("_rels/.rels", "")
        main = next(
            (
                rel.target
                for rel in package_rels.values()
                if not rel.external and rel.type.endswith(OFFICE_DOCUMENT)
            ),
            None,
        )
        if main is None or not self.has(main):
            raise PackageProblem("not_package", "no main document part")
        core = next(
            (
                rel.target
                for rel in package_rels.values()
                if not rel.external and rel.type.endswith(CORE_PROPERTIES)
            ),
            None,
        )
        types = self.xml("[Content_Types].xml")
        content_type = None
        for override in types.iter(f"{{{CT_NS}}}Override"):
            if (override.get("PartName") or "").lstrip("/") == main:
                content_type = (override.get("ContentType") or "").strip().lower()
        return main, content_type, core if core and self.has(core) else None


__all__ = [
    "CT_NS",
    "OLE_SIGNATURE",
    "PackageProblem",
    "PartReader",
    "REL_NS",
    "Relationship",
    "ZIP_SIGNATURE",
    "check_members",
    "container_kind",
    "open_zip",
    "parse_xml",
    "resolve",
    "safe_name",
]
