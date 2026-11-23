#!/usr/bin/env bash
# S6 RED evidence (plan: "verify_evidence.py fails on missing IDs/videos/stale
# digest until everything is recorded; audits fail on a seeded violation
# (negative control)"). Run on the S6 branch with milestone-status.json
# already at phase COMPLETE / current_slice S6 but BEFORE the final S6
# summary.json and the recordings exist. Both parts must FAIL (exit 1) —
# their real output is docs/evidence/S6/red.log.
set -uo pipefail
cd "$(dirname "$0")/.."
EV=docs/evidence/S6
mkdir -p "$EV"

OUT="$(mktemp)"
{
  echo "== S6 RED part 1: verify_evidence.py at phase COMPLETE with no S6 summary =="
  echo "$ python3 scripts/verify_evidence.py"
  python3 scripts/verify_evidence.py
  VE_EXIT=$?
  echo "verify_evidence exit code: $VE_EXIT"
  echo
  echo "== S6 RED part 2: audit_deps seeded-violation negative control =="
  echo "$ node scripts/audit_deps.mjs --seed-violation"
  node scripts/audit_deps.mjs --seed-violation
  SEED_EXIT=$?
  echo "audit_deps --seed-violation exit code: $SEED_EXIT (expected 1 = every seeded violation detected = the control TRIPPED)"
  echo
  if [ "$VE_EXIT" = 1 ] && [ "$SEED_EXIT" = 1 ]; then
    echo "S6 RED: BOTH PARTS FAILED AS REQUIRED (missing-accounting detector + audit negative control)."
    RED_EXIT=0
  else
    echo "S6 RED: UNEXPECTED — a part did not fail (verify_evidence=$VE_EXIT seed=$SEED_EXIT)."
    RED_EXIT=1
  fi
  echo "$RED_EXIT" > "$OUT.exit"
} 2>&1 | tee "$EV/red.log"
RED_EXIT="$(cat "$OUT.exit")"
rm -f "$OUT.exit"

exit "$RED_EXIT"
