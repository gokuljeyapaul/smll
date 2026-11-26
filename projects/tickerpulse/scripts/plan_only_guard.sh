# Sourced by the plan-only scripts. While the phase is PLAN_ONLY these scripts do the
# honest plan-phase work (lint the plan, preview the work queue). Once S0 sets the phase
# to BUILDING, S0 MUST replace them with the real setup/test/demo/verify; until it does,
# they fail so CI can never report a false PASS for a project that is building.
PHASE="$(bash "$(dirname "${BASH_SOURCE[0]}")/_phase.sh")"
if [ "$PHASE" != "PLAN_ONLY" ]; then
  echo "FAIL: phase is $PHASE but $(basename "$0") is still the plan-only script; S0 must replace it with the real implementation." >&2
  exit 1
fi
