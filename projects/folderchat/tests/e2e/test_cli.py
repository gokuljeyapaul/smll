"""S0 CLI e2e — the issue #93 observable contract, driven through the real CLI."""
import subprocess
import sys


def test_a01_help_offline(cli, offline, data_dir):
    """A01: `folderchat --help` works with the network refused."""
    r = cli(["--help"])
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    assert "usage" in r.stdout.lower()
    for word in ("add", "ask", "doctor"):
        assert word in r.stdout.lower()


def test_a01_help_inprocess_offline(offline, data_dir, capsys):
    """A01: --help also works in-process under the socket guard."""
    from folderchat.cli import main

    try:
        main(["--help"])
    except SystemExit as e:
        assert e.code in (0, None)
    out = capsys.readouterr().out
    assert "usage" in out.lower()


def test_a01_doctor_offline(cli, offline, data_dir):
    """A01: `folderchat doctor` runs offline and reports the pinned models verified."""
    r = cli(["doctor"])
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    low = r.stdout.lower()
    assert "model" in low
    assert "fail" not in low and "missing" not in low


def test_a01_doctor_detects_tampered_model(tmp_path, monkeypatch):
    """A01: doctor must actually verify sha256 — a tampered model file is reported, not waved through."""
    import hashlib
    import json

    good = tmp_path / "models" / "good.gguf"
    bad = tmp_path / "models" / "bad.gguf"
    good.parent.mkdir(parents=True)
    good.write_bytes(b"good bytes")
    bad.write_bytes(b"tampered bytes")

    def sha(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    fake = {
        "roles": {
            "answer": {
                "name": "fake", "repo": "x/y", "file": "bad.gguf", "url": "https://example.invalid/bad.gguf",
                "sha256": sha(good), "size_bytes": len(b"tampered bytes"), "license": "MIT",
            },
            "embedding": {
                "name": "fake-emb", "repo": "x/z",
                "files": [{"path": "model.safetensors", "sha256": "0" * 64, "size_bytes": 1}],
            },
        }
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(fake))
    monkeypatch.setenv("FOLDERCHAT_MODEL_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("FOLDERCHAT_MANIFEST", str(manifest_path))
    monkeypatch.setenv("FOLDERCHAT_DATA_DIR", str(tmp_path / "data"))
    from folderchat.cli import main

    try:
        main(["doctor"])
    except SystemExit as e:
        assert e.code == 1, "doctor must exit 1 when a pinned model fails verification"


def test_ask_before_any_source(cli, data_dir):
    """A clean install answers honestly when nothing is indexed yet."""
    r = cli(["ask", "What is the travel reimbursement limit?"])
    assert r.returncode != 0
    assert "no sources" in (r.stdout + r.stderr).lower()


def test_a02_add_fixture_folder(cli, data_dir, corpus_path):
    """A02: adding the fixture folder indexes every supported file; skips are listed with reasons."""
    r = cli(["add", str(corpus_path)], timeout=900)
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    out = r.stdout
    assert "indexed" in out.lower()
    # the deliberately-unsupported fixture files must be listed with specific reasons
    assert "secrets_encrypted.pdf" in out
    assert "encrypted" in out.lower()
    assert "legacy_data.xyz" in out
    assert "unsupported" in out.lower()


def test_a02_anchors_persist(cli, data_dir, corpus_path):
    """A02: chunks carry page anchors (PDF) and heading anchors (Markdown)."""
    r = cli(["add", str(corpus_path)], timeout=900)
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    import sqlite3

    from folderchat.config import data_dir as resolve_data_dir

    db = sqlite3.connect(resolve_data_dir() / "index.db")
    pages = db.execute("SELECT COUNT(*) FROM chunks WHERE page IS NOT NULL").fetchone()[0]
    headings = db.execute("SELECT COUNT(*) FROM chunks WHERE heading IS NOT NULL").fetchone()[0]
    db.close()
    assert pages > 0, "no page anchors found for PDF chunks"
    assert headings > 0, "no heading anchors found for Markdown chunks"


def test_a04_ask_travel_question_cited(cli, data_dir, corpus_path):
    """A04/S0 goal: the demo question returns a cited answer with a verified quote."""
    add = cli(["add", str(corpus_path)], timeout=900)
    assert add.returncode == 0, add.stderr
    r = cli(["ask", "What is the travel reimbursement limit?"], timeout=900)
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    assert "$500" in r.stdout, f"answer missing the gold value:\n{r.stdout}"
    assert "[1]" in r.stdout, f"no numbered citation:\n{r.stdout}"
    assert "Sources" in r.stdout or "sources" in r.stdout.lower()
    # the quoted span in the printed citation must be a verbatim substring of the cited chunk
    import re
    import sqlite3

    from folderchat.config import data_dir as resolve_data_dir

    m = re.search(r'\[1\][^\"]*"([^"]+)"', r.stdout)
    assert m, f"no quoted citation span found:\n{r.stdout}"
    quote = m.group(1)
    db = sqlite3.connect(resolve_data_dir() / "index.db")
    rows = [t for (t,) in db.execute("SELECT text FROM chunks").fetchall()]
    db.close()
    assert any(quote in t for t in rows), f"citation quote not found verbatim in any chunk: {quote!r}"


def test_a06_ask_unanswerable_says_not_found(cli, data_dir, corpus_path):
    """A06: an unanswerable question prints 'not found' with the closest passages."""
    add = cli(["add", str(corpus_path)], timeout=900)
    assert add.returncode == 0, add.stderr
    r = cli(["ask", "What is the CEO's favourite colour?"], timeout=900)
    assert r.returncode == 0, f"exit {r.returncode}\nstdout={r.stdout}\nstderr={r.stderr}"
    low = r.stdout.lower()
    assert "not found" in low, f"missing 'not found':\n{r.stdout}"
    assert "closest" in low or "closest passages" in low
    assert "[1]" in r.stdout, "closest passages must be listed"
