#!/usr/bin/env bash
# S5 FINAL evidence run: one all-green pass on the final tree.
#   Order matters: the bundle inspections bracket the browser runs (test
#   build first — the negative control MUST trip on the hooks — then the
#   production build, whose inspection must come back CLEAN); playwright
#   runs per engine on the TEST build (JUnit per engine + video snapshots),
#   then the PRODUCTION pass per engine (e2e/prod specs: strict CSP
#   shipped + enforced, test hooks absent, dist/ smoke), then the video
#   manifest, THEN vitest — the A25 evidence-integrity test validates the
#   committed summary.json refs against the JUnit and videos THIS run just
#   produced, so everything it checks exists on disk first. The demo runs
#   last.
#   green.log    — model fetch + test build + test-build inspection + lint
#   e2e.log      — playwright chromium + webkit on the TEST build (all specs)
#   prod.log     — production build + inspection + the e2e/prod pass per engine
#   negative.log — negative-path testcases extracted from e2e.log
#   demo.log     — the full demo in both engines
# Run: bash scripts/run_s5_final_evidence.sh (PLAYWRIGHT_BROWSERS_PATH honored).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S5
mkdir -p "$EV/junit" artifacts
pkill -f '[s]erve_model' 2>/dev/null || true
rm -f artifacts/model-server.log artifacts/offline-request-log.txt

echo "== model fetch/verify ==" > "$EV/green.log"
node scripts/fetch_model.mjs >> "$EV/green.log" 2>&1
MODEL_EXIT=$?
echo "== build:test ==" >> "$EV/green.log"
npm run build:test --silent >> "$EV/green.log" 2>&1
BUILD_EXIT=$?
echo "== bundle inspection: TEST build (negative control — must TRIP) ==" >> "$EV/green.log"
node scripts/inspect_bundle.mjs dist test > "$EV/bundle-inspection-test-build.txt" 2>&1
INSPECT_TEST_EXIT=$?
tail -5 "$EV/bundle-inspection-test-build.txt" >> "$EV/green.log"
echo "== lint ==" >> "$EV/green.log"
npm run lint >> "$EV/green.log" 2>&1
LINT_EXIT=$?

echo "== playwright chromium (all specs, TEST build) ==" > "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-e2e.xml" \
  npx playwright test --project=chromium --reporter=list,junit >> "$EV/e2e.log" 2>&1
CHROME_EXIT=$?
rm -rf artifacts/video-raw-chromium && cp -r test-results artifacts/video-raw-chromium

echo "== playwright webkit (all specs, TEST build) ==" >> "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-e2e.xml" \
  npx playwright test --project=webkit --reporter=list,junit >> "$EV/e2e.log" 2>&1
WEBKIT_EXIT=$?
rm -rf artifacts/video-raw-webkit && cp -r test-results artifacts/video-raw-webkit
mv artifacts/model-server.log "$EV/model-server-chromium.log" 2>/dev/null || echo "no chromium model-server log" >> "$EV/e2e.log"

{
  echo "# S5 negative-path output — extracted from the same green runs as e2e.log"
  echo "# (plus the bundle-inspection negative control: bundle-inspection-test-build.txt)"
  echo
  grep -E -A6 "a13_wrong_hash_falls_back|a13_truncated_file_falls_back|a13_unsupported_browser_banner|a13_model_404_falls_back|uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak|a08_share_target_ignores_posts_without_an_image|a10_denied_paste_explains_and_picker_works|a21_without_a_ready_model|uc13_injection_posts_are_content" "$EV/e2e.log" | grep -v '^--$'
  echo
  echo "== bundle inspection negative control (TEST build must trip on the hooks) =="
  cat "$EV/bundle-inspection-test-build.txt"
} > "$EV/negative.log"

echo "== production build + inspection (must be CLEAN) + e2e/prod per engine ==" > "$EV/prod.log"
npm run build --silent >> "$EV/prod.log" 2>&1
PROD_BUILD_EXIT=$?
node scripts/inspect_bundle.mjs dist prod > "$EV/bundle-inspection.txt" 2>&1
INSPECT_PROD_EXIT=$?
cat "$EV/bundle-inspection.txt" >> "$EV/prod.log"

POSTCLIP_PROD_RUN=1 PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-prod-e2e.xml" \
  npx playwright test --project=chromium e2e/prod --reporter=list,junit >> "$EV/prod.log" 2>&1
PROD_CHROME_EXIT=$?
cp -r test-results/. artifacts/video-raw-chromium/ 2>/dev/null || true

POSTCLIP_PROD_RUN=1 PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-prod-e2e.xml" \
  npx playwright test --project=webkit e2e/prod --reporter=list,junit >> "$EV/prod.log" 2>&1
PROD_WEBKIT_EXIT=$?
cp -r test-results/. artifacts/video-raw-webkit/ 2>/dev/null || true

echo "== video manifest ==" >> "$EV/green.log"
node scripts/build_video_manifest.mjs S5 >> "$EV/green.log" 2>&1
VIDEO_EXIT=$?

echo "== vitest (unit + evidence integrity; two-pass so the A25 in-run validation" >> "$EV/green.log"
echo "   can see its own run's final-named junit — the committed junit IS the green re-run) ==" >> "$EV/green.log"
npx vitest run --reporter=default --reporter=junit \
  --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
UNIT_EXIT=$?
if [ "$UNIT_EXIT" != 0 ]; then
  echo "unit pass 1 FAILED (exit $UNIT_EXIT) — not moving the junit; fix and re-run." | tee -a "$EV/green.log"
  # Fresh-evidence-dir bootstrap (S4 recorded the same class): on a first-ever
  # run there is no previous final-named host junit, so pass 1's only failure
  # is the A25 missing-file check. Seed the final name from pass 1 (all other
  # testcases passed) and let pass 2 validate every ref against it; the
  # committed junit is pass 2's green output.
  STAGE_FAILS=$(grep -c "<failure\|<error" "$EV/junit/host-vitest.staging.xml" || true)
  STAGE_TOTAL=$(grep -c "<testcase " "$EV/junit/host-vitest.staging.xml" || true)
  if [ ! -f "$EV/junit/host-vitest.xml" ] && [ "${UNIT_EXIT}" = 1 ] \
     && [ "$STAGE_FAILS" = 1 ] && grep -q "evidence integrity (A25, S5)" "$EV/junit/host-vitest.staging.xml"; then
    mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
    echo "bootstrap: fresh evidence dir — seeded final junit from pass 1 ($STAGE_TOTAL testcases, 1 expected A25 missing-file failure); running pass 2" | tee -a "$EV/green.log"
    npx vitest run --reporter=default --reporter=junit \
      --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
    UNIT_EXIT=$?
    if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi
  fi
else
  mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"
  # Pass 2, same tree: the evidence-integrity test now finds the final-named
  # junit from pass 1 (same content — this is the S4-recorded fixup, scripted).
  npx vitest run --reporter=default --reporter=junit \
    --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
  UNIT_EXIT=$?
  if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi
fi

echo "== demo ==" > "$EV/demo.log"
pkill -f '[s]erve_model' 2>/dev/null || true
# The demo drives the model-manager steps through the test-only ?testModelUrl
# overrides, so it must run against the TEST build — the prod stages above
# overwrite dist/, so rebuild the test build here.
npm run --silent build:test >> "$EV/demo.log" 2>&1
npm run --silent demo >> "$EV/demo.log" 2>&1
DEMO_EXIT=$?

echo "EXIT CODES: model=$MODEL_EXIT build:test=$BUILD_EXIT inspect-test-control=$INSPECT_TEST_EXIT lint=$LINT_EXIT chromium=$CHROME_EXIT webkit=$WEBKIT_EXIT prod-build=$PROD_BUILD_EXIT inspect-prod=$INSPECT_PROD_EXIT prod-chromium=$PROD_CHROME_EXIT prod-webkit=$PROD_WEBKIT_EXIT videos=$VIDEO_EXIT unit=$UNIT_EXIT demo=$DEMO_EXIT" | tee -a "$EV/green.log"
[ "$MODEL_EXIT" = 0 ] && [ "$BUILD_EXIT" = 0 ] && [ "$INSPECT_TEST_EXIT" = 0 ] && [ "$LINT_EXIT" = 0 ] && [ "$CHROME_EXIT" = 0 ] && [ "$WEBKIT_EXIT" = 0 ] && [ "$PROD_BUILD_EXIT" = 0 ] && [ "$INSPECT_PROD_EXIT" = 0 ] && [ "$PROD_CHROME_EXIT" = 0 ] && [ "$PROD_WEBKIT_EXIT" = 0 ] && [ "$VIDEO_EXIT" = 0 ] && [ "$UNIT_EXIT" = 0 ] && [ "$DEMO_EXIT" = 0 ]
