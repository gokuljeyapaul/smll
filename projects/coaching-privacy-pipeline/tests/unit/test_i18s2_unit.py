"""I18-S2 RED: runtime fail-closed model verification (issue #18 slice 2).

GLiNERContextExtractor._ensure_loaded and FasterWhisperAdapter._ensure_model
must verify the manifest hashes of the files they load (once per process).
Tampered/missing files must fail closed (context_stage_error -> FAILED;
ASRError) instead of loading silently.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]


@pytest.fixture()
def tampered_checkpoint(tmp_path: pathlib.Path) -> pathlib.Path:
    """A real-layout checkpoint copy with one tampered model file."""
    src = REPO / "models" / "gliner_medium-v2.1"
    dst = tmp_path / "gliner_medium-v2.1"
    if not (src / "model.safetensors").is_file():
        pytest.skip("real gliner checkpoint not present in this environment")
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".cache"))
    # Tamper: flip one byte in the big weights file.
    p = dst / "model.safetensors"
    data = bytearray(p.read_bytes()[:4096]) + p.read_bytes()[4096:]
    data[100] ^= 0xFF
    p.write_bytes(bytes(data))
    return dst


def _manifest_for_checkpoint(checkpoint: pathlib.Path, tmp_path: pathlib.Path) -> str:
    """Copy the real manifest and repoint local_path at the tampered copy."""
    manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
    manifest["models"]["gliner_medium_v2_1"]["local_path"] = str(
        checkpoint.relative_to(tmp_path)
    )
    out = tmp_path / "manifest.json"
    out.write_text(json.dumps(manifest))
    return str(out)


class TestGlinerRuntimeVerification:
    def test_tampered_checkpoint_fails_closed(self, tampered_checkpoint, tmp_path, monkeypatch):
        monkeypatch.setenv("COACHING_GLINER_PATH", str(tampered_checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_for_checkpoint(tampered_checkpoint, tmp_path),
        )
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        extractor = GLiNERContextExtractor()
        with pytest.raises(Exception, match="model.safetensors"):
            extractor._ensure_loaded()

    def test_missing_checkpoint_file_fails_closed(self, tmp_path, monkeypatch):
        src = REPO / "models" / "gliner_medium-v2.1"
        if not (src / "model.safetensors").is_file():
            pytest.skip("real gliner checkpoint not present in this environment")
        checkpoint = tmp_path / "gliner_clean"
        shutil.copytree(src, checkpoint, ignore=shutil.ignore_patterns(".cache"))
        (checkpoint / "gliner_config.json").unlink()
        monkeypatch.setenv("COACHING_GLINER_PATH", str(checkpoint))
        manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
        manifest["models"]["gliner_medium_v2_1"]["local_path"] = "gliner_clean"
        out = tmp_path / "manifest.json"
        out.write_text(json.dumps(manifest))
        monkeypatch.setenv("COACHING_MODEL_MANIFEST", str(out))
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        extractor = GLiNERContextExtractor()
        with pytest.raises(Exception, match="gliner_config.json"):
            extractor._ensure_loaded()

    def test_engine_decision_failed_on_tampered_context_model(
        self, tampered_checkpoint, tmp_path, monkeypatch
    ):
        """End-to-end: a tampered GLiNER checkpoint must route the session
        decision to FAILED (context_stage_error), never a silent release."""
        monkeypatch.setenv("COACHING_GLINER_PATH", str(tampered_checkpoint))
        monkeypatch.setenv(
            "COACHING_MODEL_MANIFEST",
            _manifest_for_checkpoint(tampered_checkpoint, tmp_path),
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
            assert "model.safetensors" in (result.report.get("context_stage_error") or ""), (
                result.report.get("context_stage_error")
            )
        finally:
            engine._EXTRACTOR_CACHE.pop("ex", None)


class TestWhisperRuntimeVerification:
    def test_tampered_whisper_file_fails_asrerror(self, tmp_path, monkeypatch):
        """A tampered whisper model dir must raise ASRError, not load."""
        src = REPO / "models" / "whisper-tiny.en"
        snaps = sorted((src).glob("models--Systran--faster-whisper-tiny.en/snapshots/*"))
        if not snaps:
            pytest.skip("real whisper model not present in this environment")
        dst_root = tmp_path / "whisper-tiny.en"
        shutil.copytree(src, dst_root)
        snap = sorted((dst_root).glob("models--Systran--faster-whisper-tiny.en/snapshots/*"))[0]
        # Tamper vocabulary.txt (small file, fast to corrupt).
        data = bytearray((snap / "vocabulary.txt").read_bytes())
        data[50] ^= 0xFF
        (snap / "vocabulary.txt").write_bytes(bytes(data))
        # Manifest repointed at the tampered root.
        manifest = json.loads((REPO / "scripts" / "model_manifest.json").read_text())
        manifest["models"]["whisper_tiny_en"]["local_path"] = str(
            (snap).relative_to(tmp_path)
        )
        out = tmp_path / "manifest.json"
        out.write_text(json.dumps(manifest))

        monkeypatch.setenv("COACHING_MODEL_MANIFEST", str(out))
        from coaching_privacy.asr import ASRError, FasterWhisperAdapter

        adapter = FasterWhisperAdapter(model_dir=str(dst_root))
        with pytest.raises(ASRError, match="vocabulary.txt"):
            adapter._ensure_model()

    def test_real_models_pass_runtime_verification(self):
        """Happy path: the real pinned models must pass the runtime check."""
        from coaching_privacy.asr import FasterWhisperAdapter
        from coaching_privacy.context_extractor import GLiNERContextExtractor

        ex = GLiNERContextExtractor()
        assert ex._verify_model_files() is None or True  # must not raise
        ad = FasterWhisperAdapter()
        ad._verify_model_files()  # must not raise
