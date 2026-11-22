#!/usr/bin/env bash
# S1 evidence run: build + unit tests (JUnit) + full Playwright suite in
# Chromium and WebKit (JUnit per engine). Produces:
#   docs/evidence/S1/green.log, e2e.log, negative.log
#   docs/evidence/S1/junit/{host-vitest,chromium-e2e,webkit-e2e}.xml
# Videos land in test-results/ for the manifest step afterwards
# (snapshot per project run — the next run clears test-results/).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Playwright browsers path: this container globally exports a read-only Hermes
# browsers path; fall back to the user cache whenever the current value is not
# writable. (CI never runs this script; its ubuntu runner uses the default.)
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S1
mkdir -p "$EV/junit"

echo "== build ==" | tee "$EV/green.log"
npm run build --silent
BUILD_EXIT=$?

echo "== vitest (unit) ==" | tee -a "$EV/green.log"
# JUnit goes to a staging name and replaces the committed file only after a
# green run: vitest truncates the output file at run start, so the A25
# evidence-integrity test (which validates the committed JUnit) must never
# read the file this same run is writing.
npx vitest run --reporter=default --reporter=junit \
  --outputFile.junit="$EV/junit/host-vitest.staging.xml" 2>&1 | tee -a "$EV/green.log" | tail -6
UNIT_EXIT=${PIPESTATUS[0]}
if [ "$UNIT_EXIT" = 0 ]; then mv "$EV/junit/host-vitest.staging.xml" "$EV/junit/host-vitest.xml"; fi

echo "== playwright chromium (all specs) ==" | tee -a "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/chromium-e2e.xml" \
  npx playwright test --project=chromium --reporter=list,junit 2>&1 | tee -a "$EV/e2e.log"
CHROME_EXIT=${PIPESTATUS[0]}
# Snapshot this project's videos before the next run clears test-results/.
rm -rf artifacts/video-raw-chromium && cp -r test-results artifacts/video-raw-chromium

echo "== playwright webkit (all specs) ==" | tee -a "$EV/e2e.log"
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$EV/junit/webkit-e2e.xml" \
  npx playwright test --project=webkit --reporter=list,junit 2>&1 | tee -a "$EV/e2e.log"
WEBKIT_EXIT=${PIPESTATUS[0]}
rm -rf artifacts/video-raw-webkit && cp -r test-results artifacts/video-raw-webkit

# negative.log: the negative-path portion of the same real run (same output,
# extracted for the required per-purpose artifact).
{
  echo "# S1 negative-path output — extracted from the same full Playwright runs as e2e.log"
  echo
  grep -E -A6 "uc11_bad_input_error_states|uc11_huge_downscaled_before_ocr|s0_negative_corrupt_input_fails_closed|a15_audit_negative_control_detects_seeded_leak" "$EV/e2e.log" | grep -v '^--$'
} > "$EV/negative.log"

echo "EXIT CODES: build=$BUILD_EXIT unit=$UNIT_EXIT chromium=$CHROME_EXIT webkit=$WEBKIT_EXIT" | tee -a "$EV/green.log"
[ "$BUILD_EXIT" = 0 ] && [ "$UNIT_EXIT" = 0 ] && [ "$CHROME_EXIT" = 0 ] && [ "$WEBKIT_EXIT" = 0 ]
