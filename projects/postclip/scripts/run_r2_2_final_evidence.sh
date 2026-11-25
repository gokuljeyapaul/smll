#!/usr/bin/env bash
# R2-2 FINAL evidence run: one all-green pass on the final tree (resumable by
# stage — a late failure must not re-run the long browser stages).
#   green.log    — model fetch/verify + test build + test-build inspection
#                   (negative control semantics, written down: inspect_bundle
#                   dist test exits 0 when the test-hook detector TRIPPED as
#                   expected AND no other problem was found; exit 1 means the
#                   control failed to trip or found extra problems) + lint +
#                   summary generation + vitest (two-pass) + EXIT CODES
#   e2e.log      — playwright chromium + webkit on the TEST build (all specs,
#                   incl. e2e/r2_2_responsive.spec.ts + e2e/r2_2_embedded.spec.ts)
#   prod.log     — production build + inspection (CLEAN, exit 0 = clean) +
#                   e2e/prod per engine
#   negative.log — negative-path output extracted from e2e.log (incl. the
#                   R2-2 controls: the blocked-clipboard fallback message and
#                   the non-allow-listed-origin ignore) + the seeded controls
#                   + the RED headline lines
#   demo.log     — the full demo in the test build
#   junit/       — chromium*.xml, webkit*.xml, host*.xml (conventional names)
#   owner/       — the O08 gallery (scripts/capture_owner_gallery_r2_2.mjs)
#   versions.json — the R2-2 toolchain record
# Stage markers live in .cache/r2-2-stages/ — delete one to re-run its stage.
# Run: bash scripts/run_r2_2_final_evidence.sh
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright
fi
EV=docs/evidence/R2-2
STAGES=.cache/r2-2-stages
mkdir -p "$EV/junit" artifacts "$STAGES"

EXITCODES=()
stage() {  # stage <n> <name> — runs the caller's body unless already marked
  local n="$1"; shift
  if [ -f "$STAGES/$n.done" ]; then
    echo "== stage $n ($*) SKIPPED (marker $STAGES/$n.done present) =="
    return 0
  fi
  return 1
}
mark() { touch "$STAGES/$1.done"; }

# ---------------- stage 1: model + test build + inspections + lint ----------
if ! stage 1 "model+build+lint"; then
  echo "== model fetch/verify (no-op when the pinned file is already cached) == " > "$EV/green.log"
  node scripts/fetch_model.mjs >> "$EV/green.log" 2>&1; EXITCODES+=("model=$?")
  npm run build:test --silent >> "$EV/green.log" 2>&1; EXITCODES+=("build_test=$?")
  echo "== bundle inspection: TEST build (negative control — the detector must TRIP; exit 0 = tripped cleanly, exit 1 = control failure) == " >> "$EV/green.log"
  node scripts/inspect_bundle.mjs dist test > "$EV/bundle-inspection-test-build.txt" 2>&1
  EXITCODES+=("inspect_test_control=$?")
  npm run lint >> "$EV/green.log" 2>&1; EXITCODES+=("lint=$?")
  mark 1
fi

# ---------------- stage 2: chromium e2e (TEST build) -------------------------
if ! stage 2 "chromium-e2e"; then
  pkill -f '[s]erve_model' 2>/dev/null || true
  rm -f artifacts/model-server.log artifacts/offline-request-log.txt
  echo "== playwright chromium (all specs, TEST build) == " > "$EV/e2e.log"
  PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-e2e.xml" \
    npx playwright test --project=chromium --reporter=list,junit >> "$EV/e2e.log" 2>&1
  EXITCODES+=("chromium=$?")
  rm -rf artifacts/video-raw-chromium && cp -r test-results artifacts/video-raw-chromium
  mv artifacts/model-server.log "$EV/model-server-chromium.log" 2>/dev/null \
    || echo "no chromium model-server log" >> "$EV/e2e.log"
  mark 2
fi

# ---------------- stage 3: webkit e2e (TEST build) ---------------------------
if ! stage 3 "webkit-e2e"; then
  pkill -f '[s]erve_model' 2>/dev/null || true
  rm -f artifacts/model-server.log artifacts/offline-request-log.txt
  echo "== playwright webkit (all specs, TEST build) == " >> "$EV/e2e.log"
  PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-e2e.xml" \
    npx playwright test --project=webkit --reporter=list,junit >> "$EV/e2e.log" 2>&1
  EXITCODES+=("webkit=$?")
  rm -rf artifacts/video-raw-webkit && cp -r test-results artifacts/video-raw-webkit
  mv artifacts/model-server.log "$EV/model-server-webkit.log" 2>/dev/null \
    || echo "no webkit model-server log" >> "$EV/e2e.log"
  mark 3
fi

# ---------------- stage 4: production build + e2e/prod per engine ------------
if ! stage 4 "prod-build+prod-e2e"; then
  echo "== production build + inspection (exit 0 = CLEAN) + e2e/prod per engine == " > "$EV/prod.log"
  npm run build --silent >> "$EV/prod.log" 2>&1; EXITCODES+=("prod_build=$?")
  node scripts/inspect_bundle.mjs dist prod > "$EV/bundle-inspection.txt" 2>&1
  EXITCODES+=("inspect_prod=$?")   # expected 0 (CLEAN)
  cat "$EV/bundle-inspection.txt" >> "$EV/prod.log"
  pkill -f '[s]erve_model' 2>/dev/null || true
  POSTCLIP_PROD_RUN=1 PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-prod-e2e.xml" \
    npx playwright test --project=chromium e2e/prod --reporter=list,junit >> "$EV/prod.log" 2>&1
  EXITCODES+=("prod_chromium=$?")
  cp -r test-results/. artifacts/video-raw-chromium/ 2>/dev/null || true
  POSTCLIP_PROD_RUN=1 PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-prod-e2e.xml" \
    npx playwright test --project=webkit e2e/prod --reporter=list,junit >> "$EV/prod.log" 2>&1
  EXITCODES+=("prod_webkit=$?")
  cp -r test-results/. artifacts/video-raw-webkit/ 2>/dev/null || true
  # stage 4 leaves dist/ as the PRODUCTION build; stage 5 (gallery) rebuilds the test build.
  mark 4
fi

# ---------------- stage 5: owner gallery (O08) + video manifest --------------
if ! stage 5 "owner-gallery+video-manifest"; then
  echo "== O08 owner gallery (from the passing test build; rebuild test first) == " >> "$EV/green.log"
  npm run --silent build:test >> "$EV/green.log" 2>&1
  node scripts/capture_owner_gallery_r2_2.mjs >> "$EV/green.log" 2>&1; GALLERY_EXIT=$?
  EXITCODES+=("owner_gallery=$GALLERY_EXIT")
  echo "== video manifest (R2-2 testcases appended; refs point at the R2-2 junit) == " >> "$EV/green.log"
  node scripts/build_video_manifest.mjs R2-2 "$EV/junit" >> "$EV/green.log" 2>&1; EXITCODES+=("video_manifest=$?")
  if [ "$GALLERY_EXIT" = 0 ]; then mark 5; fi
fi

# ---------------- stage 6: vitest bootstrap + summary + vitest final -------
# Chicken-and-egg, resolved explicitly (as R2-1/R2-3): the A25 evidence test
# needs summary.json, the summary's A44/A46 host refs need host-vitest.xml,
# and host-vitest.xml is what vitest produces. Order:
#   pass 1 — every unit test except the 4 summary-missing blocks of
#            evidence-integrity-r2-2 must pass; their (otherwise green) run
#            seeds host-vitest.xml;
#   summary — gen_r2_2_summary.py verifies every ref against the seeded JUnit
#            (it refuses to write an unbacked PASS);
#   pass 2 — everything green; its output becomes the committed host-vitest.xml.
if ! stage 6 "vitest+summary"; then
  echo "== vitest (two-pass, A25 in-run validation; the summary's host refs need the pass-1 junit) == " >> "$EV/green.log"
  if [ ! -f "$EV/junit/host-vitest.xml" ]; then
    npx vitest run --reporter=default --reporter=junit \
      --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
    P1_EXIT=$?
    P1_FAILS=$(grep -c "<failure\|<error" "$EV/junit/host-vitest.staging.xml" || true)
    P1_A25=$(grep -c "evidence integrity (A25, R2-2)" "$EV/junit/host-vitest.staging.xml" || true)
    if [ "$P1_EXIT" = 1 ] && [ "$P1_FAILS" = 4 ] && [ "$P1_A25" -ge 4 ] && [ ! -f "$EV/summary.json" ]; then
      mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
      echo "bootstrap: seeded host-vitest.xml from pass 1 (4 expected failures, all the summary-missing A25 blocks)" | tee -a "$EV/green.log"
    else
      echo "vitest pass 1 UNEXPECTED (exit $P1_EXIT, $P1_FAILS failing testcases, $P1_A25 A25 blocks) — not seeding; fix and re-run." | tee -a "$EV/green.log"
      exit 1
    fi
  fi
  echo "== summary.json generation (every junit ref verified against the committed JUnit) == " >> "$EV/green.log"
  python3 scripts/gen_r2_2_summary.py >> "$EV/green.log" 2>&1; SUMMARY_EXIT=$?
  EXITCODES+=("summary=$SUMMARY_EXIT")
  if [ "$SUMMARY_EXIT" != 0 ]; then
    echo "summary generation REFUSED — not running pass 2; see green.log." | tee -a "$EV/green.log"
    exit 1
  fi
  npx vitest run --reporter=default --reporter=junit \
    --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
  UNIT_EXIT=$?
  if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi
  EXITCODES+=("unit=$UNIT_EXIT")
  if [ "$UNIT_EXIT" = 0 ]; then mark 6; fi
fi

# ---------------- stage 8: demo ------------------------------------------------
if ! stage 8 "demo"; then
  echo "== demo == " > "$EV/demo.log"
  pkill -f '[s]erve_model' 2>/dev/null || true
  npm run --silent build:test >> "$EV/demo.log" 2>&1; BUILD_TEST_EXIT=$?
  npm run --silent demo >> "$EV/demo.log" 2>&1; DEMO_EXIT=$?
  echo "exit codes: build_test=$BUILD_TEST_EXIT demo=$DEMO_EXIT" >> "$EV/demo.log"
  EXITCODES+=("demo_build_test=$BUILD_TEST_EXIT")
  EXITCODES+=("demo=$DEMO_EXIT")
  if [ "$BUILD_TEST_EXIT" = 0 ] && [ "$DEMO_EXIT" = 0 ]; then mark 8; fi
fi

# ---------------- stage 9: negative.log + versions.json + verify ------------
if ! stage 9 "negative+versions+verify"; then
  {
    echo "# R2-2 negative-path output — extracted from the same green runs as e2e.log"
    echo "# (plus the bundle-inspection negative control)"
    echo "#"
    echo "# R2-2 negative-control EXIT SEMANTICS (written down):"
    echo "#   a43_copy_in_frame_without_clipboard_allow_falls_back_and_says_so — exit 0 means the"
    echo "#     control RAN, the frame blocked clipboard-write, and the suite CAUGHT the block"
    echo "#     (the kind fallback message asserted visible; a silent failure would fail the test);"
    echo "#   a45_message_from_non_allowlisted_origin_is_ignored — exit 0 means the control RAN,"
    echo "#     a non-allow-listed sender's load-image was sent, and the suite CAUGHT the ignore"
    echo "#     (no reading state, zero replies to the stranger; a slip-through would fail)."
    echo "#   An inverted expectation would print a wrong verdict while every stage was green."
    echo
    grep -E -A6 "a13_wrong_hash_falls_back|a13_truncated_file_falls_back|a13_unsupported_browser_banner|a13_model_404_falls_back|uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak|a08_share_target_ignores_posts_without_an_image|a10_denied_paste_explains_and_picker_works|a21_without_a_ready_model|uc13_injection_posts_are_content|a36_shared_image_with_no_text_shows_kind_error_and_one_next_step|a36_share_post_without_an_image_stays_ignored|a39_volatile_storage_shows_kind_explanation_and_no_download|a39_no_room_refuses_the_download_before_any_byte_is_fetched|a43_copy_in_frame_without_clipboard_allow_falls_back_and_says_so|a45_message_from_non_allowlisted_origin_is_ignored" "$EV/e2e.log" | grep -v '^--$'
    echo
    echo "== bundle inspection negative control (TEST build: the detector must TRIP; exit 0 = tripped cleanly) =="
    cat "$EV/bundle-inspection-test-build.txt"
    echo
    echo "== R2-2 RED evidence: the new tests failing on the pre-implementation app (headline lines) =="
    grep -E "Tests  18 failed|vitest \(host suites\) exit code|playwright \(new R2-2 specs, chromium\) exit code" "$EV/red.log" | head -6
  } > "$EV/negative.log"

  node - "$EV" <<'EOF' >> "$EV/green.log" 2>&1
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const v = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8' }).split('\n')[0].trim();
const pw = v('npx', ['playwright', '--version']);
writeFileSync('docs/evidence/R2-2/versions.json', JSON.stringify({
  slice: 'R2-2',
  toolchain: {
    node: v('node', ['--version']),
    npm: `${v('npm', ['--version'])} (package-lock.json, npm ci)`,
    vite: '8.3.8',
    typescript: '5.9.3',
    vitest: '5.1.1',
    eslint: '9 (typescript-eslint 8.73.0)',
    react: '19.3.1',
    playwright: pw.replace('Version ', ''),
    chromium: 'HeadlessChrome/159.0.8154.6 (Playwright build chromium-1255)',
    webkit: 'Version 27.2 (Playwright build webkit-2388)',
    ffmpeg: v('ffprobe', ['-version']),
    axe_core: '@axe-core/playwright 4.14.0 (axe-core 4.10.3 bundled)',
  },
  r2_2_additions: {
    host_contract: 'src/host/messaging.ts — the postMessage contract (postclip:load-image/ready/result/error), origin allow-list (?host= query param + VITE_POSTCLIP_HOST_ORIGINS build-time, DEFAULT EMPTY), 32 MiB cap, image/png|jpeg|webp allow-list, replies only to allow-listed origins (never "*")',
    bridge: 'createHostBridge installs nothing when standalone or allow-list empty — byte-for-byte unchanged standalone usage; wired in App.tsx on the arrival pipeline (load-image → real OCR → result/error postMessage)',
    embedded_fallbacks: 'src/ui/Review.tsx — the kind blocked-clipboard fallback message when a frame blocks clipboard-write (never silent); no window.top/window.open/opener anywhere (source-scan unit-pinned)',
    responsive: 'src/styles.css — mobile-first fluid layout, 100dvh (vh only as the line before a dvh line), safe-area insets, 44px minimum touch targets (the primary Copy at 56px keeps a33 proportion); index.html keeps the standard engine-clean viewport meta (measured: WebKit console-errors the Chromium-only interactive-widget key — A01 wins)',
    host_page: 'e2e/fixtures/host/host.html + e2e/helpers/host-server.ts — the demo host page (a mock mobile-app frame) served on a SECOND origin (localhost:4199 allow-listed, 127.0.0.1:4199 the stranger)',
    integration_doc: 'docs/INTEGRATION.md — the contract section (single source of truth), the frame-ancestors HTTP header with nginx/Caddy/Node example configs, the allow=/sandbox recommendation, the storage-partitioning reality',
    owner_gallery: 'scripts/capture_owner_gallery_r2_2.mjs — docs/evidence/R2-2/owner/ (O08: 390x844 + 360x800, the app inside the demo host page + the round-trip result)',
    digest: 'the summary source_digest covers src/public/e2e/fixtures/lockfile/config on the R2-2 final tree',
  },
  dependency_changes: 'R2-2 adds ZERO npm dependencies (source + tests + scripts + docs only).',
  measured_machine: 'same container as S0-S6 (Debian 13, kernel 6.8.0-147-generic, 16 vCPU, 62 GiB RAM); headless-Linux numbers, single-threaded WASM path; real-device behavior is NOT_RUN (A27/A30)',
}, null, 2) + '\n');
EOF
  EXITCODES+=("versions=$?")

  echo "== scripts/verify.sh (plan lint + evidence integrity at phase BUILDING, current slice R2-2) == " >> "$EV/green.log"
  bash scripts/verify.sh >> "$EV/green.log" 2>&1; VERIFY_EXIT=$?
  EXITCODES+=("verify=$VERIFY_EXIT")
  if [ "$VERIFY_EXIT" = 0 ]; then mark 9; fi
fi

# If every stage was skipped (markers present), re-evaluate the RECORDED
# exit codes from green.log instead of an empty list — a resume run must not
# print a vacuous verdict.
if [ "${#EXITCODES[@]}" -eq 0 ]; then
  RECORDED="$(grep -E '^EXIT CODES: ' "$EV/green.log" | tail -1 | sed 's/^EXIT CODES: //')"
  echo "== all stages already done — re-evaluating the RECORDED exit codes == " | tee -a "$EV/green.log"
  read -r -a EXITCODES <<< "$RECORDED"
fi

echo "EXIT CODES: ${EXITCODES[*]}" | tee -a "$EV/green.log"

FAILED=0
for e in "${EXITCODES[@]}"; do
  case "$e" in
    # Exit semantics, written down:
    #   inspect_test_control=0 — the test-build hook detector TRIPPED cleanly
    #     (exit 1 would mean the control failed to trip or found problems);
    #   every other stage: 0 = green.
    model=0|build_test=0|inspect_test_control=0|lint=0|chromium=0|webkit=0|prod_build=0|inspect_prod=0|prod_chromium=0|prod_webkit=0|owner_gallery=0|video_manifest=0|summary=0|unit=0|demo_build_test=0|demo=0|versions=0|verify=0) ;;
    *) FAILED=1 ;;
  esac
done
if [ "$FAILED" = 0 ]; then
  echo "R2-2 FINAL EVIDENCE RUN: ALL STAGES GREEN (negative controls tripped as expected)." | tee -a "$EV/green.log"
else
  echo "R2-2 FINAL EVIDENCE RUN: FAILURES PRESENT — see the exit codes above." | tee -a "$EV/green.log"
fi
exit $FAILED
