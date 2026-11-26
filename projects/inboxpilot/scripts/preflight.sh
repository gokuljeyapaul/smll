#!/usr/bin/env bash
# Prerequisite check. Reports BLOCKED (exit 1) for anything REQUIRED that is missing; never installs.
#   bash scripts/preflight.sh          # auto: PLAN_ONLY -> ci, otherwise build
#   bash scripts/preflight.sh ci       # python3 >= 3.9 only
#   bash scripts/preflight.sh build    # python3 >= 3.11, git, disk/RAM budget, Hugging Face + PyPI reachability
# S0 extends the build mode with this project's own extras (see BUILD_PLAN "Toolchain and preflight").
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
MODE="${1:-auto}"
if [ "$MODE" = auto ]; then
  if [ "$(bash scripts/_phase.sh)" = PLAN_ONLY ]; then MODE=ci; else MODE=build; fi
fi
missing=0
check() { if eval "$2" >/dev/null 2>&1; then echo "  [OK] $1"; else echo "  [MISSING] $1 -> $3"; missing=$((missing+1)); fi; }
info()  { if eval "$2" >/dev/null 2>&1; then echo "  [info:PRESENT] $1"; else echo "  [info:ABSENT] $1 ($3)"; fi; }
echo "preflight ($MODE)"
check "python3 >= 3.9" "python3 -c 'import sys;assert sys.version_info>=(3,9)'" "install Python 3"
if [ "$MODE" = build ]; then
  check "python3 >= 3.11" "python3 -c 'import sys;assert sys.version_info>=(3,11)'" "install Python 3.11+"
  check "git" "command -v git" "install git"
  DISK_GB="$(df -Pk . | awk 'NR==2{print int($4/1048576)}')"
  MIN_DISK="${PREFLIGHT_MIN_DISK_GB:-20}"
  check "free disk >= ${MIN_DISK} GB (have ${DISK_GB})" "[ ${DISK_GB:-0} -ge $MIN_DISK ]" "free disk space or report BLOCKED with the numbers"
  info "RAM: $(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo 2>/dev/null || echo unknown)" "true" ""
  info "CPU cores: $(nproc 2>/dev/null || echo unknown)" "true" ""
  check "pypi.org reachable" "python3 -c 'import urllib.request;urllib.request.urlopen(\"https://pypi.org/simple/pip/\",timeout=10)'" "network to PyPI is required for setup"
  check "huggingface.co reachable" "python3 -c 'import urllib.request;urllib.request.urlopen(\"https://huggingface.co\",timeout=10)'" "network to Hugging Face is required to fetch pinned models"
fi
if [ "$missing" -gt 0 ]; then echo "BLOCKED: $missing required prerequisite(s) missing"; exit 1; fi
echo "preflight OK"
