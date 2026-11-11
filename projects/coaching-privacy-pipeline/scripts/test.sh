#!/usr/bin/env bash
# Offline pytest run: unit + integration + E2E + negative suites.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
exec .venv/bin/python -m pytest tests/unit tests/integration tests/e2e tests/negative -q
