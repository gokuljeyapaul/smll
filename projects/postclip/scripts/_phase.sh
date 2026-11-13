#!/usr/bin/env bash
# Sourced helper: sets PROJECT_DIR and PHASE (PLAN_ONLY | BUILDING | COMPLETE) from milestone-status.json.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
PHASE="$(python3 -c "import json;print(json.load(open('milestone-status.json'))['phase'])")"
export PROJECT_DIR PHASE
