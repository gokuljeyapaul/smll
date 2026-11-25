#!/usr/bin/env bash
# R2-4 docs/dead-code consistency gate (issue #82's standing acceptance):
# a repo-wide search must find NO reference to the deleted round-2 design
# mockups, no "TODO(round 2)", no #58-chase stage-transition debug logging in
# shipped source, and every evidence path the ledger references must exist.
#
# EXIT SEMANTICS (written down): exit 0 = the tree is clean (no stale
# reference, no leftover logging, every ledger-linked evidence path exists);
# exit 1 = at least one finding — the tree still carries round-2 scaffolding.
# The audit deliberately does NOT search docs/evidence/ (committed evidence
# logs are immutable historical records — including this gate's own RED run)
# or this script itself (it carries the patterns it hunts for).
# Run: bash scripts/cleanup_audit.sh   (also wired into scripts/test.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
PROBLEMS=0
say_fail() { echo "cleanup_audit: FAIL - $*"; PROBLEMS=1; }

# 1) The round-2 design mockups are gone: folder deleted, no tracked reference.
if [ -d docs/design/round2 ]; then
  say_fail "docs/design/round2/ still exists"
fi
MOCKUP_REFS=$(git grep -l "design/round2" -- ':(exclude)docs/evidence' ':(exclude)scripts/cleanup_audit.sh' 2>/dev/null || true)
if [ -n "$MOCKUP_REFS" ]; then
  say_fail "stale mockup references:"; echo "$MOCKUP_REFS" | sed 's/^/    /'
fi

# 2) No round-2 TODO scaffolding left anywhere.
TODO_REFS=$(git grep -l "TODO(round 2)" -- ':(exclude)docs/evidence' ':(exclude)scripts/cleanup_audit.sh' 2>/dev/null || true)
if [ -n "$TODO_REFS" ]; then
  say_fail "TODO(round 2) leftovers:"; echo "$TODO_REFS" | sed 's/^/    /'
fi

# 3) No #68/#58-chase stage-transition debug logging in shipped source (the
#    observability that was only for the CI model stall; the watchdog/abort
#    FIXES stay, tested by the manager suite).
STAGE_LOG=$(grep -rln "Stage-transition log" src/ 2>/dev/null || true)
if [ -n "$STAGE_LOG" ]; then
  say_fail "stage-transition debug logging still in src/:"; echo "$STAGE_LOG" | sed 's/^/    /'
fi

# 4) Ledger-link integrity: every docs/evidence/ path the status ledger
#    references exists on disk (glob-style refs with * or { } are listed in
#    the ledger for humans and are skipped here).
while IFS= read -r ref; do
  case "$ref" in
    *'*'*|*'{'*|*'}'*) continue ;;
  esac
  # Strip trailing markdown punctuation ( ) ` ] , . ) one char at a time.
  while :; do
    case "$ref" in
      *')'|*'\`'|*']'|*','|*'.'|*'}') ref="${ref%?}" ;;
      *) break ;;
    esac
  done
  if [ ! -e "$ref" ]; then
    say_fail "ledger references missing evidence path: $ref"
  fi
done < <(grep -oE 'docs/evidence/[A-Za-z0-9_./-]+' docs/status.md | sort -u)

if [ "$PROBLEMS" = 0 ]; then
  echo "cleanup_audit: OK (no mockup references, no TODO(round 2), no stall-chase stage logging, every ledger evidence path exists)"
else
  echo "cleanup_audit: problems found (see above)"
fi
exit $PROBLEMS
