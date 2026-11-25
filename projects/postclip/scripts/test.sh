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
  # S5 (A29): the PRODUCTION build must pass its own e2e pass (strict CSP
  # shipped + enforced, test hooks absent, dist/ smoke) and the bundle
  # inspection must come back clean on the dist/ that pass just built.
  npm run test:e2e:prod
  node scripts/inspect_bundle.mjs dist prod
  # R2-4 (issue #82): the standing docs/dead-code consistency gate — no stale
  # round-2 references, no stall-chase stage logging, every ledger-linked
  # evidence path exists.
  bash scripts/cleanup_audit.sh
fi
echo "test: OK"
