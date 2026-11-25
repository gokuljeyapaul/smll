#!/usr/bin/env bash
# R2-4 FINAL evidence run: one all-green pass on the final (cleaned) tree
# (resumable by stage — a late failure must not re-run the long browser
# stages). A clean-up slice still runs the FULL suite: every earlier A-ID
# (A01–A31 from S0–S6, A32–A46 from S7–S9) must not regress.
#   green.log    — model fetch/verify + test build + test-build inspection
#                   (negative control semantics, written down: inspect_bundle
#                   dist test exits 0 when the test-hook detector TRIPPED as
#                   expected AND no other problem was found; exit 1 means the
#                   control failed to trip or found extra problems) + the
#                   cleanup_audit gate (exit 0 = the cleaned tree is clean)
#                   + lint + summary generation + vitest (two-pass) + EXIT CODES
#   e2e.log      — playwright chromium + webkit on the TEST build (all specs)
#   prod.log     — production build + inspection (CLEAN, exit 0 = clean) +
#                   e2e/prod per engine
#   negative.log — negative-path output extracted from e2e.log + the seeded
#                   controls + the RED headline lines (incl. the pre-clean-up
#                   cleanup_audit failure — the control that tripped)
#   demo.log     — the full demo in the test build
#   junit/       — chromium*.xml, webkit*.xml, host*.xml (conventional names)
#   versions.json — the R2-4 toolchain record
# No owner-visual gallery stage: R2-4 adds no product behaviour and the plan
# has no O row for it (O07–O09 belong to R2-1/R2-2/R2-3, already committed).
# Stage markers live in .cache/r2-4-stages/ — delete one to re-run its stage.
# Run: bash scripts/run_r2_4_final_evidence.sh
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright
fi
EV=docs/evidence/R2-4
STAGES=.cache/r2-4-stages
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

# ---------------- stage 1: model + test build + cleanup gate + inspections + lint
if ! stage 1 "model+build+cleanup-gate+lint"; then
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
  mark 4
fi

# ---------------- stage 6: vitest bootstrap + summary + vitest final -------
# Chicken-and-egg, resolved explicitly (as R2-1/R2-2/R2-3): the A25 evidence
# test needs summary.json, the summary's host refs need host-vitest.xml, and
# host-vitest.xml is what vitest produces. Order:
#   pass 1 — every unit test except the 4 summary-missing blocks of
#            evidence-integrity-r2-4 must pass; their (otherwise green) run
#            seeds host-vitest.xml;
#   summary — gen_r2_4_summary.py verifies every ref against the seeded JUnit
#            (it refuses to write an unbacked PASS);
#   pass 2 — everything green; its output becomes the committed host-vitest.xml.
if ! stage 6 "vitest+summary"; then
  echo "== vitest (two-pass, A25 in-run validation; the summary's host refs need the pass-1 junit) == " >> "$EV/green.log"
  if [ ! -f "$EV/junit/host-vitest.xml" ]; then
    npx vitest run --reporter=default --reporter=junit \
      --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
    P1_EXIT=$?
    P1_FAILS=$(grep -c "<failure\|<error" "$EV/junit/host-vitest.staging.xml" || true)
    P1_A25=$(grep -c "evidence integrity (A25, R2-4)" "$EV/junit/host-vitest.staging.xml" || true)
    if [ "$P1_EXIT" = 1 ] && [ "$P1_FAILS" = 4 ] && [ "$P1_A25" -ge 4 ] && [ ! -f "$EV/summary.json" ]; then
      mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
      echo "bootstrap: seeded host-vitest.xml from pass 1 (4 expected failures, all the summary-missing A25 blocks)" | tee -a "$EV/green.log"
    else
      echo "vitest pass 1 UNEXPECTED (exit $P1_EXIT, $P1_FAILS failing testcases, $P1_A25 A25 blocks) — not seeding; fix and re-run." | tee -a "$EV/green.log"
      exit 1
    fi
  fi
  echo "== summary.json generation (every junit ref verified against the committed JUnit) == " >> "$EV/green.log"
  python3 scripts/gen_r2_4_summary.py >> "$EV/green.log" 2>&1; SUMMARY_EXIT=$?
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
    echo "# R2-4 negative-path output — extracted from the same green runs as e2e.log"
    echo "# (plus the bundle-inspection and cleanup-audit negative controls)"
    echo "#"
    echo "# R2-4 negative-control EXIT SEMANTICS (written down):"
    echo "#   the pre-clean-up cleanup_audit run (red.log) — exit 1 meant the control RAN and"
    echo "#     the gate CAUGHT the round-2 scaffolding still present (mockup folder + plan"
    echo "#     reference + #58-chase stage logging). Exit 0 on the cleaned tree = clean. An"
    echo "#     inverted expectation would print a wrong verdict while every stage was green."
    echo "#   a43/a45 controls below — exit 0 means the control RAN, the condition was"
    echo "#     triggered, and the suite CAUGHT it (a slip-through would fail the test)."
    echo
    grep -E -A6 "a13_wrong_hash_falls_back|a13_truncated_file_falls_back|a13_unsupported_browser_banner|a13_model_404_falls_back|uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak|a08_share_target_ignores_posts_without_an_image|a10_denied_paste_explains_and_picker_works|a21_without_a_ready_model|uc13_injection_posts_are_content|a36_shared_image_with_no_text_shows_kind_error_and_one_next_step|a36_share_post_without_an_image_stays_ignored|a39_volatile_storage_shows_kind_explanation_and_no_download|a39_no_room_refuses_the_download_before_any_byte_is_fetched|a43_copy_in_frame_without_clipboard_allow_falls_back_and_says_so|a45_message_from_non_allowlisted_origin_is_ignored" "$EV/e2e.log" | grep -v '^--$'
    echo
    echo "== bundle inspection negative control (TEST build: the detector must TRIP; exit 0 = tripped cleanly) =="
    cat "$EV/bundle-inspection-test-build.txt"
    echo
    echo "== cleanup_audit gate on the CLEANED tree (exit 0 = clean; the pre-clean-up failure is in red.log) =="
    bash scripts/cleanup_audit.sh
    AUDIT_EXIT=$?
    echo "cleanup_audit exit code: $AUDIT_EXIT"
    EXITCODES+=("cleanup_audit=$AUDIT_EXIT")
    echo
    echo "== R2-4 RED evidence: the pre-clean-up failures (headline lines) =="
    grep -E "cleanup_audit: FAIL|cleanup_audit exit code|FAIL - |Ran [0-9]+ tests|FAILED \(failures=1\)|BEFORE_SUITE" "$EV/red.log" | head -8
  } > "$EV/negative.log"

  node - "$EV" <<'EOF' >> "$EV/green.log" 2>&1
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const v = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8' }).split('\n')[0].trim();
const pw = v('npx', ['playwright', '--version']);
writeFileSync('docs/evidence/R2-4/versions.json', JSON.stringify({
  slice: 'R2-4',
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
  r2_4_additions: {
    slice: 'R2-4 — Clean-up after round 2 (issue #82): no product behaviour changes',
    mockups: 'the planner\'s round-2 mockup folder (3 low-fi PNGs + README, PR #81) DELETED; every repo reference folded — the real owner galleries are docs/evidence/R2-1/owner/ (O07), R2-2/owner/ (O08), R2-3/owner/ (O09); the slice issues #77/#78/#79 got pointer comments',
    plan: 'BUILD_PLAN.md: the "Round 2" sidecar section folded into the normal plan (its two standing rules moved into the Slices intro; the S7–S10 slice rows are the plan); the mockup paragraph removed; the S10/R2-4 row added in the first commit',
    docs: 'README.md Project state truthful (round 2 delivered; phase BUILDING awaiting owner review of O03–O09); KNOWN_LIMITS.md restructured (round-2 sections folded into the single flow, per-ID accounting pointers updated); INTEGRATION.md verified accurate as shipped (no change needed); status.md + milestone-status.json completed (R2-2 recorded MERGED at d045980)',
    code_hygiene: 'src/model/manager.ts: the #68 stage-transition console.info (observability added only for the #58 CI model stall) removed; the watchdog/abort/retry-budget FIXES stay (tested by the manager suite); the R2-3 persist()-at-opt-in console.info stays (it documents A37 behavior, KNOWN_LIMITS cites the recording)',
    audit_gate: 'scripts/cleanup_audit.sh — the standing docs/dead-code consistency gate (no docs/design/round2 references, no TODO(round 2), no stall-chase stage logging in src/, every ledger-linked evidence path exists), wired into scripts/test.sh; RED (exit 1 on the pre-clean-up tree) in red.log, GREEN in green.log',
    gen_issues_fix: 'tools/gen_issues.py epic-linker prefix collision (S1 vs S10) fixed with a digit lookahead — exposed by the S10 plan row, caught by the tools test',
    digest: 'the summary source_digest covers src/public/e2e/fixtures/lockfile/config on the R2-4 final tree',
  },
  dependency_changes: 'R2-4 adds ZERO npm dependencies (source + tests + scripts + docs only).',
  measured_machine: 'same container as S0-S6 (Debian 13, kernel 6.8.0-147-generic, 16 vCPU, 62 GiB RAM); headless-Linux numbers, single-threaded WASM path; real-device behavior is NOT_RUN (A27/A30)',
}, null, 2) + '\n');
EOF
  EXITCODES+=("versions=$?")

  echo "== scripts/verify.sh (plan lint + evidence integrity at phase BUILDING, current slice R2-4) == " >> "$EV/green.log"
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
    #   cleanup_audit=0 — the cleaned tree carries no round-2 scaffolding;
    #   every other stage: 0 = green.
    model=0|build_test=0|inspect_test_control=0|cleanup_audit=0|lint=0|chromium=0|webkit=0|prod_build=0|inspect_prod=0|prod_chromium=0|prod_webkit=0|summary=0|unit=0|demo_build_test=0|demo=0|versions=0|verify=0) ;;
    *) FAILED=1 ;;
  esac
done
if [ "$FAILED" = 0 ]; then
  echo "R2-4 FINAL EVIDENCE RUN: ALL STAGES GREEN (negative controls tripped as expected; the cleaned tree passes the full suite)." | tee -a "$EV/green.log"
else
  echo "R2-4 FINAL EVIDENCE RUN: FAILURES PRESENT — see the exit codes above." | tee -a "$EV/green.log"
fi
exit $FAILED
