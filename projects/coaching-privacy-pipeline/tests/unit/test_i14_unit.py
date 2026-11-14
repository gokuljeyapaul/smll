"""I14 RED: demo script/cast absent (issue #14)."""
from __future__ import annotations

import hashlib
import json
import pathlib
import re

import pytest



REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "video_demo.sh"
CAST = REPO / "docs" / "demo" / "demo.cast"


@pytest.mark.fast
def test_video_demo_script_exists_executable_strict():
    assert SCRIPT.is_file(), "scripts/video_demo.sh missing"
    assert SCRIPT.stat().st_mode & 0o111, "script not executable"
    text = SCRIPT.read_text()
    assert "set -euo pipefail" in text
    assert "/home/" not in text and "/Users/" not in text and "/root/" not in text


@pytest.mark.fast
def test_cast_exists_valid_jsonl_header_and_frames():
    assert CAST.is_file(), "docs/demo/demo.cast missing"
    lines = [l for l in CAST.read_text().splitlines() if l.strip()]
    header = json.loads(lines[0])
    assert header.get("version") == 2, header
    assert "title" in header  # 'command' may be omitted by quiet rec mode
    output_frames = 0
    for line in lines[1:]:
        frame = json.loads(line)
        if frame[1] == "o":
            output_frames += 1
    assert output_frames >= 1, "cast has no output frames"


@pytest.mark.fast
def test_cast_title_hash_matches_script():
    lines = [l for l in CAST.read_text().splitlines() if l.strip()]
    header = json.loads(lines[0])
    m = re.search(r"sha256:([0-9a-f]{64})", header.get("title", ""))
    assert m, f"cast title lacks sha256 of the script: {header.get('title')!r}"
    actual = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
    assert m.group(1) == actual, "cast/script drift: regenerate the cast"


@pytest.mark.fast
def test_cast_text_path_clean():
    blob = CAST.read_text()
    for forbidden in ("/home/", "/Users/", "/root/", "openclaw"):
        assert forbidden not in blob, f"cast leaks machine-specific path: {forbidden}"


@pytest.mark.slow
def test_video_demo_runs_green_slow(tmp_path):
    """Slow: the full demo must run green (real models; #14 acceptance)."""
    import subprocess
    import sys

    r = subprocess.run(
        ["bash", str(SCRIPT)], capture_output=True, text=True,
        cwd=REPO, timeout=2400,
    )
    assert r.returncode == 0, r.stderr[-2000:]
    assert "END OF RECORDING" in r.stdout
    assert "OFFLINE_ASR_PROOF_OK" in r.stdout
    assert "BLOCKED" in r.stdout
