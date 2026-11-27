# folderchat — delivery status and evidence ledger

## Current status

- **Phase:** `BUILDING` — **S0 (cited answers, issue #93)** is in flight on branch `feature/folderchat/S0-cited-answers`: the implementation and the behavioural suite are green locally (fast suite 31/31; lint + mypy strict clean), and the building-host evidence run (slow suite, full retrieval eval, the answer-selection bench over every pinned candidate, the ship rule, latency under contention) is produced by `scripts/run_s0_final_evidence.sh`. Every acceptance ID is `NOT_RUN` until the digest-matched `docs/evidence/S0/summary.json` lands with the PR.
- **Next required action:** merge S0 (PR with the measured evidence), then start S1.
- **Measured CI-budget caveat:** folderchat's CI is the project's first and runs a real 2.4 GB bf16 GGUF download + a `llama-cpp-python` source build + real CPU-inference asks; the measured duration of the first runs and any smoke-size cut are recorded here and in the S0 PR.

## Slice overview

| Slice | Observable result | Status | PR / merge | Evidence |
|---|---|---|---|---|
| S0 | cited answers over a local folder: add → index (page/heading anchors) → ask → answer with machine-verified citations, abstention on unanswerable, limits refused; model pinned + sha256-verified, answer mode set by the measured ship rule | BUILDING (branch `feature/folderchat/S0-cited-answers`) | - | `docs/evidence/S0/` (red.log committed; green.log, junit/, eval/, summary.json with the PR) |
| S1 | see plan | NOT_STARTED | - | - |
| S2 | see plan | NOT_STARTED | - | - |
| S3 | see plan | NOT_STARTED | - | - |
| S4 | see plan | NOT_STARTED | - | - |
| S5 | see plan | NOT_STARTED | - | - |
