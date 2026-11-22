#!/usr/bin/env bash
# S1 FINAL evidence run: one all-green pass on the final tree.
#   green.log  — build + vitest (JUnit, staged then moved on green)
#   e2e.log    — playwright chromium + webkit (JUnit per engine, fresh log)
#   negative.log — negative-path testcases extracted from e2e.log
# Videos are snapshotted per project run for build_video_manifest.mjs.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S1
mkdir -p "$EV/junit"

echo "== build ==" > "$EV/green.log"
npm run build --silent >> "$EV/green.log" 2>&1
BUILD_EXIT=$?

echo "== vitest (unit) ==" >> "$EV/green.log"
# JUnit goes to a staging name and replaces the committed file only after a
# green run (vitest truncates the output file at run start; the A25
# evidence-integrity test reads the committed JUnit, never the one being
# written).
npx vitest run --reporter=default --reporter=junit \
  --outputFile.junit="$EV/junit/host-vitest.staging.xml" >> "$EV/green.log" 2>&1
UNIT_EXIT=$?
tail -4 "$EV/green.log"
if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi

echo "== playwright chromium (all specs) ==" > "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-e2e.xml" \
  npx playwright test --project=chromium --reporter=list,junit >> "$EV/e2e.log" 2>&1
CHROME_EXIT=$?
rm -rf artifacts/video-raw-chromium && cp -r test-results artifacts/video-raw-chromium

echo "== playwright webkit (all specs) ==" >> "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-e2e.xml" \
  npx playwright test --project=webkit --reporter=list,junit >> "$EV/e2e.log" 2>&1
WEBKIT_EXIT=$?
rm -rf artifacts/video-raw-webkit && cp -r test-results artifacts/video-raw-webkit

{
  echo "# S1 negative-path output — extracted from the same green runs as e2e.log"
  echo
  grep -E -A6 "uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak" "$EV/e2e.log" | grep -v '^--$'
} > "$EV/negative.log"

echo "EXIT CODES: build=$BUILD_EXIT unit=$UNIT_EXIT chromium=$CHROME_EXIT webkit=$WEBKIT_EXIT" | tee -a "$EV/green.log"
[ "$BUILD_EXIT" = 0 ] && [ "$UNIT_EXIT" = 0 ] && [ "$CHROME_EXIT" = 0 ] && [ "$WEBKIT_EXIT" = 0 ]
