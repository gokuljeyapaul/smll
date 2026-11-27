"""A02/A24 (parser side): supported formats parsed with anchors; refusals with specific reasons."""


def _parse(path, **limits_overrides):
    from folderchat.config import load_limits
    from folderchat.ingest import parse_file

    limits = load_limits(**limits_overrides)
    return parse_file(path, limits)


def _tiny_pdf(path, pages=2):
    from fpdf import FPDF

    pdf = FPDF()
    for i in range(pages):
        pdf.add_page()
        pdf.set_font("Helvetica", size=11)
        pdf.multi_cell(0, 8, f"Page {i + 1} of the tiny test document. "
                            f"Travel reimbursement is capped at $500 per trip.")
    pdf.output(str(path))


def test_pdf_parsed_with_page_anchors(tmp_path):
    p = tmp_path / "doc.pdf"
    _tiny_pdf(p, pages=2)
    result = _parse(p)
    assert result.status == "indexed", result.reason
    assert result.pages == 2
    assert any(b.page == 1 for b in result.blocks) and any(b.page == 2 for b in result.blocks)
    assert "capped at $500" in "".join(b.text for b in result.blocks)


def test_encrypted_pdf_listed_with_reason(tmp_path):
    import pypdf

    p = tmp_path / "secrets.pdf"
    _tiny_pdf(p, pages=1)
    reader = pypdf.PdfReader(str(p))
    writer = pypdf.PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password="hunter2")
    with open(p, "wb") as f:
        writer.write(f)
    result = _parse(p)
    assert result.status == "skipped"
    assert "encrypted" in (result.reason or "").lower()


def test_docx_parsed(tmp_path):
    import docx

    p = tmp_path / "spec.docx"
    d = docx.Document()
    d.add_heading("Scanner Specification", level=1)
    d.add_paragraph("The scanner rollout begins in March 2027.")
    d.save(str(p))
    result = _parse(p)
    assert result.status == "indexed", result.reason
    assert "Scanner Specification" in result.blocks[0].heading
    assert "March 2027" in result.blocks[1].text


def test_markdown_heading_anchors(tmp_path):
    p = tmp_path / "policy.md"
    p.write_text("# Travel\n\nReimbursement is capped at $500 per trip.\n\n## Per diem\n\nThe daily per diem is $65.\n")
    result = _parse(p)
    assert result.status == "indexed"
    headings = {b.heading for b in result.blocks}
    assert "Travel" in headings and "Per diem" in headings


def test_html_parsed(tmp_path):
    p = tmp_path / "benefits.html"
    p.write_text("<html><body><h1>Benefits</h1><p>The 401k match is 4 percent.</p></body></html>")
    result = _parse(p)
    assert result.status == "indexed"
    assert "401k match is 4 percent" in "".join(b.text for b in result.blocks)


def test_unknown_extension_listed_with_reason(tmp_path):
    p = tmp_path / "legacy_data.xyz"
    p.write_bytes(b"\x00\x01binary")
    result = _parse(p)
    assert result.status == "skipped"
    assert "unsupported" in (result.reason or "").lower()
    assert ".xyz" in (result.reason or "")


def test_oversize_file_refused_before_parsing(tmp_path):
    """A24 boundary: just over the file-size limit is refused with the specific numbers."""
    p = tmp_path / "huge.txt"
    with open(p, "wb") as f:
        f.truncate(51 * 1024 * 1024)  # sparse: instant, no repo bloat
    result = _parse(p)
    assert result.status == "skipped"
    assert "too large" in (result.reason or "").lower()
    assert "51" in (result.reason or "")


def test_file_size_boundary_both_sides(tmp_path):
    """A24 boundary: just under the file-size limit indexes fine; just over is refused
    with the specific numbers. Uses the 1 MB floor of the safe range so the fixture
    stays small."""
    from folderchat.config import load_limits

    load_limits(max_file_mb=1)
    ok = tmp_path / "just-under.txt"
    ok.write_text("x" * (int(0.9 * 1024 * 1024)))
    assert _parse(ok, max_file_mb=1).status == "indexed", _parse(ok, max_file_mb=1).reason
    over = tmp_path / "just-over.txt"
    over.write_text("x" * (int(1.2 * 1024 * 1024)))
    result = _parse(over, max_file_mb=1)
    assert result.status == "skipped"
    assert "too large" in (result.reason or "")
    assert "1.2 MB > 1 MB" in (result.reason or "")


def test_extracted_char_ceiling_enforced(tmp_path):
    """A24: over the extracted-character limit is listed, never silently truncated."""
    p = tmp_path / "long.txt"
    p.write_text("filler text line\n" * 200000)  # ~3.2M chars > 2M limit
    result = _parse(p)
    assert result.status == "skipped"
    assert "characters" in (result.reason or "").lower()
