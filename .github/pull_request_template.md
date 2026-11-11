<!--
PR template for the smll monorepo. One functional slice = one PR.
-->
## Project

coaching-privacy-pipeline

## Functional slice

S0 — A fictional text transcript becomes a validated redacted result

## Implementation summary

- Typed transcript contracts with fail-closed parsing (unknown purpose/schema/source rejected, A02)
- Real Microsoft Presidio AnalyzerEngine + spaCy `en_core_web_sm` PII detection (A06), with audited deterministic email/street-address backfill for fictional-TLD fixtures
- Deterministic non-generative redaction preserving turn structure (A08)
- Independent leak validator (separate module from detector/transformer) that re-scans sanitized output (A07); reports never echo raw PII
- Fail-closed safety gate: validator/detector unavailable → FAILED; residual leak → BLOCKED; external_sharing → REVIEW_REQUIRED (A15, A17)
- Working `scripts/setup.sh`, `test.sh`, `demo.sh`, `verify.sh`, Makefile (A22); offline proof with sockets hard-blocked (18/18 sessions)

## Acceptance criteria

| ID | Result | Evidence |
|---|---|---|
| A01 | PASS | `docs/evidence/S0/green.log` (setup smoke: real AnalyzerEngine) |
| A02 | PASS | `docs/evidence/S0/green.log` (typed errors, CLI exit 2) |
| A06 | PASS | `docs/evidence/S0/green.log` (real Presidio, exact offsets) |
| A07 | PASS | `docs/evidence/S0/e2e.log` (deliberate re-insertion → BLOCKED) |
| A08 | PASS | `docs/evidence/S0/green.log` (turn IDs/order/speaker IDs preserved) |
| A15 | PASS | `docs/evidence/S0/negative.log` (unavailable validator → FAILED) |
| A17 | PASS (S0 scope) | REVIEW_REQUIRED/BLOCKED/FAILED observed; RELEASE_CANDIDATE intentionally withheld until S3 context_rules exists |
| A19 | PARTIAL | `privacy-pipeline process` E2E works; generate/directory/eval CLIs are S1 scope |
| A22 | PASS | `docs/evidence/S0/regression.log` (scripts run from non-project cwd) |
| A23 | PARTIAL | path traversal + size limits + no PII echo in reports; full logging audit in S6 |

## TDD evidence

- **RED:** `docs/evidence/S0/red.log` — 15 failed / 1 passed, exit 1, behavioral failures on missing redaction/validation/decision behavior (importable CLI shell existed first)
- **GREEN:** `docs/evidence/S0/green.log` — 16 passed, exit 0
- **E2E:** `docs/evidence/S0/e2e.log` — `bash scripts/demo.sh`, 18 seed sessions + deliberate-leak demo → BLOCKED, exit 0
- **Negative/privacy:** `docs/evidence/S0/negative.log` — 5 passed, exit 0
- **Regression:** `docs/evidence/S0/regression.log` — `scripts/verify.sh` from `/tmp` cwd, exit 0
- **Offline:** `docs/evidence/S0/offline.log` — 18/18 sessions with sockets hard-blocked, `HF_HUB_OFFLINE=1`
- **Machine report:** `docs/evidence/S0/summary.json`

## Demo commands

```bash
bash scripts/setup.sh
bash scripts/test.sh    # 16 passed
bash scripts/demo.sh    # 18 sessions -> sanitized + decision; leak demo -> BLOCKED
bash scripts/verify.sh
```

## Limitations

- `RELEASE_CANDIDATE` not emitted in S0: policy-mandated `context_rules` stage arrives in S3 (fail-closed honesty, per BUILD_PLAN S0 spec)
- Detection coverage measured on the 18 seed fixtures only; generated-corpus benchmark is S1
- `privacy-fixtures`/`privacy-eval` CLIs are stubs until S1
- Synthetic test success does not establish anonymity, ICF or legal compliance
