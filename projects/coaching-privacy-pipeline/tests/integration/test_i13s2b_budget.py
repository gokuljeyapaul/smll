"""I13-S2 completion RED: per-model asr_confidence thresholds + WER budget
(issue #13 slice 2, remaining plan items).

The revised plan for slice 2 requires, in addition to the selectable model
(already merged, PR #45):
  - policy per-model `asr_confidence` thresholds (from #19, calibrated with
    the benchmark data);
  - slow CI test `test_default_model_meets_wer_budget`: the default model's
    measured WER on the seeded fixture set must be <= the policy's stated
    WER budget (model-selection acceptance criterion; runtime WER budgeting
    is impossible without reference transcripts — stated honestly).
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]


def _policy_asr_confidence() -> dict:
    import yaml

    policy = REPO / "policies" / "sample_policy.yaml"
    raw = yaml.safe_load(policy.read_text()) or {}
    return raw.get("asr_confidence") or {}


def test_policy_has_per_model_asr_confidence_thresholds():
    """The policy must carry per-model threshold overrides for each
    selectable whisper model, calibrated with the benchmark data."""
    section = _policy_asr_confidence()
    per_model = section.get("per_model")
    assert isinstance(per_model, dict), section
    for model in ("tiny.en", "base.en"):
        entry = per_model.get(model)
        assert isinstance(entry, dict), per_model
        for key in (
            "min_avg_logprob_floor",
            "no_speech_prob_ceiling",
            "compression_ratio_ceiling",
            "language_probability_floor",
        ):
            assert isinstance(entry.get(key), (int, float)), (model, key)


def test_adapter_uses_per_model_thresholds(monkeypatch):
    """FasterWhisperAdapter must resolve thresholds per selected model.
    With a per-model override in the policy, selecting that model must
    change the loaded thresholds (not the shared defaults)."""
    # RED today: adapter thresholds ignore the model name.
    import os

    monkeypatch.chdir(REPO)
    monkeypatch.setenv("COACHING_WHISPER_MODEL", "base.en")
    from coaching_privacy.asr import FasterWhisperAdapter, _load_thresholds

    adapter = FasterWhisperAdapter()
    th = _load_thresholds(adapter.model_name)
    section = _policy_asr_confidence()
    expected = section["per_model"]["base.en"]
    for key, value in expected.items():
        assert float(th[key]) == float(value), (key, th, expected)


def test_policy_states_wer_budget_for_default_model():
    """The policy must state a WER budget (model-selection acceptance
    criterion on the seeded fixture set)."""
    section = _policy_asr_confidence()
    budget = section.get("wer_budget")
    assert isinstance(budget, (int, float)), section
    assert budget > 0


def test_default_model_meets_wer_budget(tmp_path):
    """Slow CI test (plan-named): run the real benchmark for the DEFAULT
    model over the seeded fixture set and assert WER <= the policy budget.

    Real inference: scripts/bench_asr.py loads the real faster-whisper
    model and transcribes all bench_*.wav fixtures with reference texts.
    """
    import os

    section = _policy_asr_confidence()
    budget = float(section["wer_budget"])
    bench = REPO / "scripts" / "bench_asr.py"
    out = tmp_path / "bench_default.json"
    env = {**os.environ, "HF_HUB_OFFLINE": "0"}
    r = subprocess.run(
        [sys.executable, str(bench), "--output", str(out),
         "--models", "tiny.en"],
        capture_output=True, text=True, cwd=REPO, timeout=1800, env=env,
    )
    assert r.returncode == 0, (r.stdout, r.stderr)
    report = json.loads(out.read_text())
    entry = next(e for e in report["results"] if e["model"] == "tiny.en")
    assert entry["utterances"] >= 30, entry
    assert entry["wer"] <= budget, (
        f"default model WER {entry['wer']} exceeds stated budget {budget}"
    )
