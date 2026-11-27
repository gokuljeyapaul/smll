#!/usr/bin/env bash
# S0 RED: run the behavioural suite against the scaffold (no product code installed)
# and record the real output + exit code. The e2e specs drive the real CLI surface;
# at RED time every one of them fails on the missing behaviour.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
EV=docs/evidence/S0
mkdir -p "$EV/junit"
{
  echo "# S0 RED evidence — real command, real output, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo '## $ .venv/bin/python -m pytest tests -m "fast or slow" --junitxml=docs/evidence/S0/junit/red.staging.xml -q'
} > "$EV/red.log"
.venv/bin/python -m pytest tests -m "fast or slow" \
  --junitxml="$EV/junit/red.staging.xml" -q 2>&1 | tee -a "$EV/red.log"
EXIT=${PIPESTATUS[0]}
echo >> "$EV/red.log"
echo "EXIT CODE: $EXIT" >> "$EV/red.log"
mv "$EV/junit/red.staging.xml" "$EV/junit/red.xml" 2>/dev/null || true
echo "red exit: $EXIT (expected non-zero: the behaviour does not exist yet)"
exit 0
