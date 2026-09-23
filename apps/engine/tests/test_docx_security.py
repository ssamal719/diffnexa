"""Hostile and unsupported files are refused safely.

A .docx is a ZIP of XML, so both layers are attacked here: archives that
expand without limit, names that try to escape, duplicated names, too many
entries, XML entity tricks, and content that points at the network. Every case
must end in a clear DocxError, never an exception, a hang, a file on disk or a
network request.
"""

from __future__ import annotations

import io
import warnings
import zipfile

import pytest

from diffnexa_engine.docx import DocxError, DocxErrorCode, DocxLimits, extract_docx
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.web.snapshot import NodeRole

from .helpers.docx_files import body, package, paragraph, word
from .helpers.stub_server import StubServer

GOOD = body(paragraph("An ordinary sentence."))


def refused(data: bytes, limits: DocxLimits | None = None) -> DocxErrorCode:
    with pytest.raises(DocxError) as caught:
        extract_docx(data, limits)
    # The detail is for the server log and never quotes document text.
    assert "ordinary sentence" not in caught.value.detail
    return caught.value.code


# ---------------------------------------------------------------- not a .docx


def test_an_empty_file_is_refused():
    assert refused(b"") is DocxErrorCode.EMPTY_FILE


def test_a_pdf_is_not_a_docx():
    assert refused(b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n") is DocxErrorCode.NOT_DOCX


def test_a_legacy_doc_file_is_named_as_such():
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 1024
    assert refused(ole) is DocxErrorCode.LEGACY_DOC


def test_a_password_protected_document_is_named_as_such():
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + "EncryptedPackage".encode("utf-16-le")
    assert refused(ole) is DocxErrorCode.ENCRYPTED


def test_a_zip_that_is_not_an_office_document_is_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "hello")
    assert refused(buffer.getvalue()) is DocxErrorCode.NOT_DOCX


def test_a_spreadsheet_is_not_a_docx():
    xlsx_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
    assert refused(package(GOOD, content_type=xlsx_type)) is DocxErrorCode.NOT_DOCX


def test_a_word_template_is_not_a_docx():
    template = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
    assert refused(package(GOOD, content_type=template)) is DocxErrorCode.NOT_DOCX


# ---------------------------------------------------------------- macros


def test_a_macro_enabled_document_is_refused():
    docm = "application/vnd.ms-word.document.macroEnabled.main+xml"
    assert refused(package(GOOD, content_type=docm)) is DocxErrorCode.MACRO_ENABLED


def test_a_docx_carrying_a_vba_project_is_refused():
    data = package(GOOD, members=[("word/vbaProject.bin", b"\x00\x01macro")])
    assert refused(data) is DocxErrorCode.MACRO_ENABLED


# ---------------------------------------------------------------- the archive


def test_an_oversized_file_is_refused_before_it_is_opened():
    data = package(GOOD)
    assert refused(data, DocxLimits(max_file_bytes=len(data) - 1)) is DocxErrorCode.TOO_LARGE


def test_the_default_file_size_limit_is_twenty_megabytes():
    assert DocxLimits().max_file_bytes == 20 * 1024 * 1024


def test_a_zip_bomb_is_stopped_at_the_decompression_ceiling():
    """A few kilobytes that expand past the main document ceiling."""
    padding = " " * (41 * 1024 * 1024)
    bomb = body(f'<w:p><w:r><w:t xml:space="preserve">{padding}</w:t></w:r></w:p>')
    data = package(bomb)
    assert len(data) < 200 * 1024
    assert refused(data) is DocxErrorCode.TOO_LARGE


def test_the_total_decompressed_size_is_capped():
    big = body(paragraph("x" * (2 * 1024 * 1024)))
    assert refused(package(big), DocxLimits(max_total_bytes=1024 * 1024)) is DocxErrorCode.TOO_LARGE


@pytest.mark.parametrize(
    "name", ["../evil.xml", "word/../../evil.xml", "/etc/evil.xml", "word\\evil.xml", "C:/evil.xml"]
)
def test_member_names_that_try_to_escape_are_refused(name):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        data = package(GOOD, members=[(name, "x")])
    assert refused(data) is DocxErrorCode.UNREADABLE


def test_a_duplicated_member_name_is_refused():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        data = package(GOOD, members=[("word/document.xml", body(paragraph("A different document.")))])
    assert refused(data) is DocxErrorCode.UNREADABLE


def test_too_many_archive_entries_is_refused():
    data = package(GOOD, members=[(f"word/media/{i}.bin", b"") for i in range(30)])
    assert refused(data, DocxLimits(max_entries=10)) is DocxErrorCode.TOO_COMPLEX


def _mark_encrypted(data: bytes, name: str) -> bytes:
    """Set the "encrypted" bit on one member, in both headers that carry it.

    Python's zipfile clears this bit when writing, so the fixture edits the
    archive bytes directly, as a hostile tool would produce them.
    """
    raw = bytearray(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.getinfo(name)
    local = info.header_offset
    assert raw[local : local + 4] == b"PK\x03\x04"
    raw[local + 6] |= 0x1
    central = raw.rfind(b"PK\x01\x02", 0, len(raw))
    while central != -1:
        name_length = int.from_bytes(raw[central + 28 : central + 30], "little")
        if raw[central + 46 : central + 46 + name_length] == name.encode():
            raw[central + 8] |= 0x1
            break
        central = raw.rfind(b"PK\x01\x02", 0, central)
    return bytes(raw)


def test_an_encrypted_zip_member_is_refused():
    data = _mark_encrypted(package(GOOD, members=[("word/extra.xml", b"<x/>")]), "word/extra.xml")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.getinfo("word/extra.xml").flag_bits & 0x1, "the fixture really is flagged"
    assert refused(data) is DocxErrorCode.ENCRYPTED


def test_a_truncated_archive_is_refused():
    data = package(GOOD)
    assert refused(data[: len(data) // 2]) is DocxErrorCode.UNREADABLE


def test_malformed_xml_is_refused():
    assert refused(package("<w:document><w:body><w:p>")) is DocxErrorCode.UNREADABLE


def test_nothing_is_written_to_disk(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    extract_docx(package(GOOD))
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------- XML entities and the network


@pytest.fixture
def server():
    stub = StubServer()
    try:
        yield stub
    finally:
        stub.stop()


def test_an_external_entity_is_never_resolved(server):
    xxe = (
        f'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "{server.url("/secret")}">'
        '<!ENTITY y SYSTEM "file:///etc/passwd">]>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>&x;&y;</w:t></w:r></w:p></w:body></w:document>"
    )
    assert refused(package(xxe)) is DocxErrorCode.UNREADABLE
    assert server.requests == []


def test_entity_expansion_is_refused():
    laughs = (
        '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">'
        '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;">]>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>&c;</w:t></w:r></w:p></w:body></w:document>"
    )
    assert refused(package(laughs)) is DocxErrorCode.UNREADABLE


def test_links_and_external_images_are_never_fetched(server):
    rels = (
        f'<Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        f'relationships/hyperlink" Target="{server.url("/link")}" TargetMode="External"/>'
        f'<Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        f'relationships/image" Target="{server.url("/image.png")}" TargetMode="External"/>'
        '<Relationship Id="rFile" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/hyperlink" Target="file:///etc/passwd" TargetMode="External"/>'
        '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/styles" Target="../../../etc/passwd"/>'
    )
    xml = body(
        '<w:p><w:hyperlink r:id="rLink"><w:r><w:t>Our site</w:t></w:r></w:hyperlink></w:p>'
        '<w:p><w:hyperlink r:id="rFile"><w:r><w:t>Local file</w:t></w:r></w:hyperlink></w:p>'
        "<w:p><w:r><w:drawing/></w:r></w:p>"
    )
    first = extract_docx(package(xml, document_rels=rels))
    second = extract_docx(package(xml, document_rels=rels))
    compare_docx(first, second)

    assert server.requests == [], "no request was made for anything the document points at"
    links = [(node.text, node.href) for node in first.nodes if node.role is NodeRole.LINK]
    assert links == [("Our site", server.url("/link"))], "only web and mail links are recorded"


def test_a_real_word_file_still_reads_after_all_these_checks():
    document = extract_docx(word(lambda d: d.add_paragraph("Everything is fine.")))
    assert [node.text for node in document.nodes] == ["Everything is fine."]
