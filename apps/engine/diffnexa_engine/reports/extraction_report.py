"""Extraction reports a person can open in a browser.

Everything taken from the PDF is HTML-escaped: PDFs are untrusted input and
their text must never be able to inject markup into a report.
"""

from __future__ import annotations

from html import escape
from typing import Any

from diffnexa_engine.model.document import Document, TextLayerStatus

SAMPLE_WORDS_PER_PAGE = 30
MAX_PAGES_IN_REPORT = 50

_TEXT_LAYER_LABEL = {
    TextLayerStatus.PRESENT: "Readable text",
    TextLayerStatus.ABSENT: "No text",
    TextLayerStatus.UNREADABLE: "Unreadable text",
}

_STYLE = """
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b2a41;margin:2rem;max-width:72rem;line-height:1.5}
h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:2rem 0 .5rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin:.5rem 0 1rem}
th,td{border:1px solid #d9dee5;padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:#f3f5f8;font-weight:600}td.num{font-variant-numeric:tabular-nums;text-align:right}
.warn{background:#fff7e6;border:1px solid #f0c36d;padding:.75rem 1rem;border-radius:6px}
.muted{color:#5b6472}.flag{font-weight:600;color:#9a3412}
"""


def document_summary(doc: Document) -> dict[str, Any]:
    return {
        "sha256": doc.source.sha256,
        "size_bytes": doc.source.size_bytes,
        "pdf_version": doc.source.pdf_version,
        "page_count": doc.page_count,
        "word_count": sum(p.word_count for p in doc.pages),
        "scanned_pages": [p.number for p in doc.pages if p.likely_scanned],
        "pages_without_text": [p.number for p in doc.pages if p.text_layer is TextLayerStatus.ABSENT],
        "unreadable_pages": [p.number for p in doc.pages if p.text_layer is TextLayerStatus.UNREADABLE],
        "rotated_pages": [p.number for p in doc.pages if p.rotation],
        "warnings": list(doc.extraction.warnings),
    }


def render_extraction_html(doc: Document, title: str) -> str:
    s = document_summary(doc)
    out: list[str] = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        f"<title>Extraction report: {escape(title)}</title><style>{_STYLE}</style></head><body>",
        f"<h1>Extraction report: {escape(title)}</h1>",
        f"<p class='muted'>Engine {escape(doc.extraction.engine_version)} "
        f"({escape(doc.extraction.extractor)})</p>",
        "<table>",
        f"<tr><th>Pages</th><td class='num'>{s['page_count']}</td></tr>",
        f"<tr><th>Words extracted</th><td class='num'>{s['word_count']}</td></tr>",
        f"<tr><th>File size</th><td class='num'>{s['size_bytes']:,} bytes</td></tr>",
        f"<tr><th>PDF version</th><td>{escape(str(s['pdf_version']))}</td></tr>",
        f"<tr><th>Scanned pages</th><td>{_page_list(s['scanned_pages'])}</td></tr>",
        f"<tr><th>Unreadable pages</th><td>{_page_list(s['unreadable_pages'])}</td></tr>",
        f"<tr><th>Rotated pages</th><td>{_page_list(s['rotated_pages'])}</td></tr>",
        f"<tr><th>SHA-256</th><td><code>{escape(s['sha256'])}</code></td></tr>",
        "</table>",
    ]
    if s["warnings"]:
        items = "".join(f"<li>{escape(w)}</li>" for w in s["warnings"])
        out.append(f"<div class='warn'><strong>Warnings</strong><ul>{items}</ul></div>")

    out.append(
        "<h2>Pages</h2><table><tr><th>Page</th><th>Size (pt)</th><th>Rotation</th>"
        "<th>Text</th><th>Words</th><th>Images</th><th>Links</th></tr>"
    )
    for page in doc.pages[:MAX_PAGES_IN_REPORT]:
        flag = " <span class='flag'>(looks scanned)</span>" if page.likely_scanned else ""
        out.append(
            f"<tr><td class='num'>{page.number}</td>"
            f"<td class='num'>{page.width:g} × {page.height:g}</td>"
            f"<td class='num'>{page.rotation}°</td>"
            f"<td>{_TEXT_LAYER_LABEL[page.text_layer]}{flag}</td>"
            f"<td class='num'>{page.word_count}</td><td class='num'>{len(page.images)}</td>"
            f"<td class='num'>{len(page.links)}</td></tr>"
        )
    out.append("</table>")

    for page in doc.pages[:MAX_PAGES_IN_REPORT]:
        if not page.words:
            continue
        out.append(
            f"<h2>Page {page.number}: first {min(SAMPLE_WORDS_PER_PAGE, page.word_count)} "
            f"of {page.word_count} words</h2>"
            "<table><tr><th>Word ID</th><th>Text</th><th>Position x0, y0, x1, y1 (pt)</th>"
            "<th>Font</th><th>Size</th></tr>"
        )
        for word in page.words[:SAMPLE_WORDS_PER_PAGE]:
            b = word.bbox
            style = ", ".join(x for x in ("bold" if word.bold else "", "italic" if word.italic else "") if x)
            font = escape(word.font_name or "unknown") + (f" ({style})" if style else "")
            out.append(
                f"<tr><td><code>{escape(word.id)}</code></td><td>{escape(word.text)}</td>"
                f"<td class='num'>{b.x0:g}, {b.y0:g}, {b.x1:g}, {b.y1:g}</td>"
                f"<td>{font}</td><td class='num'>{word.font_size if word.font_size is not None else ''}</td></tr>"
            )
        out.append("</table>")
    if doc.page_count > MAX_PAGES_IN_REPORT:
        out.append(f"<p class='muted'>Report shows the first {MAX_PAGES_IN_REPORT} pages.</p>")
    out.append("</body></html>")
    return "\n".join(out)


def _page_list(pages: list[int]) -> str:
    return ", ".join(str(p) for p in pages) if pages else "None"
