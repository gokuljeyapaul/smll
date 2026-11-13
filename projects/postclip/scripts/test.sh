#!/usr/bin/env bash
# Tests that run on any machine incl. CI: tool self-tests always; Jest + typecheck + lint once the app exists.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_phase.sh"
echo "test: phase=$PHASE"
python3 -m unittest discover -s scripts/tests -v
if [ "$PHASE" != "PLAN_ONLY" ]; then
  [ -f package.json ] || { echo "test: FAIL phase $PHASE but no package.json"; exit 1; }
  npm run typecheck
  npm run lint
  npm test -- --ci
fi
echo "test: OK"
