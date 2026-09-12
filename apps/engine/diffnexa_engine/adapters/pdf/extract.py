"""PDF → canonical Document.

Accuracy decisions made here (each is covered by tests):

* Only the *visible* page area counts. If a page has a CropBox, text outside it
  is invisible in every viewer, so it is excluded instead of producing phantom
  changes. Words entirely off the page are dropped and counted in warnings.
* Rotated pages are read upright first, then coordinates are converted to the
  displayed orientation. Reading a rotated page directly splits words into
  fragments, which would create false changes.
* Duplicate overlapping characters (a common "fake bold" trick) are removed
  before words are formed.
* Pages with no text are flagged, and pages whose text can't be mapped to real
  characters are marked unreadable, so they are never silently mis-compared.

Stage 1 extracts words, images, links, page geometry and metadata. Reading
order, headings, lines/blocks and tables arrive in Stage 2.
"""

from __future__ import annotations

import io
import re
from typing import Any

import pdfplumber
import pikepdf

from diffnexa_engine import ENGINE_VERSION
from diffnexa_engine.adapters.pdf.probe import probe_pdf
from diffnexa_engine.config import EngineLimits
from diffnexa_engine.errors import DocumentError, ErrorCode
from diffnexa_engine.model.document import (
    BBox,
    Document,
    DocumentMetadata,
    DocumentSource,
    ExtractionInfo,
    ImageRegion,
    LinkRegion,
    Page,
    TextLayerStatus,
    Word,
)

FONT_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
BOLD_HINT = re.compile(r"bold|black|heavy|semibold|demi", re.IGNORECASE)
ITALIC_HINT = re.compile(r"italic|oblique", re.IGNORECASE)
CID_TOKEN = re.compile(r"\(cid:\d+\)")
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
PDF_DATE = re.compile(r"^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?")

SCANNED_IMAGE_COVERAGE = 0.5
UNREADABLE_MIN_BAD_GLYPHS = 5
UNREADABLE_RATIO = 0.3
COORD_DECIMALS = 2
METADATA_MAX_CHARS = 300


def _extractor_label() -> str:
    return f"pdfplumber {pdfplumber.__version__} / pikepdf {pikepdf.__version__}"


# ---------------------------------------------------------------- small helpers


def clean_font_name(raw: Any) -> str | None:
    if not raw:
        return None
    name = FONT_SUBSET_PREFIX.sub("", str(raw)).strip()
    return name or None


def _clean_text(value: Any, limit: int = METADATA_MAX_CHARS) -> str | None:
    try:
        text = str(value)
    except Exception:
        return None
    text = CONTROL_CHARS.sub(" ", text).strip()
    return text[:limit] or None


def parse_pdf_date(raw: Any) -> str | None:
    text = _clean_text(raw)
    if text is None:
        return None
    match = PDF_DATE.match(text)
    if not match:
        return text
    year, month, day, hour, minute, second = match.groups()
    iso = year + (f"-{month}" if month else "") + (f"-{day}" if day and month else "")
    if hour and day and month:
        iso += f"T{hour}:{minute or '00'}" + (f":{second}" if second else "")
    return iso


def classify_text_layer(texts: list[str]) -> TextLayerStatus:
    """Decide whether a page's text is usable.

    Unmapped glyphs show up as "(cid:NN)" tokens, U+FFFD, or private-use
    characters. If enough of the page is made of them, comparing the text would
    produce nonsense, so the page is marked unreadable.
    """
    bad = good = 0
    for text in texts:
        bad += len(CID_TOKEN.findall(text))
        for ch in CID_TOKEN.sub("", text):
            if ch == "\ufffd" or 0xE000 <= ord(ch) <= 0xF8FF:
                bad += 1
            elif not ch.isspace():
                good += 1
    total = bad + good
    if total == 0:
        return TextLayerStatus.ABSENT
    if bad >= UNREADABLE_MIN_BAD_GLYPHS and bad / total >= UNREADABLE_RATIO:
        return TextLayerStatus.UNREADABLE
    return TextLayerStatus.PRESENT


def to_display_coords(
    x0: float, top: float, x1: float, bottom: float, width: float, height: float, rotation: int
) -> tuple[float, float, float, float]:
    """Convert a box on the upright page (width × height) to displayed orientation.

    Rotation follows the PDF /Rotate convention: clockwise degrees.
    """
    if rotation == 0:
        return x0, top, x1, bottom
    if rotation == 90:
        return height - bottom, x0, height - top, x1
    if rotation == 180:
        return width - x1, height - bottom, width - x0, height - top
    if rotation == 270:
        return top, width - x1, bottom, width - x0
    raise ValueError(f"unsupported rotation {rotation}")


def _clip(box: tuple[float, float, float, float], width: float, height: float) -> BBox | None:
    x0, y0, x1, y1 = box
    cx0, cy0 = max(0.0, x0), max(0.0, y0)
    cx1, cy1 = min(width, x1), min(height, y1)
    if cx1 <= cx0 or cy1 <= cy0:
        return None
    r = COORD_DECIMALS
    return BBox(x0=round(cx0, r), y0=round(cy0, r), x1=round(cx1, r), y1=round(cy1, r))


def _effective_rotation(page_obj: pikepdf.Dictionary) -> tuple[int, bool]:
    """Return (rotation, was_valid). /Rotate may be inherited from parent nodes."""
    node: Any = page_obj
    for _ in range(64):  # guard against malicious parent loops
        if node is None:
            break
        if "/Rotate" in node:
            try:
                value = int(node.Rotate) % 360
            except Exception:
                return 0, False
            return (value, True) if value in (0, 90, 180, 270) else (0, False)
        node = node.get("/Parent")
    return 0, True


def _visible_box(page: pikepdf.Page) -> pikepdf.Array | None:
    """Intersection of MediaBox and CropBox, or None if the page isn't cropped."""
    media = [float(v) for v in page.mediabox]
    crop = [float(v) for v in page.cropbox]
    m = (min(media[0], media[2]), min(media[1], media[3]), max(media[0], media[2]), max(media[1], media[3]))
    c = (min(crop[0], crop[2]), min(crop[1], crop[3]), max(crop[0], crop[2]), max(crop[1], crop[3]))
    visible = (max(m[0], c[0]), max(m[1], c[1]), min(m[2], c[2]), min(m[3], c[3]))
    if visible == m:
        return None
    if visible[2] <= visible[0] or visible[3] <= visible[1]:
        return None  # nonsensical crop; keep the media box
    return pikepdf.Array(list(visible))


def _read_metadata(pdf: pikepdf.Pdf) -> DocumentMetadata:
    info = pdf.docinfo
    fields = {
        "title": "/Title",
        "author": "/Author",
        "subject": "/Subject",
        "creator": "/Creator",
        "producer": "/Producer",
    }
    values: dict[str, str | None] = {}
    for name, key in fields.items():
        values[name] = _clean_text(info[key]) if key in info else None
    values["creation_date"] = parse_pdf_date(info["/CreationDate"]) if "/CreationDate" in info else None
    values["modification_date"] = parse_pdf_date(info["/ModDate"]) if "/ModDate" in info else None
    return DocumentMetadata(**values)


# ---------------------------------------------------------------- page extraction


def _extract_page(ppage: Any, number: int, rotation: int, label: str | None, warnings: list[str]) -> Page:
    ox, oy, ox1, oy1 = (float(v) for v in ppage.bbox)
    upright_w, upright_h = ox1 - ox, oy1 - oy
    if rotation in (90, 270):
        width, height = upright_h, upright_w
    else:
        width, height = upright_w, upright_h

    def display_box(obj: dict[str, Any]) -> BBox | None:
        box = to_display_coords(
            float(obj["x0"]) - ox,
            float(obj["top"]) - oy,
            float(obj["x1"]) - ox,
            float(obj["bottom"]) - oy,
            upright_w,
            upright_h,
            rotation,
        )
        return _clip(box, width, height)

    cleaned = ppage.dedupe_chars()
    raw_words = cleaned.extract_words(extra_attrs=["fontname", "size"])
    words: list[Word] = []
    off_page = 0
    for raw in raw_words:
        text = raw.get("text", "")
        if not text or not text.strip():
            continue
        bbox = display_box(raw)
        if bbox is None:
            off_page += 1
            continue
        font = clean_font_name(raw.get("fontname"))
        size = raw.get("size")
        words.append(
            Word(
                id=f"p{number}-w{len(words)}",
                text=text,
                bbox=bbox,
                font_name=font,
                font_size=round(float(size), 2) if size is not None else None,
                bold=bool(font and BOLD_HINT.search(font)),
                italic=bool(font and ITALIC_HINT.search(font)),
                upright=bool(raw.get("upright", True)),
            )
        )
    if off_page:
        warnings.append(
            f"Page {number}: {off_page} word(s) lie outside the visible page area and were ignored."
        )

    images: list[ImageRegion] = []
    covered = 0.0
    for raw in ppage.images:
        bbox = display_box(raw)
        if bbox is None:
            continue
        src = raw.get("srcsize") or (None, None)
        images.append(
            ImageRegion(
                id=f"p{number}-img{len(images)}",
                bbox=bbox,
                source_width=int(src[0]) if src[0] is not None else None,
                source_height=int(src[1]) if src[1] is not None else None,
            )
        )
        covered += bbox.area
    page_area = width * height
    # Overlapping images are counted twice; capped at 1.0. Good enough for "is this
    # page mostly one big image", which is all it is used for.
    coverage = round(min(1.0, covered / page_area), 3) if page_area else 0.0

    links: list[LinkRegion] = []
    for raw in ppage.hyperlinks:
        bbox = display_box(raw)
        if bbox is None:
            continue
        uri = _clean_text(raw.get("uri"), limit=2000)
        links.append(LinkRegion(id=f"p{number}-link{len(links)}", bbox=bbox, uri=uri))

    status = classify_text_layer([w.text for w in words])
    scanned = status is TextLayerStatus.ABSENT and coverage >= SCANNED_IMAGE_COVERAGE
    if scanned:
        warnings.append(
            f"Page {number} has no text layer and looks scanned. "
            "Text comparison is not possible for this page until OCR (planned for V1.1)."
        )
    elif status is TextLayerStatus.ABSENT:
        warnings.append(f"Page {number} contains no text.")
    elif status is TextLayerStatus.UNREADABLE:
        warnings.append(
            f"Page {number}: most of the text uses characters that can't be decoded. "
            "Its text can't be compared reliably."
        )

    return Page(
        number=number,
        label=label,
        width=round(width, COORD_DECIMALS),
        height=round(height, COORD_DECIMALS),
        rotation=rotation,  # type: ignore[arg-type]
        text_layer=status,
        likely_scanned=scanned,
        image_coverage=coverage,
        words=tuple(words),
        images=tuple(images),
        links=tuple(links),
    )


# ---------------------------------------------------------------- public API


def extract_document(data: bytes, limits: EngineLimits | None = None) -> Document:
    """Validate and extract a PDF. Raises DocumentError with a user-safe code."""
    probe = probe_pdf(data, limits)
    if not probe.ok:
        assert probe.error is not None
        raise DocumentError(probe.error, probe.detail)

    warnings: list[str] = []
    rotations: list[int] = []
    labels: list[str | None] = []
    try:
        with pikepdf.open(io.BytesIO(data)) as pdf:
            metadata = _read_metadata(pdf)
            has_labels = "/PageLabels" in pdf.Root
            for index, page in enumerate(pdf.pages, start=1):
                rotation, valid = _effective_rotation(page.obj)
                if not valid:
                    warnings.append(f"Page {index} has an invalid rotation value; treated as 0°.")
                rotations.append(rotation)
                labels.append(_clean_text(page.label, limit=100) if has_labels else None)
                visible = _visible_box(page)
                if visible is not None:
                    page.obj.MediaBox = visible
                    if "/CropBox" in page.obj:
                        del page.obj["/CropBox"]
                page.obj.Rotate = 0
            normalized = io.BytesIO()
            pdf.save(normalized)
    except pikepdf.PasswordError as exc:
        raise DocumentError(ErrorCode.PASSWORD_PROTECTED, str(exc)) from exc
    except Exception as exc:
        raise DocumentError(ErrorCode.EXTRACTION_FAILED, f"normalise: {exc}") from exc

    normalized.seek(0)
    pages: list[Page] = []
    try:
        with pdfplumber.open(normalized) as plumb:
            if len(plumb.pages) != probe.page_count:
                raise DocumentError(
                    ErrorCode.EXTRACTION_FAILED,
                    f"page count mismatch: {len(plumb.pages)} vs {probe.page_count}",
                )
            for index, ppage in enumerate(plumb.pages):
                pages.append(_extract_page(ppage, index + 1, rotations[index], labels[index], warnings))
    except DocumentError:
        raise
    except Exception as exc:
        raise DocumentError(ErrorCode.EXTRACTION_FAILED, f"extract: {exc}") from exc

    return Document(
        source=DocumentSource(
            sha256=probe.sha256,
            size_bytes=probe.size_bytes,
            pdf_version=probe.pdf_version,
            is_encrypted=probe.is_encrypted,
        ),
        metadata=metadata,
        pages=tuple(pages),
        extraction=ExtractionInfo(
            engine_version=ENGINE_VERSION,
            extractor=_extractor_label(),
            warnings=tuple(warnings),
        ),
    )


def extract_file(path: str, limits: EngineLimits | None = None) -> Document:
    with open(path, "rb") as handle:
        return extract_document(handle.read(), limits)
