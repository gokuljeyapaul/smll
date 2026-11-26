#!/usr/bin/env bash
# PLAN-ONLY setup: nothing to install yet; checks the plan-phase prerequisites.
# S0 replaces this with the real setup (venv, pinned deps, pinned model download + sha256 verify).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/plan_only_guard.sh
bash scripts/preflight.sh ci
