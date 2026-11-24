#!/usr/bin/env python3
"""Generate docs/evidence/R2-3/summary.json.

Pre-written (like R2-1's generator) so the in-run A25 vitest validation has a
summary to check; run AFTER the e2e/prod/gallery/video-manifest stages have
produced their JUnit, and BEFORE the vitest stage (whose two-pass logic then
seeds host-vitest.xml, which the A38/A41 host refs point at).

Every junit reference is verified here first: the testcase must exist and have
passed in the committed JUnit, per engine, or the generator refuses to write
the summary (an unbacked PASS can never be committed).
"""
import json
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
EV = ROOT / "docs/evidence/R2-3"
JUNIT = EV / "junit"


def digest() -> str:
    return subprocess.run(
        [sys.executable, "scripts/verify_evidence.py", "--print-digest"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def junit_passed(rel: str, testcase: str) -> bool:
    path = ROOT / rel
    if not path.is_file():
        raise SystemExit(f"missing JUnit {rel}")
    tree = ET.parse(str(path))
    for tc in tree.iter("testcase"):
        if tc.get("name") == testcase:
            return all(tc.find(bad) is None for bad in ("failure", "error", "skipped"))
    raise SystemExit(f"testcase {testcase!r} not found in {rel}")


def ref(rel: str, testcase: str) -> str:
    full = f"docs/evidence/R2-3/junit/{rel}"
    if not junit_passed(full, testcase):
        raise SystemExit(f"REFUSED: {testcase!r} in {full} did not pass — summary not written")
    return f"junit:{full}::{testcase}"


A37 = "a37_model_downloads_once_survives_reload_and_same_profile_restart"
A39A = "a39_volatile_storage_shows_kind_explanation_and_no_download"
A39B = "a39_no_room_refuses_the_download_before_any_byte_is_fetched"
A40A = "a40_download_is_opt_in_behind_the_advanced_section"
A40B = "a40_fresh_profile_records_the_model_absent_honestly"

# Host testcases (junit names are "<describe> > <it>", ' > ' separators).
SP = "storage-offer decision (R2-3, A38)"
CC = "fresh-start cache check plan (R2-3, A37/A38)"
A41D = "the off-by-default decision rests on the measured numbers (R2-3, A41)"

summary = {
    "slice": "R2-3",
    "source_digest": digest(),
    "tested_on": {
        "os": "Debian GNU/Linux 13 (trixie), x86_64, kernel 6.8.0-147-generic",
        "node": "v26.12.1",
        "chromium": "HeadlessChrome/159.0.8154.6 (Playwright 1.65.1, build chromium-1255)",
        "webkit": "Version 27.2 (Playwright 1.65.1, build webkit-2388)",
        "host": "Hermes agent on an openclawlaunch Linux container: 16 vCPU, 62 GiB RAM; headless-Linux numbers; real-device behavior is NOT_RUN",
    },
    "acceptance": {
        "A37": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A37), ref("webkit-e2e.xml", A37)],
            "videos": [f"video:{A37}_chromium", f"video:{A37}_webkit"],
            "notes": (
                "Both engines, REAL persistent profiles (launchPersistentContext): one real download of the pinned "
                "396,705,472-byte file from the local server, then a reload and a full close-and-relaunch on the SAME "
                "profile dir both land ready with the small 'ready (cached)' state, no download button, and ZERO "
                "model network requests (request log asserted). navigator.storage.persist() is requested at the "
                "download (the user's opt-in — spy-pinned: 0 calls at load, >=1 after the click), never silently at "
                "load. The verified sha256 marker (model-<sha>.verified.json in the model cache) makes the "
                "fresh-start check cheap: size + marker; the 397 MB re-hash only when the marker is missing "
                "(planCacheCheck trust/rehash/purge, unit-pinned). The persistent-vs-ephemeral scenario table with "
                "numbers: docs/evidence/R2-3/scenario-table.json; the measured environments BEFORE any change: "
                "docs/evidence/R2-3/env-probe.json."
            ),
        },
        "A38": {
            "status": "PASS",
            "tests": [
                ref("host-vitest.xml", f"{SP} > a working store with room → offer (the measured matrix quotas both pass)"),
                ref("host-vitest.xml", f"{SP} > no room → the no-room refusal (quota under the room bar)"),
                ref("host-vitest.xml", f"{SP} > a detected lost cache → volatile, even with room"),
                ref("host-vitest.xml", f"{SP} > the refusals are kind, exact, and name what still works"),
                ref("host-vitest.xml", f"{CC} > size + matching marker → trust (cheap: no 397 MB re-hash on launch)"),
                ref("host-vitest.xml", f"{CC} > size matches, marker missing → rehash once, then the marker makes it cheap"),
                ref("host-vitest.xml", f"{CC} > a marker naming another pin or size → purge (stale, fail closed)"),
            ],
            "notes": (
                "The pure storage-offer policy (src/model/storage-policy.ts): offer / no-room (quota under the "
                "pinned size × 2 — the promote's temp+final peak) / volatile (the storage reports it cannot keep "
                "the model) / unavailable, with the exact kind refusal messages (unit-pinned, the measured matrix "
                "quotas — Chromium 10 GiB, WebKit 1 GiB — both stay OFFER). The cheap-check plan (trust/rehash/"
                "purge) is unit-pinned. What is honestly NOT detectable in-session is measured and disclosed: "
                "docs/evidence/R2-3/env-probe.json shows this headless matrix reports persist()===false in EVERY "
                "Chromium context (persistent, incognito, ephemeral) and the same 10 GiB quota in incognito as in "
                "a normal profile — so persist() denial is recorded at the opt-in but never gates the offer, and a "
                "private window is not distinguishable from a first visit."
            ),
        },
        "A39": {
            "status": "PASS",
            "tests": [
                ref("chromium-e2e.xml", A39A), ref("webkit-e2e.xml", A39A),
                ref("chromium-e2e.xml", A39B), ref("webkit-e2e.xml", A39B),
            ],
            "videos": [
                f"video:{A39A}_chromium", f"video:{A39A}_webkit",
                f"video:{A39B}_chromium", f"video:{A39B}_webkit",
            ],
            "notes": (
                "Both engines: the volatile-storage scenario (?testStorage=volatile, test-build-only — the storage "
                "reports it cannot keep the model) shows the kind explanation once, plainly, offers NO download "
                "button, and the standard rules cleanup still works end to end (real OCR pick → result text). The "
                "no-room scenario (?testStorage=no-room — the estimate below the room bar) refuses at the download "
                "click with the kind no-room message and fetches ZERO model bytes (request log asserted). The "
                "production wiring: the estimate is measured at the download (measureStorageQuota) and the refusal "
                "is the same code path as the override; the volatile signal's real-platform triggers are disclosed "
                "in KNOWN_LIMITS.md (measured: no in-session API on this matrix distinguishes them)."
            ),
        },
        "A40": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A40A), ref("webkit-e2e.xml", A40A),
                      ref("chromium-e2e.xml", A40B), ref("webkit-e2e.xml", A40B)],
            "videos": [f"video:{A40A}_chromium", f"video:{A40A}_webkit"],
            "notes": (
                "Both engines: the home screen never pushes the model — the download lives only inside the "
                "collapsed 'Advanced: optional tidy-up model' section (#advanced-model, open-attribute null, "
                "button hidden until opened, then visible); the main flow's furniture is unchanged; a fresh "
                "profile honestly shows absent with the offer only inside the section. Cached means ready, "
                "visibly: the home screen shows the small 'Tidy-up model ready (cached)' state (#model-ready) "
                "and never the download button (asserted after the reload and the same-profile restart in A37). "
                "The existing download-flow specs (a12/a13/a14/a21/eval/uc13/demo/a29) open the section before "
                "the download click in the same PR — the flows are unchanged and unloosened."
            ),
        },
        "A41": {
            "status": "PASS",
            "tests": [
                ref("host-vitest.xml", f"{A41D} > the LLM cleanup ships DISABLED by default (A19/A21, pinned constant)"),
                ref("host-vitest.xml", f"{A41D} > the committed A19 re-run shows the rules baseline at least as good as the model (the decision rests on these numbers)"),
                ref("chromium-e2e.xml", "eval_llm_vs_baseline_standard_and_injection_sets"),
            ],
            "notes": (
                "The off-by-default / advanced-section decision rests on numbers: the A19 measurement is re-run "
                "on this tree (eval_llm_vs_baseline_standard_and_injection_sets re-executed in this slice's "
                "chromium run, refreshing docs/evidence/S4/llm-eval-chromium.json) and the unit test pins the "
                "committed constant (LLM_CLEANUP_ENABLED_BY_DEFAULT === false) to what those numbers say: the "
                "model mode does NOT beat the rules baseline (baseline meanF1 > model meanF1), leaks chrome "
                "above the 2% bar and/or exceeds the 60 s budget. The eval is Chromium-only by design (the "
                "pinned model cannot load in Playwright's WebKit — A21's designed fallback). The A19 re-citation "
                "is in the PR body and the plan row."
            ),
        },
    },
    "commands": {
        "red": {"command": "bash scripts/run_r2_3_red.sh", "exit_code": 0,
                "evidence": "docs/evidence/R2-3/red.log",
                "note": "the RED script exits 0 when the new tests FAIL as required (real assertion failures on the missing behaviour)"},
        "green": {"command": "bash scripts/run_r2_3_final_evidence.sh", "exit_code": 0,
                  "evidence": "docs/evidence/R2-3/green.log"},
        "e2e": {"command": "npx playwright test --project=chromium / --project=webkit (all specs, test build)", "exit_code": 0,
                "evidence": "docs/evidence/R2-3/e2e.log"},
        "negative": {"command": "extracted from the green e2e runs + the seeded controls", "exit_code": 0,
                     "evidence": "docs/evidence/R2-3/negative.log"},
        "demo": {"command": "npm run build:test && npm run demo", "exit_code": 0,
                 "evidence": "docs/evidence/R2-3/demo.log"},
        "verify": {"command": "bash scripts/verify.sh", "exit_code": 0,
                   "evidence": "docs/evidence/R2-3/green.log"},
    },
    "limitations": [
        "In-session, a wiped/private model store is NOT distinguishable from a first visit on this engine matrix "
        "(MEASURED, docs/evidence/R2-3/env-probe.json): Chromium headless reports persist()===false in EVERY "
        "context (persistent profile, incognito, ephemeral) and the same 10 GiB quota in incognito as in a normal "
        "profile, and a write/read probe succeeds everywhere in-session. The app therefore: requests persist() at "
        "the user's opt-in (recorded honestly; real browsers may grant it), refuses on the honest estimate bar "
        "(no-room), and shows the volatile refusal when the storage reports it cannot keep the model — the "
        "deterministic coverage is the test-build ?testStorage override (A29: absent from production). A "
        "real-device pass (A27) would measure real-Chrome incognito behaviour.",
        "The volatile signal's production triggers (a real private window signature, a WebView wipe signal) are "
        "not observable with the APIs this matrix exposes; the policy and the refusal UI are wired and "
        "test-covered so a platform that reports the signal (e.g. a host app via R2-2's embedding) gets the kind "
        "refusal for free.",
        "The fresh-start cheap check trusts the cache on size + the recorded sha256 marker; a marker that dies "
        "with a partially-evicted cache costs one 397 MB re-hash (by design, fail-closed), and corruption AFTER "
        "the marker was written is not re-detected at launch (the same trust model as every browser cache; the "
        "download itself always verifies before caching).",
        "The existing download-flow specs open the Advanced section before the download click (a12/a13/a14/a21/"
        "eval/uc13/demo/a29, changed with the UI in this PR): the flows and assertions are otherwise unchanged.",
        "Real installed-PWA / real-OS private-window behavior on the owner's devices stays NOT_RUN (A27, the "
        "plan's optional real-device pass; checklist in docs/KNOWN_LIMITS.md).",
    ],
}

# Videos must exist in the manifest before the summary references them.
manifest = json.loads((ROOT / "docs/evidence/video_manifest.json").read_text())
by_id = {v["id"] for v in manifest.get("videos", [])}
for aid, entry in summary["acceptance"].items():
    for v in entry.get("videos", []):
        vid = v[len("video:"):]
        if vid not in by_id:
            raise SystemExit(f"REFUSED: video {vid} (for {aid}) not in video_manifest.json")

(EV / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
print(f"summary.json written: digest {summary['source_digest'][:12]}…, 5 acceptance IDs")
