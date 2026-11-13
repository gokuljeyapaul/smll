#!/usr/bin/env bash
# Offline pytest run: unit + integration + E2E + negative suites (I16: the
# full suite = fast lane + slow lane, run explicitly so a marker regression
# can never silently narrow CI).
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
exec .venv/bin/python -m pytest tests/unit tests/integration tests/e2e tests/negative -m "fast or slow" -q
