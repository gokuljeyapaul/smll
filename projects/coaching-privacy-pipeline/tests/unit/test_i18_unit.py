"""I18-S1 RED: scripts/verify_models.py does not exist — behavioral failures.

The tests subprocess-invoke the (missing) verifier against tiny synthetic
model dirs + manifests. They assert exit codes and messages, not imports.
"""
import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.fast

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "verify_models.py"


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args, capture_output=True, text=True
    )


@pytest.fixture()
def tiny_model(tmp_path: pathlib.Path) -> pathlib.Path:
    root = tmp_path / "models"
    (root / "m1").mkdir(parents=True)
    (root / "m1" / "model.bin").write_bytes(b"\x00\x01\x02weights")
    (root / "m1" / "config.json").write_text('{"name": "m1"}')
    return root


def _manifest_for(root: pathlib.Path) -> dict:
    import hashlib

    def sha(p: pathlib.Path) -> str:
        return "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()

    return {
        "schema_version": "1.1",
        "models": {
            "m1": {
                "repo_id": "example/m1",
                "revision": "0123456789abcdef0123456789abcdef01234567",
                "local_path": "m1",
                "files": {
                    "model.bin": sha(root / "m1" / "model.bin"),
                    "config.json": sha(root / "m1" / "config.json"),
                },
            }
        },
    }


def test_all_files_match_exits_zero(tiny_model, tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(_manifest_for(tiny_model)))
    result = _run(["--manifest", str(manifest), "--root", str(tiny_model)])
    assert result.returncode == 0, result.stderr + result.stdout


def test_flipped_byte_fails_naming_file(tiny_model, tmp_path):
    m = _manifest_for(tiny_model)
    real = tiny_model / "m1" / "model.bin"
    data = bytearray(real.read_bytes())
    data[0] ^= 0xFF
    real.write_bytes(bytes(data))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(m))
    result = _run(["--manifest", str(manifest), "--root", str(tiny_model)])
    assert result.returncode != 0
    assert "model.bin" in (result.stdout + result.stderr), (
        f"error must name the mismatched file, got: {result.stdout}{result.stderr}"
    )


def test_missing_file_fails_naming_file(tiny_model, tmp_path):
    m = _manifest_for(tiny_model)
    (tiny_model / "m1" / "config.json").unlink()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(m))
    result = _run(["--manifest", str(manifest), "--root", str(tiny_model)])
    assert result.returncode != 0
    assert "config.json" in (result.stdout + result.stderr)


def test_malformed_manifest_fails(tiny_model, tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text("{not json")
    result = _run(["--manifest", str(manifest), "--root", str(tiny_model)])
    assert result.returncode != 0
    assert "manifest" in (result.stdout + result.stderr).lower()


def test_missing_manifest_entry_file_fails(tiny_model, tmp_path):
    """A runtime file present on disk but absent from the manifest is fine;
    a manifest file absent on disk must fail. Covered above; here ensure the
    verifier rejects an entry missing required keys (no local_path)."""
    m = _manifest_for(tiny_model)
    del m["models"]["m1"]["revision"]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(m))
    result = _run(["--manifest", str(manifest), "--root", str(tiny_model)])
    assert result.returncode != 0
    assert "revision" in (result.stdout + result.stderr), (
        f"error must name the missing manifest field, got: {result.stdout}{result.stderr}"
    )
