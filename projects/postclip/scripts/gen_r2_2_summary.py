#!/usr/bin/env python3
"""Generate docs/evidence/R2-2/summary.json.

Pre-written (like R2-3's generator) so the in-run A25 vitest validation has
a summary to check; run AFTER the e2e/prod/gallery/video-manifest stages
have produced their JUnit, and BEFORE the vitest stage (whose two-pass logic
then seeds host-vitest.xml, which the A44/A46 host refs point at).

Every junit reference is verified here first: the testcase must exist and
have passed in the committed JUnit, per engine, or the generator refuses to
write the summary (an unbacked PASS can never be committed).
"""
import json
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
EV = ROOT / "docs/evidence/R2-2"
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
    full = f"docs/evidence/R2-2/junit/{rel}"
    if not junit_passed(full, testcase):
        raise SystemExit(f"REFUSED: {testcase!r} in {full} did not pass — summary not written")
    return f"junit:{full}::{testcase}"


A42A = "a42_home_screen_no_overflow_and_tappable_primary_action_at_every_viewport"
A42B = "a42_result_screen_fluid_through_the_viewport_matrix_one_real_read"
A43A = "a43_app_runs_inside_cross_origin_iframe_pick_flow_works_in_frame"
A43B = "a43_copy_in_frame_without_clipboard_allow_falls_back_and_says_so"
A45A = "a45_cross_origin_host_round_trip_load_image_to_result"
A45B = "a45_message_from_non_allowlisted_origin_is_ignored"

# Host testcases (junit names are "<describe> > <it>", ' > ' separators).
HL = "host allow-list (R2-2, A44)"
LV = "host load-image validation (R2-2, A44)"
RT = "host reply targets (R2-2, A44)"
HB = "host bridge (R2-2, A44/A45)"
EB = "embedded behaviour source scan (R2-2, A43)"
ML = "mobile-first layout facts (R2-2, A42)"
IH = "INTEGRATION.md documents the shipped contract (R2-2, A46)"

summary = {
    "slice": "R2-2",
    "source_digest": digest(),
    "tested_on": {
        "os": "Debian GNU/Linux 13 (trixie), x86_64, kernel 6.8.0-147-generic",
        "node": "v26.12.1",
        "chromium": "HeadlessChrome/159.0.8154.6 (Playwright 1.65.1, build chromium-1255)",
        "webkit": "Version 27.2 (Playwright 1.65.1, build webkit-2388)",
        "host": "Hermes agent on an openclawlaunch Linux container: 16 vCPU, 62 GiB RAM; headless-Linux numbers; real-device behavior is NOT_RUN",
    },
    "acceptance": {
        "A42": {
            "status": "PASS",
            "tests": [
                ref("chromium-e2e.xml", A42A), ref("webkit-e2e.xml", A42A),
                ref("chromium-e2e.xml", A42B), ref("webkit-e2e.xml", A42B),
                ref("host-vitest.xml", f"{ML} > uses 100dvh for viewport-relative height (never a bare 100vh)"),
                ref("host-vitest.xml", f"{ML} > keeps a minimum 44px touch target on interactive elements"),
                ref("host-vitest.xml", f"{ML} > respects safe-area insets"),
            ],
            "videos": [f"video:{A42A}_chromium", f"video:{A42A}_webkit",
                       f"video:{A42B}_chromium", f"video:{A42B}_webkit"],
            "notes": (
                "Both engines, the issue's full viewport matrix (320x568, 390x844, 768x1024, 1280x800) in BOTH "
                "color schemes on the home screen: no horizontal overflow anywhere (document scrollWidth <= "
                "viewport), the primary action (Choose screenshot) visible and fully inside the viewport with "
                "touch targets >= 44 px; the result screen walks the same matrix by resizing one real-OCR page "
                "(one real read per engine, then 320/390/768/1280 resize checks on Copy: visible, >= 44 px, "
                "inside the frame). Unit-pinned CSS facts: 100dvh (with the vh fallback line only ever "
                "preceding a dvh line), safe-area insets, a 44 px minimum touch target (the primary Copy "
                "at 56 px keeps a33's >1.2x proportion), and the standard mobile viewport meta — measured: "
                "WebKit logs a console error for the Chromium-only interactive-widget key, so the meta "
                "carries no engine-specific keys (A01's no-console-errors gate wins; keyboard-open "
                "friendliness is the 100dvh shell sizing, not a meta key). The layout keeps no assumption "
                "about owning the window: the shell sizes against the frame's dynamic viewport."
            ),
        },
        "A43": {
            "status": "PASS",
            "tests": [
                ref("chromium-e2e.xml", A43A), ref("webkit-e2e.xml", A43A),
                ref("chromium-e2e.xml", A43B), ref("webkit-e2e.xml", A43B),
                ref("host-vitest.xml", f"{EB} > never touches window.top, window.open or window.opener in shipped source"),
            ],
            "videos": [f"video:{A43A}_chromium", f"video:{A43A}_webkit",
                       f"video:{A43B}_chromium", f"video:{A43B}_webkit"],
            "notes": (
                "Both engines: the app runs inside a cross-origin iframe (the host test page on a second local "
                "origin) — the home screen renders, the pick flow runs INSIDE the frame through the real "
                "in-browser OCR to the result screen, and the embedding host page records zero page errors. "
                "Where the frame blocks clipboard-write WITHOUT an allow= policy (the issue's exact example), "
                "Chromium shows the specific, kind fallback ('Copying is blocked here… select the text below "
                "and copy it yourself') with no 'Copied' note — never a silent failure; WebKit's in-frame "
                "clipboard behavior is attempted and recorded (the test asserts the no-silent-failure "
                "invariant: a visible outcome, copied OR explained). Source-scan (unit): no window.top, "
                "window.open or window.opener anywhere in shipped source."
            ),
        },
        "A44": {
            "status": "PASS",
            "tests": [
                ref("host-vitest.xml", f"{HL} > defaults to EMPTY: nothing is accepted from other origins"),
                ref("host-vitest.xml", f"{HL} > parses URL-encoded comma-separated origins from the query param"),
                ref("host-vitest.xml", f"{HL} > drops invalid entries and normalizes to the origin (no path, no guess)"),
                ref("host-vitest.xml", f"{HL} > merges build-time env origins with query-param origins, de-duplicated"),
                ref("host-vitest.xml", f"{LV} > accepts a well-formed message from an allow-listed origin"),
                ref("host-vitest.xml", f"{LV} > rejects the wrong type, missing fields and wrong shapes (why: bad-message)"),
                ref("host-vitest.xml", f"{LV} > rejects images over the 33554432 byte cap (why: too-large)"),
                ref("host-vitest.xml", f"{LV} > rejects every mime outside the allow-list (why: unsupported-mime)"),
                ref("host-vitest.xml", f"{RT} > replies only to an allow-listed origin, never \"*\""),
                ref("host-vitest.xml", f"{HB} > posts postclip:ready to each allow-listed origin on boot"),
                ref("host-vitest.xml", f"{HB} > a load-image from a NON-allow-listed origin is ignored — no reply, no handler call"),
                ref("host-vitest.xml", f"{HB} > reportResult replies to the origin the load came from (allow-listed), never \"*\""),
            ],
            "notes": (
                "The contract is pure, unit-tested logic in src/host/messaging.ts: parseHostOrigins (URL-encoded "
                "comma-separated http(s) origins; invalid entries dropped, never coerced), hostAllowList "
                "(build-time VITE_POSTCLIP_HOST_ORIGINS + ?host= query param, de-duplicated; DEFAULT EMPTY — "
                "nothing accepted), validateHostLoadImage (origin gate FIRST — a non-allow-listed sender is "
                "ignored before its content is inspected or logged; then exact shape: type, Blob/ArrayBuffer "
                "image, bounded requestId; then the MIME allow-list image/png|jpeg|webp; then the 32 MiB size "
                "cap), replyTargetFor (allow-listed origin or null — never '*'). The bridge (createHostBridge) "
                "installs NOTHING when the allow-list is empty or the app is not embedded (standalone usage is "
                "byte-for-byte unaffected), posts postclip:ready to each allow-listed origin on boot, replies "
                "only to the origin an accepted load came from, and ignores non-allow-listed senders with no "
                "reply and no content logging. Documented in docs/INTEGRATION.md (docs-honesty unit-pinned: "
                "the message types, the 32 MiB cap and the MIME allow-list in the doc are the code's)."
            ),
        },
        "A45": {
            "status": "PASS",
            "tests": [
                ref("chromium-e2e.xml", A45A), ref("webkit-e2e.xml", A45A),
                ref("chromium-e2e.xml", A45B), ref("webkit-e2e.xml", A45B),
            ],
            "videos": [f"video:{A45A}_chromium", f"video:{A45A}_webkit",
                       f"video:{A45B}_chromium", f"video:{A45B}_webkit"],
            "notes": (
                "Both engines, TWO local origins: the host test page (e2e/fixtures/host/host.html, served on "
                "4199) embeds the app (4173) in a cross-origin iframe. The allow-listed page "
                "(http://localhost:4199 allow-listed via ?host=) receives postclip:ready on boot with the "
                "app's origin recorded per message; its postclip:load-image (a real PNG Blob) drives the real "
                "in-browser OCR inside the frame and the result text (> 40 chars, real OCR output) comes back "
                "as postclip:result — every reply's origin asserted to be exactly the app's. The stranger page "
                "(http://127.0.0.1:4199, NOT allow-listed while localhost:4199 is) gets NOTHING: its load-image "
                "is ignored (no reading state inside the frame within the wait window, home screen intact, "
                "zero messages received — an untrusted origin is never replied to, and not even postclip:ready "
                "reaches it because the reply targetOrigin never matches). Privacy on both sides: the host "
                "page's URL unchanged and its localStorage/sessionStorage empty; the embedded app's "
                "localStorage/sessionStorage empty (the only thing that leaves the app is the result "
                "postMessage to the allow-listed origin; the demo host keeps the text in the DOM only — that "
                "is the feature)."
            ),
        },
        "A46": {
            "status": "PASS",
            "tests": [
                ref("host-vitest.xml", f"{IH} > names every message type the code ships"),
                ref("host-vitest.xml", f"{IH} > states the exact size cap the code enforces"),
                ref("host-vitest.xml", f"{IH} > states the MIME allow-list the code enforces"),
                ref("host-vitest.xml", f"{IH} > documents the frame-ancestors HTTP header (meta CSP cannot set it)"),
                ref("host-vitest.xml", f"{IH} > gives a working example config for a static dist/"),
                ref("host-vitest.xml", f"{IH} > documents the iframe allow=/sandbox recommendation"),
                ref("host-vitest.xml", f"{IH} > states the storage-partitioning reality inside frames"),
                ref("host-vitest.xml", f"{IH} > states the origin allow-list default (none accepted) and the never-\"*\" reply rule"),
                ref("chromium-e2e.xml", "a15_no_storage_log_request_leaks_after_flows"),
            ],
            "notes": (
                "docs/INTEGRATION.md is the single source of truth for hosting and the hand-off: the exact "
                "frame-ancestors HTTP header the host must send (a <meta> CSP cannot set frame-ancestors — "
                "the spec ignores it in meta policies) with working example configs for the static dist/ this "
                "repo builds (nginx, Caddy, and a plain Node static server), the iframe allow=/sandbox "
                "recommendation that keeps the app working (allow=\"clipboard-write\" recommended; a "
                "sandbox=\"allow-scripts\" variant documented with its honest costs: opaque origin → no "
                "service worker, no model cache, clipboard blocked → the kind fallback), and the "
                "storage-partitioning reality inside frames (third-party storage is partitioned and often "
                "wiped; the app works with ephemeral storage — the rules cleanup needs none, and the model "
                "cache case links to A39's first-class volatile handling). The docs-honesty unit suite pins "
                "the doc to the code (message types, 32 MiB cap, MIME allow-list, the never-\"*\" reply "
                "rule, the default-empty allow-list). The A15 no-storage audit re-ran green on this tree "
                "(this slice's junit) — the contract adds exactly one allowed channel (the result postMessage "
                "to the allow-listed origin) and no post text enters any URL, storage, console or network "
                "request on either side (asserted per-flow in the a45 spec too)."
            ),
        },
    },
    "commands": {
        "red": {"command": "bash scripts/run_r2_2_red.sh", "exit_code": 0,
                "evidence": "docs/evidence/R2-2/red.log",
                "note": "the RED script records the new suites failing on the pre-implementation app (typecheck+lint green, behavioural assertion failures)"},
        "green": {"command": "bash scripts/run_r2_2_final_evidence.sh", "exit_code": 0,
                  "evidence": "docs/evidence/R2-2/green.log"},
        "e2e": {"command": "npx playwright test --project=chromium / --project=webkit (all specs, test build)",
                "exit_code": 0, "evidence": "docs/evidence/R2-2/e2e.log"},
        "negative": {"command": "extracted from the green e2e runs + the seeded controls", "exit_code": 0,
                     "evidence": "docs/evidence/R2-2/negative.log"},
        "demo": {"command": "npm run build:test && npm run demo", "exit_code": 0,
                 "evidence": "docs/evidence/R2-2/demo.log"},
        "verify": {"command": "bash scripts/verify.sh", "exit_code": 0,
                   "evidence": "docs/evidence/R2-2/green.log"},
    },
    "limitations": [
        "Real WebView embedding (Android System WebView, iOS WKWebView) is NOT_RUN on this runner (A27): the "
        "e2e coverage uses Playwright's Chromium and WebKit with a real cross-origin iframe from a second "
        "local server — the same embedding mechanics a WebView uses, but not the real shells.",
        "WebKit's clipboard-write behavior inside a cross-origin iframe without allow= is not deterministically "
        "blockable on this matrix; the a43 test asserts the engine-invariant (a visible outcome, copied OR "
        "explained) and Chromium (deterministically blocked) pins the specific kind fallback message. "
        "Attempted and recorded, never faked.",
        "The origin allow-list travels in the ?host= query parameter (URL-encoded origins only, never post "
        "content); a host that cannot control its embed URL should use the build-time "
        "VITE_POSTCLIP_HOST_ORIGINS instead. Both are documented in docs/INTEGRATION.md.",
        "The host channel bounds images at 32 MiB and the MIME allow-list to png/jpeg/webp (the formats the "
        "sniff stage reads); a host needing other formats would be a plan change, not a config.",
        "postclip:result may arrive more than once for a requestId when the optional (off-by-default) model "
        "cleanup upgrades the text after the standard result — the last one wins; documented in "
        "docs/INTEGRATION.md.",
        "Real-device behavior (real mobile share sheets, real WebViews, real OS clipboards) stays NOT_RUN "
        "(A27/A30, the plan's optional device pass).",
    ],
}

out = EV / "summary.json"
out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(summary['acceptance'])} acceptance IDs, digest {summary['source_digest'][:12]}…)")
