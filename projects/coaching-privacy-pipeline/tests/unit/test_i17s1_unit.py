"""I17-S1 RED: streaming design doc absent (issue #17 slice 1, doc lint)."""
from __future__ import annotations

import pathlib

import pytest

pytestmark = pytest.mark.fast

REPO = pathlib.Path(__file__).resolve().parents[2]
DOC = REPO / "docs" / "design" / "streaming.md"
README = REPO / "README.md"
STATUS = REPO / "docs" / "status.md"

REQUIRED_SECTIONS = [
    "Consumer & release semantics",
    "Fail-closed contract",
    "State machine",
    "API sketch",
    "New risks",
    "Negative scenarios",
]
REQUIRED_CODE_REFS = [
    "engine.py", "pipeline.py", "context.py", "linkage.py", "asr.py", "batch.py",
]


def test_design_doc_exists_with_all_sections():
    assert DOC.is_file(), "docs/design/streaming.md missing"
    text = DOC.read_text()
    for section in REQUIRED_SECTIONS:
        assert section.lower() in text.lower(), f"missing section: {section}"
    for ref in REQUIRED_CODE_REFS:
        assert ref in text, f"missing code reference: {ref}"


def test_design_doc_linked_from_readme_and_status():
    readme = README.read_text()
    assert "design/streaming.md" in readme, "README does not link the design doc"
    status = STATUS.read_text()
    assert "design/streaming.md" in status, "docs/status.md does not link the design doc"
