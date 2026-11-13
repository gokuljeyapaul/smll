# Coaching Privacy Pipeline — delivery status and evidence ledger

> **Status at handoff:** SPECIFICATION ONLY. No implementation, automated unit tests, E2E tests, offline inference, screenshots or privacy conformance evidence has been executed. Entries below are initial placeholders—not passing results. OpenClaw MUST update this file **after every functional slice** and before opening its PR; verify GitHub merge before starting the next dependent slice.

## Current status

- **Active slice:** S0 delivered on branch `feature/coaching-privacy-pipeline/S0-text-redaction`, PR `READY_FOR_MERGE` (URL recorded below once opened)
- **Automation mode:** RED → GREEN → REFACTOR → VERIFY → DEMO → PR → VERIFIED MERGE → CONTINUE
- **Overall engineering result:** `PASS` (all slices S0–S7 delivered, locally green and CI-verified)
- **Synthetic privacy quality:** `ASSESSSED_ON_SEED_FIXTURES_ONLY` (18/18 seed sessions leak-free after redaction; generated-corpus benchmark is S1)
- **Real-data / ICF / legal conformance:** `NOT_ASSESSED`
- **Last verified proof:** [docs/evidence/S0/](evidence/S0/) — RED (15 failed, exit 1), GREEN (16 passed, exit 0), E2E demo, negative, offline (18/18 sessions with sockets blocked), cross-cwd verify
- **Next required action:** S0–S7 are delivered, merged and CI-verified (`milestone-status.json` `COMPLETE` refers to S0–S7 only). Further work is **issue-driven**: follow "Post-S7 issue-driven work" in this project's `AGENTS.md` (ordered list; start with GitHub issue #18). Nothing from those issues is delivered yet.

## Slice delivery overview

| Slice | Complete observable functionality | Status | PR / merge state | Acceptance evidence | Gate |
|---|---|---|---|---|
| S0 | Fictional text → PII redaction → validation → decision | PASS, MERGED | PR [#1](https://github.com/gokuljeyapaul/smll/pull/1), squash SHA `0e37260c0555443b06a68dc0901bc12e130b9ddc`, CI `monorepo / verify` green | [evidence/S0/](evidence/S0/) | 16 tests green, demo OK, offline OK |
| S1 | Generate → process → evaluate synthetic sessions | PASS, MERGED | PR [#2](https://github.com/gokuljeyapaul/smll/pull/2), squash SHA `c206f3247357b7128b71eee59a83737f6d0940b9`, CI green | [evidence/S1/](evidence/S1/) | 29 tests green, 25-session demo 0 leaks |
| S2 | Purpose-specific privacy transformations | PASS, MERGED | PR [#3](https://github.com/gokuljeyapaul/smll/pull/3), squash SHA `76794ee5ece42fb73bf5c9b1a272625dd562e34d`, CI green | [evidence/S2/](evidence/S2/) | 38 tests green incl. two-purpose E2E |
| S3 | Contextual cross-turn GLiNER risk detection | PASS, MERGED | PR [#4](https://github.com/gokuljeyapaul/smll/pull/4), squash SHA `0f1e59584e2660495277570904ed8ec848f25b52`, CI green | [evidence/S3/](evidence/S3/) | 48-test regression green; offline GLiNER proof |
| S4 | Cross-session identity linkage and fail-closed decisions | PASS, MERGED | PR [#5](https://github.com/gokuljeyapaul/smll/pull/5), squash SHA `8f326d531a6e773c91573e02bf411098f8edae16`, CI green | [evidence/S4/](evidence/S4/) | 63-test regression green; attack demo: top-1 rank-1 vs 0.02 chance |
| S5 | Synthetic WAV → real offline ASR → same pipeline | PASS, MERGED | PR [#6](https://github.com/gokuljeyapaul/smll/pull/6), squash SHA `5d7a42d029df678343e8f62b2f63db0a880ab395`, CI green | [evidence/S5/](evidence/S5/) | 75-test regression green; offline ASR proof |
| S6 | One-command privacy audit with provenance | PASS, MERGED | PR [#7](https://github.com/gokuljeyapaul/smll/pull/7), squash SHA `e6ebc3fc9e04923309379261e25c4f94b8a0b8a9`, CI green | [evidence/S6/](evidence/S6/) | 83-test regression green; audit_report.json verified |
| S7 | Batch adapters (JSON/CSV) + final wrap | PASS, MERGED | PR [#8](https://github.com/gokuljeyapaul/smll/pull/8), squash SHA `b55f16496f5bdfa52c1dc3cb4ae7e42fed438e61`, CI green | [evidence/S7/](evidence/S7/) | 89-test regression green |

## Acceptance-test conformance matrix

**Initial state:** All A01–A25 are `NOT_RUN`. Replace each result with `PASS`, `FAIL`, `NOT_RUN`, or `MOCK_ONLY` based only on a named executed test, including an evidence link to a real result under `docs/evidence/S#/`. Keep pending future-slice criteria as `NOT_RUN` or `NOT_IMPLEMENTED` instead of claiming they passed. Distinguish engineering test conformance from synthetic privacy-quality scores and real-data compliance.

| ID | Priority | Current result | Evidence |
|---|---|---|---|
| A01 | P0 | PASS | [evidence/S0/green.log](evidence/S0/green.log) (setup.sh venv+deps+en_core_web_sm, real AnalyzerEngine smoke) |
| A02 | P0 | PASS | [evidence/S0/green.log](evidence/S0/green.log) (unknown purpose/bad schema/disallowed source → typed errors, CLI exit 2) |
| A03 | P0 | PASS | [evidence/S1/green.log](evidence/S1/green.log) (seed 42 twice byte-identical; deterministic ids) |
| A04 | P0 | PASS | [evidence/S1/green.log](evidence/S1/green.log) (text[start:end]==gold_value all spans, char offsets) |
| A05 | P0 | PASS | [evidence/S1/green.log](evidence/S1/green.log) (dev/holdout personas disjoint; no gold in runtime results) |
| A06 | P0 | PASS | [evidence/S0/green.log](evidence/S0/green.log) (real Presidio: PERSON/EMAIL/PHONE/ADDRESS, exact offsets) |
| A07 | P0 | PASS | [evidence/S0/e2e.log](evidence/S0/e2e.log) (deliberate re-insertion → BLOCKED) |
| A08 | P0 | PASS | [evidence/S0/green.log](evidence/S0/green.log) (turn IDs/order/speaker IDs preserved; deterministic replacements) |
| A09 | P0 | PASS | [evidence/S2/green.log](evidence/S2/green.log) (relevant lived experience preserved; external always review) |
| A10 | P0 | PASS | [evidence/S3/e2e.log](evidence/S3/e2e.log) (cross-turn combination -> REVIEW_REQUIRED; single clue/benign not overflagged) |
| A11 | P0 | PASS | [evidence/S4/e2e.log](evidence/S4/e2e.log) (linked sessions -> MULTI_SESSION_LINK -> combined REVIEW; benign negatives usable) |
| A12 | P0 | PASS | [evidence/S3/offline.log](evidence/S3/offline.log) (pinned GLiNER fully offline; malformed span/language fail closed; injection inert) |
| A13 | P0 | PASS | [evidence/S5/offline.log](evidence/S5/offline.log) (real faster-whisper tiny.en, offline, uncertainty -> REVIEW, fail-closed inputs) |
| A14 | P0 | PASS | [evidence/S4/negative.log](evidence/S4/negative.log) (validator crash -> FAILED; transform-skip variant caught by independent re-scan) |
| A15 | P0 | PASS | [evidence/S0/negative.log](evidence/S0/negative.log) (validator/detector unavailable → FAILED) |
| A16 | P0 | PASS (scoped rubric) | [evidence/S2/negative.log](evidence/S2/negative.log) (mutant flagged; missing fact cannot silently pass) |
| A17 | P0 | PASS | [evidence/S4/green.log](evidence/S4/green.log) (all four states observed across suites: RELEASE_CANDIDATE, REVIEW_REQUIRED, BLOCKED, FAILED) |
| A18 | P0 | PASS | [evidence/S4/attack-demo.log](evidence/S4/attack-demo.log) (closed fictional directory: top-1, true rank, abstain, chance 0.02, assumptions documented) |
| A19 | P0 | PASS | [evidence/S7/e2e.log](evidence/S7/e2e.log) (batch JSONL/JSON/CSV in; malformed records fail closed, no partial success) |
| A20 | P0 | PASS | [evidence/S6/e2e.log](evidence/S6/e2e.log) (audit_report.json: pipeline_version, dataset_seed, models, policy, timestamp, host; metrics with denominators) |
| A21 | P0 | PASS | [evidence/S6/negative.log](evidence/S6/negative.log) (gold-in-artifact check fails closed) |
| A22 | P0 | PASS | [evidence/S0/regression.log](evidence/S0/regression.log) (scripts run from /tmp cwd; nonzero exit on errors) |
| A23 | P0 | PASS | [evidence/S6/negative.log](evidence/S6/negative.log) (log scanner audits for raw PII with line indexes; reports PII-free verified) |
| A24 | P0 | PASS | [evidence/S6/e2e.log](evidence/S6/e2e.log) (one-command audit.sh -> provenance-complete machine report) |
| A25 | P0 | NOT_RUN | None |

## GitHub PR delivery ledger (one PR per complete functional slice)

A passing test suite is **not** a delivered slice. Each S0–S7 feature requires its own PR. Before merge, commit this file with verified tests and `READY_FOR_MERGE`, PR URL when known, and **merge SHA = PENDING**. After GitHub reports `MERGED`, the agent must verify the actual merge SHA and include it in the checkpoint report. Backfill that verified SHA in the next slice PR (or a final documentation closeout PR for S7); do not push directly to `main` or invent the SHA. Missing required CI, reviews, resources or permissions makes the gate `BLOCKED`.

**Required stable GitHub check:** `monorepo / verify`. Evidence for this project's slice remains in `docs/evidence/S#/`, including real RED/GREEN/E2E and negative test logs; GitHub PR and CI run URLs provide external verification. A model-heavy check not executed on an adequately provisioned runner remains a blocker, even if fast unit tests pass.

## Required delivery format for each slice

### Slice S# — [capability name]

- **Delivered at:** ISO-8601 timestamp (actual)
- **Status:** `PASS | PARTIAL | FAIL | BLOCKED`
- **Conformance:** Acceptance IDs, test function IDs, `PASS/FAIL/NOT_RUN`, observed evidence. Do not mark unexecuted criteria passing.
- **User-visible behavior and demo:** Exact runnable command and observed result (fictional data only).
- **RED proof:** [red.log](evidence/S#/red.log) — actual expected unmet behavior, nonzero exit.
- **GREEN proof:** [green.log](evidence/S#/green.log) — actual unit/integration counts and exit 0.
- **E2E proof:** [e2e.log](evidence/S#/e2e.log) — actual end-to-end run, input/output decision summary.
- **Negative privacy proof:** [negative.log](evidence/S#/negative.log) — deliberate leak or validator failure prevented unsafe approval.
- **Regression / offline proof:** Link actual runs when available, else `NOT_RUN` with reason.
- **Machine report:** [summary.json](evidence/S#/summary.json) — observed commands, test IDs, counts, model versions, exit codes, measured metrics and denominators.
- **Screenshots:** Optional link to a genuine captured screen; never fabricated.
- **Changed implementation files:** Paths, short description.
- **Git reference:** Feature branch, PR URL, CI run URL/check name/result, `READY_FOR_MERGE | BLOCKED | MERGED`, and actual merge SHA when verified (otherwise `PENDING`).
- **Limitations and unresolved risks:** Explicit list, including false negatives and unassessed checks.
- **Next:** Continue automatically only after mandatory results are truly green **and GitHub confirms the feature PR is MERGED**; otherwise document blocker.

_Replace the section heading template with actual entries upon delivery. Do not create synthetic proof logs merely to populate placeholders._

## Post-S7 issue-driven work

### I18-S1 — Model manifest + sha256 verifier (issue #18 slice 1)

- **Delivered at:** 2026-11-13T13:20+08:00
- **Status:** `READY_FOR_MERGE`
- **Scope:** `scripts/model_manifest.json` is now authoritative: per-model `repo_id`, `revision` (commit SHA) and per-file `sha256` for every runtime-loaded model file (GLiNER weights/config/vendored tokenizer; Whisper tiny.en model.bin/config/tokenizer/vocabulary). New `scripts/verify_models.py` (`--manifest/--root`) exits 0 only if every listed file exists and matches; non-zero naming the file on missing/mismatch/malformed manifest; no network. Wired into `setup.sh` (revision-pinned `snapshot_download`, verifier gate after download, vendored+patched tokenizer_config instead of in-place HF-cache patch) and `verify.sh` (chunk 0). Pinned `faster-whisper==1.2.1`, `ctranslate2==4.9.0`, `en_core_web_sm==3.8.0` wheel. README model statement fixed: `tiny.en` (code truth), optional demo commands now point to the real proof scripts.
- **Hash provenance:** all sha256 computed 2026-11-13 with python hashlib over the real downloaded files; command + values in [evidence/I18-S1/model-hashes.txt](evidence/I18-S1/model-hashes.txt).
- **RED proof:** [evidence/I18-S1/red.log](evidence/I18-S1/red.log) — 5 failed, exit 1 (verifier did not exist).
- **GREEN proof:** [evidence/I18-S1/green.log](evidence/I18-S1/green.log) — unit 44 / negative 16 / integration 19 / e2e 15, all exit 0.
- **E2E proof:** [evidence/I18-S1/e2e.log](evidence/I18-S1/e2e.log) — `bash scripts/verify.sh`: chunk 0 verifier OK (8 files match), full suite + artifact verification pass.
- **Negative proof:** [evidence/I18-S1/negative.log](evidence/I18-S1/negative.log) — tampered gliner_config.json → exit 1 naming file; missing vocabulary.txt → exit 1 naming file; restored → exit 0.
- **Machine report:** [evidence/I18-S1/summary.json](evidence/I18-S1/summary.json).
- **Dependency versions:** [evidence/I18-S1/dependency-versions.txt](evidence/I18-S1/dependency-versions.txt) (faster-whisper 1.2.1, ctranslate2 4.9.0, en_core_web_sm 3.8.0, gliner 0.2.30, transformers 4.57.6, spacy 3.8.18).
- **Changed implementation files:** `scripts/verify_models.py` (new), `scripts/model_manifest.json`, `scripts/setup.sh`, `scripts/verify.sh`, `README.md`, `tests/unit/test_i18_unit.py`.
- **Git reference:** branch `feature/coaching-privacy-pipeline/I18-S1-verify-models`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING` (recorded in next slice PR).
- **Limitations:** runtime fail-closed hash checks are issue #18 slice 2; spaCy model is wheel-pinned, not sha256-pinned (explicit `hash_verification: false` manifest entry).
- **Next:** merge I18-S1, then issue #18 slice 2 (runtime fail-closed checks), per the post-S7 order.

### I18-S2 — Runtime fail-closed model verification (issue #18 slice 2)

- **Delivered at:** 2026-11-13T14:15+08:00
- **Status:** `READY_FOR_MERGE` (previous slice PR #26 merged as `2be0f0dda21d2600f0599ce3dd3f5ae54301997c`)
- **Scope:** `GLiNERContextExtractor._ensure_loaded` and `FasterWhisperAdapter._ensure_model` now verify the manifest sha256 of every file they load (once per process, cached on success only) before touching the model. Tampered/missing files fail closed: RuntimeError naming the file → engine `context_stage_error` → decision `FAILED`; ASRError for Whisper. `COACHING_MODEL_MANIFEST` env var supports test-time synthetic manifests; production default `scripts/model_manifest.json`.
- **RED proof:** [evidence/I18-S2/red.log](evidence/I18-S2/red.log) — 5 failed, exit 1 (tampered models loaded or failed with unrelated opaque errors; no verification existed).
- **GREEN proof:** [evidence/I18-S2/green.log](evidence/I18-S2/green.log) — unit 49 / negative 16 / integration 19 / e2e 15, all exit 0.
- **E2E proof:** [evidence/I18-S2/e2e.log](evidence/I18-S2/e2e.log) — `bash scripts/verify.sh` exit 0; decision states unchanged (`RELEASE_CANDIDATE`, `REVIEW_REQUIRED`) — no gate impact.
- **Negative proof:** [evidence/I18-S2/negative.log](evidence/I18-S2/negative.log) — tampered safetensors → FAILED naming the file; missing config → error naming the file; tampered vocabulary → ASRError.
- **Machine report:** [evidence/I18-S2/summary.json](evidence/I18-S2/summary.json).
- **Changed implementation files:** `src/coaching_privacy/context_extractor.py`, `src/coaching_privacy/asr.py`, `tests/unit/test_i18s2_unit.py`.
- **Git reference:** branch `feature/coaching-privacy-pipeline/I18-S2-runtime-fail-closed`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING`.
- **Limitations:** verification cached per process on success only; spaCy model wheel-pinned (see I18-S1).
- **Next:** issue #18 complete after merge → proceed to #16 fast/slow markers per the post-S7 order.

### I16 — Fast/slow test markers (issue #16)

- **Delivered at:** 2026-11-13T15:40+08:00
- **Status:** `READY_FOR_MERGE` (previous slice PR #28 merged as `f959d526b524295d5ca293d12d9ff40d54f324ab`)
- **Scope:** every test carries exactly one `fast`/`slow` marker (unmarked/double-marked fails the run); `fast` tests get an autouse guard blocking GLiNER/Whisper loads ("model loaded in a fast test"); `engine.process_transcript(..., context_extractor=)` allows stub injection for engine-logic tests (stubs never count as model evidence); `test.sh` runs `-m "fast or slow"` explicitly (CI unchanged in scope); `verify.sh` runs the verifier + fast lane under a 120s timeout + artifact checks, no longer duplicating the suite; `make test-fast`; README documents the split.
- **Measured:** fast lane 55 tests in 1.92s (acceptance <60s PASS); full suite 106 tests in 643.84s, exit 0 (same 106 collected as before the split — no coverage loss).
- **RED proof:** [evidence/I16/red.log](evidence/I16/red.log) — 4 failed (no markers, no guard, empty fast lane).
- **GREEN proof:** [evidence/I16/green.log](evidence/I16/green.log).
- **E2E proof:** [evidence/I16/e2e.log](evidence/I16/e2e.log).
- **Negative proof:** [evidence/I16/negative.log](evidence/I16/negative.log) — marker discipline + guard behavioral tests, 5 passed.
- **Machine report:** [evidence/I16/summary.json](evidence/I16/summary.json).
- **Git reference:** branch `feature/coaching-privacy-pipeline/I16-fast-slow-markers`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING`.
- **Limitations:** `test_s2_unit.py` moved to the slow lane (its expected outcomes depend on real GLiNER spans); marker discipline skipped during `--collect-only`.
- **Next:** #22 independent validator (after #18, #16).

### I22-S1 — Independent validator second pass (issue #22 slice 1)

- **Delivered at:** 2026-11-13T16:55+08:00
- **Status:** `READY_FOR_MERGE` (previous slice PR #29 merged as `efea5e0291b845108e339e2b27befedb21b926a5`)
- **Scope:** `IndependentLeakValidator` now performs its own second pass independent of the detector/transformer: (1) structured-identifier rescan (email, phone, URL, @handle, IPv4, card numbers via Luhn, long digit/ID tokens) with conservative deterministic patterns; (2) echo check — every value the detector replaced in this run must not re-appear (engine passes `replaced_values` in-process only; never disk/logs/reports). Honest docstring: second mechanism, not a completeness guarantee; blind spots documented (names outside replaced list, contextual combinations, non-English).
- **RED proof:** [evidence/I22-S1/red.log](evidence/I22-S1/red.log) — 4 failed: re-inserted email/phone with `prohibited_leaks=[]` released as RELEASE_CANDIDATE (BLOCKED unreachable), no echo check, card finding absent.
- **GREEN proof:** [evidence/I22-S1/green.log](evidence/I22-S1/green.log) — 5 validator tests passed; full suite 111 passed exit 0.
- **Gate-impact:** 18-fixture before/after decision table in [evidence/I22-S1/green.log](evidence/I22-S1/green.log) — all 18 UNCHANGED, 0 more-permissive changes (raw before/after logs: before-18fixtures.log, after-18fixtures.log).
- **E2E proof:** [evidence/I22-S1/e2e.log](evidence/I22-S1/e2e.log) — verify.sh exit 0.
- **Negative proof:** [evidence/I22-S1/negative.log](evidence/I22-S1/negative.log) — BLOCKED reachable without gold list; raw values never in reports.
- **Machine report:** [evidence/I22-S1/summary.json](evidence/I22-S1/summary.json).
- **Git reference:** branch `feature/coaching-privacy-pipeline/I22-S1-independent-validator`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING`.
- **Limitations:** conservative patterns → fail-closed bias (zero false positives measured on the 18 fixtures); blind spots documented.
- **Next:** #19 ASR confidence (deps #18 merged).

### I19-S1 — Real ASR confidence signals (issue #19 slice 1)

- **Delivered at:** 2026-11-13T18:10+08:00
- **Status:** `READY_FOR_MERGE` (previous slice PR #30 merged as `6e2f8ca065a3ab4622ecb940ef255e2f580b8741`)
- **Scope:** Step 0 verified and recorded ([evidence/I19-S1/step0-transcriptioninfo.log](evidence/I19-S1/step0-transcriptioninfo.log)): `TranscriptionInfo` has no `avg_logprob` → `uncertain` was always `False`. Now `FasterWhisperAdapter.transcribe` aggregates per-segment `avg_logprob`/`no_speech_prob`/`compression_ratio` plus `info.language_probability` into `result["signals"]` and computes `uncertain` against policy-YAML thresholds (`asr_confidence`). Calibration on real tiny.en: clean clip → `False`; noise-degraded clip → `True` via `no_speech_prob=0.89` (moderate clipping stayed confident — recorded honestly in [calibration.log](evidence/I19-S1/calibration.log)).
- **RED proof:** [evidence/I19-S1/red.log](evidence/I19-S1/red.log) — 5 failed (no signals, uncertain always False).
- **GREEN proof:** [evidence/I19-S1/green.log](evidence/I19-S1/green.log) — unit 5 passed (fake model, fast lane); integration 2 passed (real tiny.en); full chunks: fast 60 / integration 21 / e2e+negative 31, all exit 0.
- **E2E proof:** [evidence/I19-S1/e2e.log](evidence/I19-S1/e2e.log). **Negative proof:** [evidence/I19-S1/negative.log](evidence/I19-S1/negative.log).
- **Machine report:** [evidence/I19-S1/summary.json](evidence/I19-S1/summary.json).
- **Changed files:** `src/coaching_privacy/asr.py`, `policies/sample_policy.yaml`, `tests/conftest.py` (fast-lane ASR guard allows pre-injected fakes; real loads still blocked), new tests.
- **Git reference:** branch `feature/coaching-privacy-pipeline/I19-S1-asr-confidence`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING`.
- **Limitations:** engine does not yet consume `uncertain` for `synthetic_audio` transcripts (issue #19 slice 2); tiny.en confidence under moderate clipping documented.
- **Next:** issue #19 slice 2 — carry uncertainty to the gate.

### I19-S2 — ASR uncertainty carried to the gate (issue #19 slice 2)

- **Delivered at:** 2026-11-13T19:30+08:00
- **Status:** `READY_FOR_MERGE` (previous slice PR #31 merged as `1ee49c08ccf4f8174fa591394a1e84ec6a3259d9`)
- **Scope:** new `transcript_from_asr` helper builds the canonical `Transcript` with `metadata.asr` provenance (model/engine/speaker_attribution/uncertain/signals/language/language_probability); `engine.process_transcript` reads `metadata.asr.uncertain` for `source_type == synthetic_audio` and passes `asr_uncertain` to the SafetyGate — missing or non-boolean value is treated as **uncertain (fail closed)** → `REVIEW_REQUIRED` with `asr_uncertainty_requires_review`; report records `report["asr"]` provenance; S5 e2e uses the helper instead of hand-built dicts.
- **RED proof:** [evidence/I19-S2/red.log](evidence/I19-S2/red.log) — 4 failed (uncertain audio released as RELEASE_CANDIDATE; missing flag released; no provenance).
- **GREEN proof:** [evidence/I19-S2/green.log](evidence/I19-S2/green.log) — 5 passed; full chunks fast 60 / integration 21 / e2e+negative 36, all exit 0.
- **E2E proof:** [evidence/I19-S2/e2e.log](evidence/I19-S2/e2e.log). **Negative proof:** [evidence/I19-S2/negative.log](evidence/I19-S2/negative.log).
- **Machine report:** [evidence/I19-S2/summary.json](evidence/I19-S2/summary.json).
- **Gate impact:** none on the 18 text seed fixtures (all `synthetic_text`; `asr_uncertain=False` path identical); audio path proven by differential e2e (uncertain → REVIEW_REQUIRED; certain → RELEASE_CANDIDATE).
- **Git reference:** branch `feature/coaching-privacy-pipeline/I19-S2-asr-gate-wiring`, PR `PENDING`, state `READY_FOR_MERGE`, merge SHA `PENDING`.
- **Next:** #20 GLiNER windowing (deps #18 ✅, #19 ✅ after this merge).
