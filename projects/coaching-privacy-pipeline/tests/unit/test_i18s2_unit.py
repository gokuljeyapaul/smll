"""I18-S2: runtime fail-closed model verification (issue #18 slice 2).

GLiNERContextExtractor._ensure_loaded and FasterWhisperAdapter._ensure_model
verify the manifest hashes of the files they load (once per process).
Tampered/missing files must fail closed (context_stage_error -> FAILED;
ASRError) instead of loading silently.

Real-model layout is used via hardlinked checkpoint copies (disk-bounded):
only the tampered file is a real copy, everything else is hardlinked from the
pristine checkpoint, so the manifest verification exercises the actual
files, manifest and hashing path.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]


def _checkpoint_available() -> bool:
    return (REPO / "models" / "gliner_medium-v2.1" / "model.safetensors").is_file()


def _linked_checkpoint(tmp_path: pathlib.Path, name: str) -> pathlib.Path:
    """Disk-bounded copy of the real checkpoint dir: hardlink each file when
    possible (same filesystem), else copy. Only the tampered file (replaced by
    the caller) costs real disk."""
    src = REPO / "models" / "gliner_medium-v2.1"
    dst = tmp_path / name
    dst.mkdir(parents=True)
    for f in src.iterdir():
        if f.is_file():
            target = dst / f.name
            try:
                os.link(f, target)
            except OSError:
                shutil.copy2(f, target)
    return dst


def _manifest_repointed(tmp_path: pathlib.Path, local_path: str,
                        model_key: str = "gliner_medium_v2_1") -> str:
    manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
    manifest["models"][model_key]["local_path"] = local_path
    out = tmp_path / "manifest.json"
    out.write_text(json.dumps(manifest))
    return str(out)


def _tamper(path: pathlib.Path, byte_index: int = 0) -> None:
    """Replace a hardlinked file with a tampered real copy (link-safe)."""
    data = bytearray(path.read_bytes())
    data[byte_index] ^= 0xFF
    path.unlink()
    path.write_bytes(bytes(data))


class TestGlinerRuntimeVerification:
    def test_tampered_checkpoint_fails_closed(self, tmp_path, monkeypatch):
        if not _checkpoint_available():
            pytest.skip("real gliner checkpoint not present in this environment")
        checkpoint = _linked_checkpoint(tmp_path, "gliner_tampered")
        _tamper(checkpoint / "gliner_config.json", byte_index=3)
        monkeypatch.setenv("COACHING_GLINER_PATH", str(checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_repointed(tmp_path, "gliner_tampered"),
        )
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        extractor = GLiNERContextExtractor()
        with pytest.raises(RuntimeError, match="gliner_config.json"):
            extractor._ensure_loaded()

    def test_tampered_weights_fail_closed(self, tmp_path, monkeypatch):
        """Tampered safetensors must be named before any load attempt."""
        if not _checkpoint_available():
            pytest.skip("real gliner checkpoint not present in this environment")
        checkpoint = _linked_checkpoint(tmp_path, "gliner_weights")
        # Tamper only the first bytes of a sparse 8KB real copy: hardlinks
        # share content, so replace the file with a tampered copy of its head
        # (manifest hash check reads the whole file; any mismatch fails it).
        p = checkpoint / "model.safetensors"
        head = bytearray(p.read_bytes()[:8192])
        rest = p.read_bytes()[8192:]
        head[100] ^= 0xFF
        p.unlink()
        with p.open("wb") as fh:
            fh.write(bytes(head))
            fh.write(rest)
        monkeypatch.setenv("COACHING_GLINER_PATH", str(checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_repointed(tmp_path, "gliner_weights"),
        )
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        extractor = GLiNERContextExtractor()
        with pytest.raises(RuntimeError, match="model.safetensors"):
            extractor._ensure_loaded()

    def test_missing_checkpoint_file_fails_closed(self, tmp_path, monkeypatch):
        if not _checkpoint_available():
            pytest.skip("real gliner checkpoint not present in this environment")
        checkpoint = _linked_checkpoint(tmp_path, "gliner_missing")
        (checkpoint / "gliner_config.json").unlink()
        monkeypatch.setenv("COACHING_GLINER_PATH", str(checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_repointed(tmp_path, "gliner_missing"),
        )
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        extractor = GLiNERContextExtractor()
        with pytest.raises(RuntimeError, match="gliner_config.json"):
            extractor._ensure_loaded()

    def test_engine_decision_failed_on_tampered_context_model(
        self, tmp_path, monkeypatch
    ):
        """End-to-end: a tampered GLiNER checkpoint must route the session
        decision to FAILED (context_stage_error), never a silent release."""
        if not _checkpoint_available():
            pytest.skip("real gliner checkpoint not present in this environment")
        checkpoint = _linked_checkpoint(tmp_path, "gliner_e2e")
        _tamper(checkpoint / "gliner_config.json", byte_index=3)
        monkeypatch.setenv("COACHING_GLINER_PATH", str(checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_repointed(tmp_path, "gliner_e2e"),
        )
        from coaching_privacy import engine

        engine._EXTRACTOR_CACHE.pop("ex", None)
        try:
            line = (REPO / "fixtures" / "seed_fixtures.jsonl").read_text().splitlines()[0]
            fixture = json.loads(line)
            from coaching_privacy.contracts import Transcript
            from coaching_privacy.policy import PolicyStore
            policy = PolicyStore(REPO / "policies" / "sample_policy.yaml").get(
                fixture["transcript"]["purpose"]
            )
            result = engine.process_transcript(
                Transcript.parse(fixture["transcript"]), policy,
                prohibited_leaks=fixture.get("prohibited_leaks"),
            )
            assert result.decision["decision"] == "FAILED", result.decision
            assert "gliner_config.json" in (
                result.report.get("context_stage_error") or ""
            ), result.report.get("context_stage_error")
        finally:
            engine._EXTRACTOR_CACHE.pop("ex", None)


class TestWhisperRuntimeVerification:
    def test_tampered_whisper_file_fails_asrerror(self, tmp_path, monkeypatch):
        """A tampered whisper model dir must raise ASRError, not load."""
        src = REPO / "models" / "whisper-tiny.en"
        snaps = sorted(src.glob("models--Systran--faster-whisper-tiny.en/snapshots/*"))
        if not snaps:
            pytest.skip("real whisper model not present in this environment")
        dst_root = tmp_path / "whisper-tiny.en"
        dst_root.mkdir()
        for sub in src.iterdir():
            if sub.is_dir():
                shutil.copytree(sub, dst_root / sub.name, copy_function=shutil.copy2)
        snap = sorted(
            dst_root.glob("models--Systran--faster-whisper-tiny.en/snapshots/*")
        )[0]
        _tamper(snap / "vocabulary.txt", byte_index=50)
        manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
        manifest["models"]["whisper_tiny_en"]["local_path"] = str(
            snap.relative_to(tmp_path)
        )
        out = tmp_path / "manifest.json"
        out.write_text(json.dumps(manifest))

        monkeypatch.setenv("COACHING_MODEL_MANIFEST", str(out))
        from coaching_privacy.asr import ASRError, FasterWhisperAdapter

        adapter = FasterWhisperAdapter(model_dir=str(dst_root))
        with pytest.raises(ASRError, match="vocabulary.txt"):
            adapter._ensure_model()

    def test_missing_whisper_snapshot_fails_asrerror(self, tmp_path):
        from coaching_privacy.asr import ASRError, FasterWhisperAdapter

        adapter = FasterWhisperAdapter(model_dir=str(tmp_path / "nowhere"))
        with pytest.raises(ASRError, match="snapshot not found"):
            adapter._ensure_model()

    def test_real_models_pass_runtime_verification(self):
        """Happy path: the real pinned models must pass the runtime check."""
        from coaching_privacy.asr import FasterWhisperAdapter
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        GLiNERContextExtractor()._verify_model_files()
        FasterWhisperAdapter()._verify_model_files()
