#!/usr/bin/env bash
# S6 FINAL evidence run: one all-green pass on the final tree (resumable by
# stage — a late failure must not re-run the ~2h browser stages).
#   green.log    — model fetch/verify + test build + test-build inspection
#                   (negative control MUST trip) + lint + manifest/compilation
#                   + audit + vitest (two-pass) + EXIT CODES
#   e2e.log      — playwright chromium + webkit on the TEST build (all specs)
#   prod.log     — production build + inspection (CLEAN) + e2e/prod per engine
#   negative.log — negative-path output extracted from e2e.log + the audit
#                   seeded-violation control
#   demo.log     — the full demo in both engines (test build rebuilt)
#   audit_deps.txt / license_inventory.json — the A26 audit output
#   versions.json — the S6 toolchain record
# Stage markers live in .cache/s6-stages/ — delete one to re-run its stage.
# Run: bash scripts/run_s6_final_evidence.sh
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S6
STAGES=.cache/s6-stages
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
  echo "== model fetch/verify == " >> "$EV/green.log"
  node scripts/fetch_model.mjs >> "$EV/green.log" 2>&1; EXITCODES+=("model=$?")
  npm run build:test --silent >> "$EV/green.log" 2>&1; EXITCODES+=("build_test=$?")
  echo "== bundle inspection: TEST build (negative control — must TRIP) ==" >> "$EV/green.log"
  node scripts/inspect_bundle.mjs dist test > "$EV/bundle-inspection-test-build.txt" 2>&1
  EXITCODES+=("inspect_test_control=$?")   # expected non-zero (TRIPPED)
  npm run lint >> "$EV/green.log" 2>&1; EXITCODES+=("lint=$?")
  mark 1
fi

# ---------------- stage 2: chromium e2e (TEST build) -------------------------
if ! stage 2 "chromium-e2e"; then
  pkill -f '[s]erve_model' 2>/dev/null || true
  rm -f artifacts/model-server.log artifacts/offline-request-log.txt
  echo "== playwright chromium (all specs, TEST build) ==" > "$EV/e2e.log"
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
  echo "== playwright webkit (all specs, TEST build) ==" >> "$EV/e2e.log"
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
  echo "== production build + inspection (must be CLEAN) + e2e/prod per engine ==" > "$EV/prod.log"
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

# ---------------- stage 5: manifest + compilation video + audit --------------
if ! stage 5 "manifest+video+audit"; then
  echo "== video manifest (S6) ==" >> "$EV/green.log"
  node scripts/build_video_manifest.mjs S6 >> "$EV/green.log" 2>&1; EXITCODES+=("video_manifest=$?")
  echo "== compilation video (O06/A24) ==" >> "$EV/green.log"
  node scripts/make_demo_video.mjs >> "$EV/green.log" 2>&1; EXITCODES+=("demo_video=$?")
  echo "== dependency/license audit (A26; dist/ is the production build from stage 4) ==" >> "$EV/green.log"
  node scripts/audit_deps.mjs >> "$EV/green.log" 2>&1; AUDIT_EXIT=$?
  echo "audit_deps (real tree) exit code: $AUDIT_EXIT" >> "$EV/green.log"
  EXITCODES+=("audit_deps=$AUDIT_EXIT")
  node scripts/audit_deps.mjs --seed-violation > "$EV/audit-negative-control.txt" 2>&1
  SEED_EXIT=$?
  echo "audit_deps --seed-violation exit code: $SEED_EXIT (expected 1 = every seeded violation detected)" >> "$EV/green.log"
  tail -2 "$EV/audit-negative-control.txt" >> "$EV/green.log"
  EXITCODES+=("audit_seed_control=$SEED_EXIT")
  if [ "$AUDIT_EXIT" = 0 ] && [ "$SEED_EXIT" = 1 ]; then mark 5; fi
  # (seed exit is the control TRIPPING — only mark the stage when both are right)
fi

# ---------------- stage 6: vitest (two-pass, A25 in-run validation) -----------
if ! stage 6 "vitest"; then
  echo "== vitest (unit + evidence integrity; two-pass so the A25 in-run validation ==" >> "$EV/green.log"
  echo "   can see its own run's final-named junit — the committed junit IS the green re-run) ==" >> "$EV/green.log"
  npx vitest run --reporter=default --reporter=junit \
    --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
  UNIT_EXIT=$?
  if [ "$UNIT_EXIT" != 0 ]; then
    echo "unit pass 1 FAILED (exit $UNIT_EXIT) — not moving the junit; fix and re-run." | tee -a "$EV/green.log"
    STAGE_FAILS=$(grep -c "<failure\|<error" "$EV/junit/host-vitest.staging.xml" || true)
    STAGE_TOTAL=$(grep -c "<testcase " "$EV/junit/host-vitest.staging.xml" || true)
    if [ ! -f "$EV/junit/host-vitest.xml" ] && [ "$UNIT_EXIT" = 1 ] \
       && [ "$STAGE_FAILS" = 1 ] && grep -q "evidence integrity (A25, S6)" "$EV/junit/host-vitest.staging.xml"; then
      mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
      echo "bootstrap: fresh evidence dir — seeded final junit from pass 1 ($STAGE_TOTAL testcases, 1 expected A25 missing-file failure); running pass 2" | tee -a "$EV/green.log"
      npx vitest run --reporter=default --reporter=junit \
        --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
      UNIT_EXIT=$?
      if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi
    fi
  else
    mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
    npx vitest run --reporter=default --reporter=junit \
      --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
    UNIT_EXIT=$?
    if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi
  fi
  EXITCODES+=("unit=$UNIT_EXIT")
  if [ "$UNIT_EXIT" = 0 ]; then mark 6; fi
fi

# ---------------- stage 7: demo ------------------------------------------------
if ! stage 7 "demo"; then
  echo "== demo ==" > "$EV/demo.log"
  pkill -f '[s]erve_model' 2>/dev/null || true
  # The demo drives the model-manager steps through the test-only ?testModelUrl
  # overrides, so it must run against the TEST build — the prod stages above
  # overwrite dist/, so rebuild the test build here.
  npm run --silent build:test >> "$EV/demo.log" 2>&1; BUILD_TEST_EXIT=$?
  npm run --silent demo >> "$EV/demo.log" 2>&1; DEMO_EXIT=$?
  echo "exit codes: build_test=$BUILD_TEST_EXIT demo=$DEMO_EXIT" >> "$EV/demo.log"
  EXITCODES+=("demo_build_test=$BUILD_TEST_EXIT")
  EXITCODES+=("demo=$DEMO_EXIT")
  if [ "$BUILD_TEST_EXIT" = 0 ] && [ "$DEMO_EXIT" = 0 ]; then mark 7; fi
fi

# ---------------- stage 8: negative.log + versions.json + verify -------------
if ! stage 8 "negative+versions+verify"; then
  {
    echo "# S6 negative-path output — extracted from the same green runs as e2e.log"
    echo "# (plus the bundle-inspection and audit seeded-violation negative controls)"
    echo
    grep -E -A6 "a13_wrong_hash_falls_back|a13_truncated_file_falls_back|a13_unsupported_browser_banner|a13_model_404_falls_back|uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak|a08_share_target_ignores_posts_without_an_image|a10_denied_paste_explains_and_picker_works|a21_without_a_ready_model|uc13_injection_posts_are_content" "$EV/e2e.log" | grep -v '^--$'
    echo
    echo "== bundle inspection negative control (TEST build must trip on the hooks) =="
    cat "$EV/bundle-inspection-test-build.txt"
    echo
    echo "== audit seeded-violation negative control (every detector class must TRIP) =="
    cat "$EV/audit-negative-control.txt"
  } > "$EV/negative.log"

  node - "$EV" <<'EOF' >> "$EV/green.log" 2>&1
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const v = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8' }).split('\n')[0].trim();
const pw = v('npx', ['playwright', '--version']);
writeFileSync('docs/evidence/S6/versions.json', JSON.stringify({
  slice: 'S6',
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
    ffmpeg: v('ffprobe', ['-version']) + ' (video durations; two-pass H.264 for the committed compilation)',
    axe_core: '@axe-core/playwright 4.14.0 (axe-core 4.10.3 bundled)',
  },
  s6_additions: {
    audit_deps: 'scripts/audit_deps.mjs — the A26 dependency/license/telemetry/CSP/model-pin audit (npm ls --all inventory: 269 packages) + its --seed-violation negative control',
    compilation_video: 'scripts/make_demo_video.mjs — docs/demo/postclip-demo.mp4 (<= 15 MB, 720p, H.264 two-pass) built from the S6 per-flow recordings',
    digest: 'the summary source_digest covers src/public/e2e/fixtures/lockfile/config on the S6 final tree',
  },
  llm_runtime: {
    status: 'UNCHANGED from S4/S5 — wllama 3.13 + the pinned Qwen3-0.6B-Q4_K_M; the LLM cleanup stays DISABLED BY DEFAULT (A19)',
    model: 'Qwen3-0.6B-Q4_K_M.gguf from unsloth/Qwen3-0.6B-GGUF @ 50968a4468ef4233ed78cd7c3de230dd1d61a56b (Apache-2.0), 396,705,472 bytes, sha256 ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
  },
  dependency_changes: 'S6 adds ZERO npm dependencies (scripts only: audit_deps.mjs, make_demo_video.mjs, run_s6_red.sh, run_s6_final_evidence.sh, gen_s6_summary.py).',
  measured_machine: 'same container as S0-S5 (Debian 13, kernel 6.8.0-147-generic, 16 vCPU, 62 GiB RAM); headless-Linux numbers, single-threaded WASM path; real-device behavior is NOT_RUN (A27/A30)',
}, null, 2) + '\n');
EOF
  EXITCODES+=("versions=$?")

  echo "== scripts/verify.sh (plan lint + evidence integrity at phase COMPLETE) ==" >> "$EV/green.log"
  bash scripts/verify.sh >> "$EV/green.log" 2>&1; VERIFY_EXIT=$?
  EXITCODES+=("verify=$VERIFY_EXIT")
  if [ "$VERIFY_EXIT" = 0 ]; then mark 8; fi
fi

# If every stage was skipped (markers present), re-evaluate the RECORDED
# exit codes from green.log instead of an empty list — a resume run must not
# print a vacuous verdict.
if [ "${#EXITCODES[@]}" -eq 0 ]; then
  RECORDED="$(grep -E '^EXIT CODES: ' "$EV/green.log" | tail -1 | sed 's/^EXIT CODES: //')"
  echo "== all stages already done — re-evaluating the RECORDED exit codes ==" | tee -a "$EV/green.log"
  read -r -a EXITCODES <<< "$RECORDED"
fi

echo "EXIT CODES: ${EXITCODES[*]}" | tee -a "$EV/green.log"

FAILED=0
for e in "${EXITCODES[@]}"; do
  case "$e" in
    # inspect_test_control=0 is the GREEN outcome: in test mode the detector
    # must TRIP on the hooks and find no other problem — exit 0 means exactly
    # that (see scripts/inspect_bundle.mjs: "TEST-BUILD CONTROL: detector
    # works"); a non-zero code means the control itself failed.
    model=0|build_test=0|inspect_test_control=0|lint=0|chromium=0|webkit=0|prod_build=0|inspect_prod=0|prod_chromium=0|prod_webkit=0|video_manifest=0|demo_video=0|audit_deps=0|audit_seed_control=1|unit=0|demo_build_test=0|demo=0|versions=0|verify=0) ;;
    *) FAILED=1 ;;
  esac
done
if [ "$FAILED" = 0 ]; then
  echo "S6 FINAL EVIDENCE RUN: ALL STAGES GREEN (negative controls tripped as expected)." | tee -a "$EV/green.log"
else
  echo "S6 FINAL EVIDENCE RUN: FAILURES PRESENT — see the exit codes above." | tee -a "$EV/green.log"
fi
exit $FAILED
