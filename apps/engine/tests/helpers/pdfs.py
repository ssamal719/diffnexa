"""Build small PDFs for tests. Deterministic (reportlab invariant mode)."""

from __future__ import annotations

import io

import pikepdf
from reportlab.pdfgen import canvas

A4 = (595.28, 841.89)


def text_pdf(
    pages: list[list[str]],
    *,
    font: str = "Helvetica",
    size: float = 12,
    title: str | None = None,
    author: str | None = None,
    link: tuple[str, tuple[float, float, float, float]] | None = None,
    page_size: tuple[float, float] = A4,
) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=page_size, invariant=1)
    if title:
        c.setTitle(title)
    if author:
        c.setAuthor(author)
    for page_index, lines in enumerate(pages):
        y = page_size[1] - 72
        for line in lines:
            c.setFont(font, size)
            c.drawString(72, y, line)
            y -= size + 8
        if link and page_index == 0:
            uri, rect = link
            c.linkURL(uri, rect, relative=0)
        c.showPage()
    c.save()
    return buf.getvalue()


def with_pikepdf(data: bytes, edit) -> bytes:
    """Apply `edit(pdf)` with pikepdf and return the new bytes."""
    with pikepdf.open(io.BytesIO(data)) as pdf:
        edit(pdf)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


def encrypted_pdf(data: bytes, user: str, owner: str = "owner-secret") -> bytes:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        out = io.BytesIO()
        pdf.save(out, encryption=pikepdf.Encryption(user=user, owner=owner))
        return out.getvalue()


def image_only_pdf() -> bytes:
    from PIL import Image
    from reportlab.lib.utils import ImageReader

    img = Image.new("L", (400, 560), color=200)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)
    c.drawImage(ImageReader(img), 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()
    return buf.getvalue()


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00"
    b"\x00\x00IEND\xaeB`\x82"
)


def padded_pdf(data: bytes, target_bytes: int) -> bytes:
    """A valid PDF grown past `target_bytes` by adding one large unused stream.

    Used to test size limits without shipping a large fixture file.
    """
    with pikepdf.open(io.BytesIO(data)) as pdf:
        padding = max(target_bytes - len(data), 1024)
        stream = pikepdf.Stream(pdf, b"0" * padding)
        stream.stream_dict["/Type"] = pikepdf.Name("/EmbeddedFile")
        pdf.Root["/DiffNexaTestPadding"] = pdf.make_indirect(stream)
        out = io.BytesIO()
        pdf.save(out, compress_streams=False)
        return out.getvalue()
