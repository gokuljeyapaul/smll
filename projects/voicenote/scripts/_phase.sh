#!/usr/bin/env bash
# Shared helper for this project's scripts: prints the milestone phase (PLAN_ONLY | BUILDING | COMPLETE).
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['phase'])" "$PROJECT_DIR/milestone-status.json" 2>/dev/null || echo PLAN_ONLY
