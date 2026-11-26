"""Text-based PDF extraction that keeps page boundaries (PyMuPDF)."""
from __future__ import annotations

import re

MAX_BYTES = 25 * 1024 * 1024
MAX_PAGES = 250


class PdfError(ValueError):
    pass


def parse_pdf(data: bytes, file_name: str = "document.pdf") -> dict:
    if len(data) > MAX_BYTES:
        raise PdfError("That PDF is larger than 25 MB.")
    try:
        import pymupdf  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise PdfError("PDF support needs PyMuPDF. Run: pip install pymupdf") from exc
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PdfError("This file could not be read as a PDF.") from exc
    if doc.needs_pass:
        raise PdfError("This PDF is password protected.")
    pages, warnings = [], []
    total = min(doc.page_count, MAX_PAGES)
    if doc.page_count > MAX_PAGES:
        warnings.append(f"Only the first {MAX_PAGES} pages were read.")
    for number in range(total):
        text = re.sub(r"[ \t]+\n", "\n", doc[number].get_text("text") or "").strip()
        pages.append({"page": number + 1, "text": text[:40000]})
    readable = sum(1 for p in pages if len(p["text"]) > 40)
    if readable == 0:
        raise PdfError("No selectable text was found. This looks like a scanned PDF; Threadkeeper reads text-based PDFs only.")
    if readable < len(pages) / 2:
        warnings.append("Some pages have no selectable text (scans or figures) and were skipped.")
    meta = doc.metadata or {}
    guess = (meta.get("title") or "").strip() or next((ln.strip() for ln in pages[0]["text"].splitlines() if 12 < len(ln.strip()) < 200), "")
    return {"file_name": file_name, "page_count": doc.page_count, "pages": pages, "title_guess": guess[:300],
            "author_guess": (meta.get("author") or "").strip()[:300], "warnings": warnings}
