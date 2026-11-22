#!/usr/bin/env bash
# S4 RED run: production + test builds of the scaffold tree, then vitest
# (unit RED: the new adversarial suites fail on assertions against the
# naive scaffold while the S0–S3 regression stays green), then Playwright
# in Chromium AND WebKit against ONLY the new S4 specs (they fail on the
# missing model-cleanup UI), with real exit codes, to
# docs/evidence/S4/red.log. RED = assertion failures on missing behavior
# (the S4 scaffold exists but has no guard/retry/fallback/demotion; the app
# UI has no model-cleanup toggle or suggestions), exactly the S1–S3 pattern.
# The untouched S0–S3 e2e flows are re-proven by the full GREEN runs
# (scripts/run_s4_final_evidence.sh); RED scope note is in the log.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -w "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
EV=docs/evidence/S4
mkdir -p "$EV" artifacts
rm -f artifacts/model-server.log
LOG="$EV/red.log"

{
echo "# S4 RED evidence — real commands, real output, captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "RED state: the S3 app is unchanged (no model-cleanup UI); the S4 scaffold"
echo "exists (src/cleanup/llm/{prompt,parse,validate,pipeline}.ts — no behavior"
echo "yet: the prompt has no safety framing, the parser is a bare JSON.parse,"
echo "the validator accepts anything object-shaped, the orchestration has no"
echo "retry and no fallback). The new behavioral tests (vitest adversarial"
echo "suites + Playwright a21/uc13/eval_llm specs) must fail on assertions"
echo "(not import/build errors). The S0–S3 vitest regression stays green in"
echo "the same run; the S0–S3 e2e flows are unchanged by the scaffold and are"
echo "re-proven end to end by the GREEN final-evidence run (scope note: the"
echo "RED e2e step runs ONLY the new S4 specs, both engines)."
echo

echo "## \$ npm run build (production build of the scaffold tree)"
npm run build --silent
echo "BUILD_EXIT=$?"
echo

echo "## \$ npm run build:test (test build for the S4 e2e specs)"
npm run build:test --silent
echo "BUILD_TEST_EXIT=$?"
echo

echo "## \$ npx vitest run"
npx vitest run
echo "VITEST_EXIT=$?"
echo

echo "## \$ npx playwright test --project=chromium --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'"
npx playwright test --project=chromium --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'
echo "CHROMIUM_EXIT=$?"
echo

echo "## \$ npx playwright test --project=webkit --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'"
npx playwright test --project=webkit --reporter=list --grep 'a21_model_cleanup|uc13_injection|eval_llm'
echo "WEBKIT_EXIT=$?"
echo

echo "# End of S4 RED log."
} 2>&1 | tee "$LOG"
