"""I10-S2 RED: benign fixtures S02/S10 are false-REVIEW (issue #10 slice 2).

Baseline (I10-S1): S02 and S10 expect RELEASE_CANDIDATE but get
REVIEW_REQUIRED via COMBINATION_OF_CLUES triggered by non-specific single
spans ('colleagues' RARE_ROLE 0.44; bare month 'May' as EXACT_EVENT_DATE).
All risky fixtures must stay REVIEW/BLOCKED (zero new false-RELEASE).
"""
from __future__ import annotations

import json
import pathlib

import pytest

pytestmark = pytest.mark.slow

REPO = pathlib.Path(__file__).resolve().parents[2]

RISKY = {"seed-S03", "seed-S04", "seed-S06", "seed-S08", "seed-S14", "seed-S17"}  # currently-correct REVIEW fixtures (baseline); S09a/b are baseline false-RELEASE (unchanged by this slice)


def _decisions() -> dict[str, str]:
    from coaching_privacy.contracts import Transcript
    from coaching_privacy.engine import process_transcript
    from coaching_privacy.policy import PolicyStore

    store = PolicyStore(REPO / "policies" / "sample_policy.yaml")
    out = {}
    for line in (REPO / "fixtures" / "seed_fixtures.jsonl").read_text().splitlines():
        record = json.loads(line)
        t = Transcript.parse(record["transcript"])
        result = process_transcript(
            t, store.get(t.purpose), prohibited_leaks=record.get("prohibited_leaks")
        )
        out[record["fixture_id"]] = result.decision["decision"]
    return out


def test_benign_s02_s10_now_release_candidate():
    d = _decisions()
    assert d["seed-S02"] == "RELEASE_CANDIDATE", d
    assert d["seed-S10"] == "RELEASE_CANDIDATE", d


def test_zero_new_false_release_vs_baseline():
    d = _decisions()
    for fx in RISKY:
        assert d[fx] in {"REVIEW_REQUIRED", "BLOCKED", "FAILED"}, (fx, d)
    # baseline false-RELEASE sessions are unchanged by this slice (fixing them
    # needs new detectors, out of scope; see I10-S1 findings)
    for fx in ("seed-S05", "seed-S09a", "seed-S09b", "seed-S11", "seed-S12", "seed-S13"):
        assert d[fx] == "RELEASE_CANDIDATE", (fx, d)  # unchanged baseline
    # the remaining benign fixtures stay released
    for fx in ("seed-S01", "seed-S07", "seed-S15", "seed-S16"):
        assert d[fx] == "RELEASE_CANDIDATE", (fx, d)
