#!/usr/bin/env python
"""ASR benchmark: WER/CER/runtime per faster-whisper model on the seeded
espeak fixture set (issue #13 slice 1).

Honesty note: the fixtures are TTS (espeak-ng) speech — NOT representative
of real speech. Results are PoC-level model-selection data only.

Usage:
  python scripts/bench_asr.py [--models tiny.en base.en ...] [--output report.json]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

PROJECT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src"))

FIXTURES = PROJECT / "fixtures" / "audio"
REFERENCES = FIXTURES / "bench_references.json"


def _peak_rss_kb() -> int:
    try:
        with open("/proc/self/status") as fh:
            for line in fh:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1])
    except OSError:
        pass
    return -1


def bench_model(model_name: str, refs: list[dict]) -> dict:
    from faster_whisper import WhisperModel

    wers, cers, runtimes = [], [], []
    from coaching_privacy.audio_metrics import cer, wer

    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         download_root=str(PROJECT / "models" / f"whisper-{model_name}"))
    for item in refs:
        wav = str(FIXTURES / item["wav"])
        t0 = time.monotonic()
        segments, info = model.transcribe(wav)
        text = " ".join(s.text for s in segments).strip()
        runtimes.append(time.monotonic() - t0)
        wers.append(wer(item["text"], text))
        cers.append(cer(item["text"], text))
    n = len(refs)
    return {
        "model": model_name,
        "wer": round(sum(wers) / n, 4),
        "cer": round(sum(cers) / n, 4),
        "runtime_s": round(sum(runtimes), 3),
        "avg_runtime_s": round(sum(runtimes) / n, 3),
        "peak_rss_kb": _peak_rss_kb(),
        "utterances": n,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark ASR models")
    parser.add_argument("--models", nargs="+", default=["tiny.en", "base.en"])
    parser.add_argument("--output", default=None)
    args = parser.parse_args(argv)

    refs = json.loads(REFERENCES.read_text())
    results = [bench_model(m, refs) for m in args.models]
    report = {
        "schema_version": "1.0",
        "fixture_note": (
            "Synthetic espeak-ng TTS speech only; NOT representative of real "
            "speech. PoC-level model-selection data; runtime WER budgeting is "
            "impossible without reference transcripts (see issue #13)."
        ),
        "fixtures": {"utterances": len(refs), "source": "fixtures/audio/bench_*.wav"},
        "results": results,
        "commands": f"python scripts/bench_asr.py --models {' '.join(args.models)}",
    }
    out = pathlib.Path(args.output) if args.output else (
        PROJECT / "docs" / "evidence" / "I13-S1" / "benchmark.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["results"], indent=2))
    print(f"report written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
