#!/usr/bin/env bash
# Tests. Always: tool self-tests. Once the app exists: typecheck, lint, Vitest, Playwright e2e (Chromium + WebKit).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "test: phase=$PHASE"
python3 -m unittest discover -s scripts/tests -v
# Shared monorepo tools (work-queue issue generator) are exercised here so CI runs them when this project changes.
python3 -m unittest discover -s ../../tools/tests -t ../../tools/tests -v
if [ "$PHASE" != "PLAN_ONLY" ]; then
  [ -f package.json ] || { echo "test: FAIL phase $PHASE but no package.json"; exit 1; }
  npm run typecheck
  npm run lint
  npm test
  npm run test:e2e
fi
echo "test: OK"
