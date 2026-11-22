#!/usr/bin/env bash
# S4 FINAL evidence run: one all-green pass on the final tree.
#   Order matters: playwright first (JUnit per engine + per-engine model-server
#   logs + video snapshots), then the video manifest, THEN vitest — the A25
#   evidence-integrity test validates the committed summary.json refs against
#   the JUnit and videos THIS run just produced, so everything it checks
#   exists on disk first. The demo runs last.
#   green.log    — model fetch/verify + test build + lint + vitest (JUnit staged→moved on green)
#   e2e.log      — playwright chromium (all specs incl. the A19 eval_llm_vs_baseline
#                  run on the real model) + webkit (all specs; eval_llm is the
#                  planned chromium-only skip)
#   negative.log — negative-path testcases extracted from e2e.log
#   demo.log     — the full demo (S0–S3 flows + the S4 model-cleanup opt-in) in both engines
# Run on the TEST build (npm run build:test) — the e2e/demo use the test-only
# model-server URL override; production builds have no test hooks (A29).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S4
mkdir -p "$EV/junit" artifacts
pkill -f '[s]erve_model' 2>/dev/null || true
rm -f artifacts/model-server.log artifacts/offline-request-log.txt

echo "== build:test ==" > "$EV/green.log"
node scripts/fetch_model.mjs >> "$EV/green.log" 2>&1
MODEL_EXIT=$?
npm run build:test --silent >> "$EV/green.log" 2>&1
BUILD_EXIT=$?
echo "== lint ==" >> "$EV/green.log"
npm run lint >> "$EV/green.log" 2>&1
LINT_EXIT=$?

echo "== playwright chromium (all specs incl. the A19 real-model eval) ==" > "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-e2e.xml" \
  npx playwright test --project=chromium --reporter=list,junit >> "$EV/e2e.log" 2>&1
CHROME_EXIT=$?
rm -rf artifacts/video-raw-chromium && cp -r test-results artifacts/video-raw-chromium

echo "== playwright webkit (all specs) ==" >> "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-e2e.xml" \
  npx playwright test --project=webkit --reporter=list,junit >> "$EV/e2e.log" 2>&1
WEBKIT_EXIT=$?
rm -rf artifacts/video-raw-webkit && cp -r test-results artifacts/video-raw-webkit
mv artifacts/model-server.log "$EV/model-server-chromium.log" 2>/dev/null || echo "no chromium model-server log" >> "$EV/e2e.log"

{
  echo "# S4 negative-path output — extracted from the same green runs as e2e.log"
  echo
  grep -E -A6 "a13_wrong_hash_falls_back|a13_truncated_file_falls_back|a13_unsupported_browser_banner|a13_model_404_falls_back|uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak|a08_share_target_ignores_posts_without_an_image|a10_denied_paste_explains_and_picker_works|a21_without_a_ready_model|uc13_injection_posts_are_content" "$EV/e2e.log" | grep -v '^--$'
} > "$EV/negative.log"

echo "== video manifest ==" >> "$EV/green.log"
node scripts/build_video_manifest.mjs S4 >> "$EV/green.log" 2>&1
VIDEO_EXIT=$?

echo "== vitest (unit + evidence integrity; JUnit staged) ==" >> "$EV/green.log"
npx vitest run --reporter=default --reporter=junit \
  --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
UNIT_EXIT=$?
if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi

echo "== demo ==" > "$EV/demo.log"
pkill -f '[s]erve_model' 2>/dev/null || true
npm run --silent demo >> "$EV/demo.log" 2>&1
DEMO_EXIT=$?

echo "EXIT CODES: model=$MODEL_EXIT build=$BUILD_EXIT lint=$LINT_EXIT chromium=$CHROME_EXIT webkit=$WEBKIT_EXIT videos=$VIDEO_EXIT unit=$UNIT_EXIT demo=$DEMO_EXIT" | tee -a "$EV/green.log"
[ "$MODEL_EXIT" = 0 ] && [ "$BUILD_EXIT" = 0 ] && [ "$LINT_EXIT" = 0 ] && [ "$UNIT_EXIT" = 0 ] && [ "$CHROME_EXIT" = 0 ] && [ "$WEBKIT_EXIT" = 0 ] && [ "$VIDEO_EXIT" = 0 ] && [ "$DEMO_EXIT" = 0 ]
