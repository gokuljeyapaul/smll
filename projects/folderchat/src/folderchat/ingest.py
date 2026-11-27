"""Ingest: parse supported formats into anchored blocks (UC09), or refuse with a
specific reason. Everything here is local and fail-closed."""
from __future__ import annotations

import html.parser
import pathlib
import re
from dataclasses import dataclass, field
from typing import Any

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".markdown", ".txt", ".html", ".htm"}


@dataclass
class Block:
    text: str
    page: int | None = None
    heading: str | None = None


@dataclass
class ParseResult:
    status: str  # "indexed" | "skipped"
    blocks: list[Block] = field(default_factory=list)
    reason: str | None = None
    pages: int = 0
    chars: int = 0


class _HTMLToBlocks(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[Block] = []
        self._buf: list[str] = []
        self._heading: str | None = None
        self._in_heading = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("h1", "h2", "h3"):
            self._flush()
            self._in_heading = True
        elif tag in ("p", "li", "tr", "div"):
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in ("h1", "h2", "h3"):
            self._heading = " ".join("".join(self._buf).split())
            self._buf = []
            self._in_heading = False
        elif tag in ("p", "li", "tr", "div"):
            self._flush()

    def handle_data(self, data: str) -> None:
        if data.strip():
            self._buf.append(data)

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
        self._buf = []
        if text:
            self.blocks.append(Block(text=text, heading=self._heading))

    def close(self) -> None:
        super().close()
        self._flush()


def parse_file(path: pathlib.Path, limits: Any) -> ParseResult:
    """Parse one file into anchored blocks, or return a skip with a specific reason.
    Checks run in the order: size (never even open an over-limit file), format,
    extractability, extraction size."""
    size = path.stat().st_size
    if size > limits.max_file_bytes:
        return ParseResult(status="skipped",
                            reason=f"too large: {size / (1024 * 1024):.1f} MB > {limits.max_file_mb} MB")
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return ParseResult(status="skipped", reason=f"unsupported format: {ext or '(no extension)'}")
    try:
        if ext == ".pdf":
            return _parse_pdf(path, limits)
        if ext == ".docx":
            return _parse_docx(path, limits)
        return _parse_textlike(path, limits, ext)
    except _Skip as e:
        return ParseResult(status="skipped", reason=str(e))
    except Exception as e:  # noqa: BLE001 — a broken file is listed, never crashes the add
        return ParseResult(status="skipped", reason=f"could not parse: {type(e).__name__}: {e}")


class _Skip(Exception):
    pass


def _check_chars(text_len: int, limits: Any) -> None:
    if text_len > limits.max_extracted_chars:
        raise _Skip(f"extracted text too long: {text_len} characters > {limits.max_extracted_chars} limit")


def _parse_pdf(path: pathlib.Path, limits: Any) -> ParseResult:
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
    except Exception as e:  # noqa: BLE001
        raise _Skip(f"unreadable PDF: {type(e).__name__}") from e
    if reader.is_encrypted:
        raise _Skip("encrypted or password-protected PDF")
    npages = len(reader.pages)
    if npages > limits.max_pages:
        raise _Skip(f"too many pages: {npages} > {limits.max_pages}")
    blocks: list[Block] = []
    total = 0
    for i, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text() or ""
        except Exception as e:  # noqa: BLE001
            raise _Skip(f"page {i} could not be read: {type(e).__name__}") from e
        total += len(text)
        _check_chars(total, limits)
        for para in re.split(r"\n\s*\n", text):
            para = re.sub(r"\s+", " ", para).strip()
            if para:
                blocks.append(Block(text=para, page=i))
    if not any(b.text for b in blocks):
        raise _Skip("no text layer (scanned or image-only PDF)")
    return ParseResult(status="indexed", blocks=blocks, pages=npages, chars=total)


def _parse_docx(path: pathlib.Path, limits: Any) -> ParseResult:
    import docx

    d = docx.Document(str(path))
    blocks: list[Block] = []
    total = 0
    heading: str | None = None
    for para in d.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        total += len(text)
        _check_chars(total, limits)
        style_name = (para.style.name if para.style is not None else "") or ""
        style = style_name.lower()
        if style.startswith("heading") or style == "title":
            heading = text
            blocks.append(Block(text=text, heading=heading))
        else:
            blocks.append(Block(text=text, heading=heading))
    return ParseResult(status="indexed", blocks=blocks, chars=total)


def _parse_textlike(path: pathlib.Path, limits: Any, ext: str) -> ParseResult:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if ext in (".html", ".htm"):
        p = _HTMLToBlocks()
        p.feed(raw)
        p.close()
        blocks = p.blocks
        total = sum(len(b.text) for b in blocks)
    elif ext in (".md", ".markdown"):
        blocks = []
        heading: str | None = None
        for para in re.split(r"\n\s*\n", raw):
            para = para.strip()
            if not para:
                continue
            m = re.match(r"^#{1,6}\s+(.*)$", para.splitlines()[0])
            if m and len(para.splitlines()) == 1:
                heading = m.group(1).strip()
                blocks.append(Block(text=str(heading), heading=heading))
                continue
            text = re.sub(r"\s+", " ", para).strip()
            blocks.append(Block(text=text, heading=heading))
        total = sum(len(b.text) for b in blocks)
    else:  # .txt
        blocks = [Block(text=re.sub(r"\s+", " ", para).strip(), heading=None)
                  for para in re.split(r"\n\s*\n", raw) if para.strip()]
        total = sum(len(b.text) for b in blocks)
    _check_chars(total, limits)
    if not blocks:
        raise _Skip("no extractable text")
    return ParseResult(status="indexed", blocks=blocks, chars=total)
