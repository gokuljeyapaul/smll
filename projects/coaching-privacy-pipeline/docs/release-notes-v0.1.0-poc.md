# Release v0.1.0-poc — coaching-privacy-pipeline

**Honesty caveats (read first):** This proof-of-concept was built and evaluated on **synthetic data only** (seeded fixtures and generated corpora). Real-data, ICF, and legal conformance are **`NOT_ASSESSED`**. No compliance claims are made or implied. `RELEASE_CANDIDATE` is an **internal synthetic benchmark outcome only** — it is not a certification that any real transcript is safe to share.

This release pins the delivered PoC state of the coaching-privacy-pipeline: transcripts (and synthetic audio) are redacted and audited offline with sha256-pinned models, contextual risks are detected with GLiNER, cross-session linkage is assessed, and every decision is fail-closed with evidence.

## Scope — S0–S7

| Slice | Delivered functionality | Evidence |
|---|---|---|
| S0 | Real Presidio redaction, independent leak validation, fail-closed decisions | [docs/evidence/S0/](../../evidence/S0/) |
| S1 | Generate → process → evaluate synthetic sessions (seed 42, 0 leaks) | [docs/evidence/S1/](../../evidence/S1/) |
| S2 | Purpose-specific privacy transformations | [docs/evidence/S2/](../../evidence/S2/) |
| S3 | Contextual cross-turn GLiNER risk detection (offline) | [docs/evidence/S3/](../../evidence/S3/) |
| S4 | Cross-session identity linkage, fail-closed combined decisions | [docs/evidence/S4/](../../evidence/S4/) |
| S5 | Synthetic WAV → real offline ASR (faster-whisper tiny.en) → same pipeline | [docs/evidence/S5/](../../evidence/S5/) |
| S6 | One-command privacy audit with provenance | [docs/evidence/S6/](../../evidence/S6/) |
| S7 | Batch adapters (JSON/CSV) | [docs/evidence/S7/](../../evidence/S7/) |

## Hardening issues included in this release

The following issue work is merged into the released tree (see `docs/status.md` for per-slice details, PR SHAs and evidence): #18 (sha256+revision model manifest with setup/verify/runtime fail-closed enforcement), #19 (real ASR confidence signals wired to the gate, fail-closed on missing uncertainty), #20 (whole-turn GLiNER windowing — no silent truncation), #21 (batch CLI, all-or-nothing), #22 (independent validator second pass — BLOCKED reachable without gold lists), #23 (honest NOT_ASSESSED report markers + cross-session linkage in batch runs), #11 (fail-closed per-session language gate; German evaluated but not added to SUPPORTED_LANGUAGES — recall below the English bar), #12 (CSV column mapping), #13 (selectable sha256-pinned Whisper models + ASR benchmark; WER 0.079 ≤ 0.10 budget on the fixture set), #9 (GLiNER device=auto + batched window inference, span-identical on CPU), #10 (specificity filter: named false-REVIEWs 2 → 0, zero new false-RELEASE), #14 (demo cast + README section), #16 (fast/slow test markers), #17 (streaming design doc).

## Known limitations

- Synthetic evaluation only; no real-data or legal-conformance assessment (see caveats above).
- Unsupported languages (e.g. German) are withheld per-session with `UNSUPPORTED` reported, not redacted — the multilingual models did not meet the English recall bar on the fixture set.
- Runtime WER budgeting is impossible without reference transcripts; the WER budget is measured on the seeded fixture set only.
- Semantic fidelity is evaluation-mode only; pipeline reports report it as `NOT_ASSESSED` without reference facts.
- GLiNER cannot discover every novel inference; unknown high-risk cases go to `REVIEW_REQUIRED`, never auto-release.

## Reproducing

See the project `README.md` and `AGENTS.md`. All models load offline and are pinned by sha256 + revision in `scripts/model_manifest.json`; `scripts/verify_models.py` enforces it at setup, verify and runtime.
