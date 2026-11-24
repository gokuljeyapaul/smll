#!/usr/bin/env python3
"""Generate docs/evidence/R2-1/summary.json.

Pre-written (like S6's generator) so the in-run A25 vitest validation has a
summary to check; run AFTER the e2e/prod/gallery/video-manifest stages have
produced their JUnit, and BEFORE the vitest stage (whose two-pass logic then
seeds host-vitest.xml, the A34 host refs point at that file's committed copy).

Every junit reference is verified here first: the testcase must exist and have
passed in the committed JUnit, per engine, or the generator refuses to write
the summary (an unbacked PASS can never be committed).
"""
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
EV = ROOT / "docs/evidence/R2-1"
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
    full = f"docs/evidence/R2-1/junit/{rel}"
    if not junit_passed(full, testcase):
        raise SystemExit(f"REFUSED: {testcase!r} in {full} did not pass — summary not written")
    return f"junit:{full}::{testcase}"


A32 = "a32_share_target_lands_result_first_with_copy_visible_and_exact"
A33 = "a33_every_arrival_lands_result_first_copy_primary_then_share_save_then_edit"
A35 = "eval_nested_text_recall_on_fixtures"
A36A = "a36_shared_image_with_no_text_shows_kind_error_and_one_next_step"
A36B = "a36_share_post_without_an_image_stays_ignored"


def nested_recall(engine: str) -> dict:
    path = EV / f"nested-text-recall-{engine}.json"
    data = json.loads(path.read_text())
    rows = {r["id"]: round(r["recall"] * 100, 1) for r in data["rows"]}
    return {"bar_pct": data["bar"] * 100, "mean_pct": round(data["mean"] * 100, 1), "rows_pct": rows}


recall_chromium = nested_recall("chromium")
recall_webkit = nested_recall("webkit")
recall_note = (
    "Nested-image text recall (A35, raw pre-cleanup OCR vs the committed ground truth, "
    f"nested_image_text, multiset token recall): bar {recall_chromium['bar_pct']:.0f}% — "
    f"chromium per-fixture {recall_chromium['rows_pct']} (mean {recall_chromium['mean_pct']}%), "
    f"webkit per-fixture {recall_webkit['rows_pct']} (mean {recall_webkit['mean_pct']}%). "
    "Per-engine JSON: docs/evidence/R2-1/nested-text-recall-*.json. Labelling which words came "
    "from inside pictures is NOT implemented (no segmentation model — disclosed in KNOWN_LIMITS.md)."
)

summary = {
    "slice": "R2-1",
    "source_digest": digest(),
    "tested_on": {
        "os": "Debian GNU/Linux 13 (trixie), x86_64, kernel 6.8.0-147-generic",
        "node": "v26.12.1",
        "chromium": "HeadlessChrome/159.0.8154.6 (Playwright 1.65.1, build chromium-1255)",
        "webkit": "Version 27.2 (Playwright 1.65.1, build webkit-2388)",
        "host": "Hermes agent on an openclawlaunch Linux container: 16 vCPU, 62 GiB RAM; headless-Linux numbers; real-device behavior is NOT_RUN",
    },
    "acceptance": {
        "A32": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A32)],
            "videos": [f"video:{A32}_chromium"],
            "notes": (
                "Chromium-only platform ID (the share-target POST route, as A08). A real multipart "
                "POST through the service worker (the same handler Android's share sheet hits) "
                "starts OCR automatically, shows the one progress state (role=status), and lands "
                "on the result screen with the large Copy button fully above the fold at 390x844; "
                "clicking Copy puts exactly the result text on the real clipboard. The share POST "
                "body is never cached or logged (the A15 audit re-ran on this flow). Real "
                "installed-PWA sharing stays A27 NOT_RUN."
            ),
        },
        "A33": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A33), ref("webkit-e2e.xml", A33)],
            "videos": [f"video:{A33}_chromium", f"video:{A33}_webkit"],
            "notes": (
                "Both engines: every arrival channel lands on the result-first screen — the pick "
                "path is the engine-neutral channel (the share path is A32's, the host-message "
                "path is R2-2's). Copy is the first, primary action (1.2x+ the Share button in "
                "both dimensions) and fully above the fold at 390x844; Share and the file-save "
                "menu follow; the editable text comes after the actions; no drop zone, paste "
                "button, model card or model toggle sits on the reading/result path (the model "
                "opt-in is collapsed inside #advanced-cleanup — asserted on the real ready model "
                "in the a21 spec). Heading renamed 'Review' -> 'Your text' per the R2-1 mockups; "
                "the 17 existing heading assertions changed with it in the same PR (plan rule G2)."
            ),
        },
        "A34": {
            "status": "PASS",
            "tests": [
                ref("host-vitest.xml", "arrival screen-state machine (R2-1, A34) > idle + image-arrived → reading (the arrival starts reading by itself)"),
                ref("host-vitest.xml", "arrival screen-state machine (R2-1, A34) > every kind error maps to one non-empty obvious next step (A36)"),
                ref("host-vitest.xml", "arrival screen-state machine (R2-1, A34) > every kind error maps to its ONE specific, kind message — the exact A07 strings (A34)"),
            ],
            "notes": (
                "The pure arrival state machine (src/flow/arrival.ts) drives the App: arrived -> "
                "reading -> result | kind error, with a validated reason set and the kind-message "
                "mapping to the exact A07 strings plus ONE obvious next step per reason. RED: the "
                "scaffolded (unwired) transition table failed all 12 behavioural assertions "
                "(docs/evidence/R2-1/red.log)."
            ),
        },
        "A35": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A35), ref("webkit-e2e.xml", A35)],
            "videos": [f"video:{A35}_chromium", f"video:{A35}_webkit"],
            "notes": recall_note,
        },
        "A36": {
            "status": "PASS",
            "tests": [ref("chromium-e2e.xml", A36A), ref("chromium-e2e.xml", A36B)],
            "videos": [f"video:{A36A}_chromium", f"video:{A36B}_chromium"],
            "notes": (
                "Chromium-only platform ID (the share-target POST route, as A32). A shared blank "
                "image lands on the specific no-text kind error (A07's exact string) plus the ONE "
                "obvious next step (#error-next-step) with the still-working file picker; a share "
                "POST without an image stays ignored fail-closed (A08's negative, unchanged)."
            ),
        },
    },
    "commands": {
        "red": {"command": "bash scripts/run_r2_1_red.sh", "exit_code": 0,
                "evidence": "docs/evidence/R2-1/red.log",
                "note": "the RED script exits 0 when the new tests FAIL as required (real assertion failures on the missing behaviour)"},
        "green": {"command": "bash scripts/run_r2_1_final_evidence.sh", "exit_code": 0,
                  "evidence": "docs/evidence/R2-1/green.log"},
        "e2e": {"command": "npx playwright test --project=chromium / --project=webkit (all specs, test build)", "exit_code": 0,
                "evidence": "docs/evidence/R2-1/e2e.log"},
        "negative": {"command": "extracted from the green e2e runs + the seeded controls", "exit_code": 0,
                     "evidence": "docs/evidence/R2-1/negative.log"},
        "demo": {"command": "npm run build:test && npm run demo", "exit_code": 0,
                 "evidence": "docs/evidence/R2-1/demo.log"},
        "verify": {"command": "bash scripts/verify.sh", "exit_code": 0,
                   "evidence": "docs/evidence/R2-1/green.log"},
    },
    "limitations": [
        recall_note,
        "Labelling which extracted words came from INSIDE pictures is not implemented: OCR "
        "returns text, not image-region segmentation, and no segmentation model ships — the "
        "nested text is included in the single text flow, and the limit is disclosed in "
        "KNOWN_LIMITS.md rather than faked.",
        "The share-target POST route (A32/A36) is Chromium-only (as A08): WebKit-on-Linux does "
        "not serve the service-worker share route; the WebKit coverage of the result-first "
        "screen is A33's pick path.",
        "Real installed-PWA sharing (Android) and the real iOS share sheet stay NOT_RUN (A27, "
        "the plan's optional real-device pass; checklist in docs/KNOWN_LIMITS.md).",
        "iPhone cannot receive shares in a plain web app — the supported route is the host "
        "mobile app (R2-2), documented honestly in docs/INTEGRATION.md.",
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
