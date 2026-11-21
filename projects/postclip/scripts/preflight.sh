#!/usr/bin/env bash
# Prerequisite check. Reports BLOCKED (exit 1) for anything REQUIRED that is missing; never installs.
#   bash scripts/preflight.sh           # auto: plan-only phase -> ci, otherwise build
#   bash scripts/preflight.sh ci        # python3 only
#   bash scripts/preflight.sh build     # python3, node, npm, git, disk >= 15 GB, network reachability of npm / Hugging Face / Playwright CDN (+ info: RAM, ffmpeg, Playwright)
# Writes artifacts/preflight.json. Safe from any cwd; bash 3.2 compatible.
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
MODE="${1:-auto}"
if [ "$MODE" = "auto" ]; then
  PHASE="$(python3 -c "import json;print(json.load(open('milestone-status.json'))['phase'])" 2>/dev/null || echo PLAN_ONLY)"
  if [ "$PHASE" = "PLAN_ONLY" ]; then MODE=ci; else MODE=build; fi
fi
mkdir -p artifacts
REPORT="artifacts/preflight.tsv"
: > "$REPORT"
missing=0

check() { # REQUIRED: name | test command | remediation
  local name="$1" cmd="$2" fix="$3" status="OK"
  if ! eval "$cmd" >/dev/null 2>&1; then status="MISSING"; missing=$((missing + 1)); fi
  printf '%s\t%s\t%s\n' "$name" "$status" "$fix" >> "$REPORT"
  printf '  [%s] %s%s\n' "$status" "$name" "$([ "$status" = MISSING ] && echo " -> $fix")"
}
info() { # NOT required: name | test command | note
  local name="$1" cmd="$2" note="$3" status="PRESENT"
  eval "$cmd" >/dev/null 2>&1 || status="ABSENT"
  printf '%s\tINFO_%s\t%s\n' "$name" "$status" "$note" >> "$REPORT"
  printf '  [info:%s] %s (%s)\n' "$status" "$name" "$note"
}

echo "preflight ($MODE)"
check "python3" "command -v python3" "install Python 3"

if [ "$MODE" = "build" ]; then
  check "node" "command -v node" "install Node (version in .nvmrc once S0 creates it)"
  check "npm" "command -v npm" "install npm"
  check "git" "command -v git" "install git"
  check "disk >= 15 GB free" '[ "$(df -Pk . | awk "NR==2{print \$4}")" -ge 15728640 ]' "free up disk space"
  reach() { # REQUIRED host reachability (HTTPS HEAD, 15 s)
    check "network: $1" "command -v curl && curl -sS -o /dev/null -m 15 -I https://$1" "allow $1 for this runner (see docs/runners/)"
  }
  reach registry.npmjs.org
  reach huggingface.co
  reach cdn.playwright.dev
  info "RAM >= 3.5 GB" "[ -r /proc/meminfo ] && awk '/MemTotal/{exit !(\$2/1024 >= 3500)}' /proc/meminfo" "record the real RAM in versions.json; the LLM step may need more"
  info "ffmpeg" "command -v ffmpeg" "needed in S6 for the compilation video (plan D6 allows apt-get install ffmpeg)"
  info "Playwright browsers" "ls \${PLAYWRIGHT_BROWSERS_PATH:-\$HOME/.cache/ms-playwright} 2>/dev/null | grep -q ." "installed by scripts/setup.sh (plan D6)"
fi

python3 - "$REPORT" "$MODE" <<'PY'
import json, sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
report = {"mode": sys.argv[2],
          "checks": [{"name": r[0], "status": r[1], "note": r[2]} for r in rows],
          "blocked": any(r[1] == "MISSING" for r in rows)}
json.dump(report, open("artifacts/preflight.json", "w"), indent=2)
PY

if [ "$missing" -gt 0 ]; then
  echo "preflight: BLOCKED ($missing required prerequisite(s) missing; nothing was installed)"
  exit 1
fi
echo "preflight: OK ($MODE)"
