# BUILD_PLAN — voicenote

**voicenote** turns a spoken voice note — in **English or Indian languages, including code-mixed speech like Hinglish** — into a transcript, a short summary, and **actionable to-dos with dates**, which the user reviews and exports as calendar events (`.ics`), JSON, Markdown, or shares as text. Speech recognition and extraction both run locally on CPU with open-weight models chosen for Indian languages. Nothing is uploaded.

Executed autonomously by a building agent on Linux (runner-neutral, `docs/runners/`); machine-linted by `python3 scripts/plan_lint.py`.

## Purpose and honesty statement

- Goal: show what **Indic-specialised small speech and language models** do that a generic English-first stack cannot: recognise Tamil, Hindi, Bengali and others on CPU, handle mid-sentence language switching, and understand relative dates as people actually say them ("kal shaam", "parso", "next Monday", "15 tareekh tak").
- A passing suite proves behaviour on the evaluation sets and synthetic recordings used, per language. It does not prove accuracy for every accent, dialect or noisy room. Every language reports its own numbers; a language that misses its bar ships `UNSUPPORTED`, never silently.
- Non-goals (v1): live meeting transcription, speaker diarisation of many speakers, cloud ASR, sending calendar invites, phone-native apps.

## Owner decisions and defaults

| ID | Decision | Default (apply unless the owner changes it) |
|---|---|---|
| D1 | CI budget | Shipped ASR model ≤ 1 GB on disk and ≤ 1× real-time on 4 CPU threads; extraction model ≤ 4B GGUF Q4; CI `slow` evals ≤ 10 minutes of audio in total; per-language selection benches, public eval subsets and the 30-minute note (A16) are `bench` (building host). |
| D2 | Stack | Python 3.11; ASR via the model's own runtime (NeMo/transformers/ONNX on CPU, chosen by measurement) or `faster-whisper`; `llama-cpp-python` with JSON-schema constrained decoding for extraction; `dateparser` + custom Indic relative-date rules; `ffmpeg` for decoding; `icalendar`; FastAPI + HTMX UI with in-browser recording; pytest, ruff, mypy, Playwright (Chromium with fake audio capture). |
| D3 | Languages | `config/languages.yaml`. Target set: English (Indian and general), Hindi, Bengali, Marathi, Gujarati, Punjabi, Odia, Tamil, Telugu, Kannada, Malayalam, plus code-mixed Hindi–English and Tamil–English. A language is `ENABLED` only when it passes both the ASR bar and the extraction bar; otherwise `UNSUPPORTED` with its measured numbers shown in the app. |
| D4 | Inputs | Record in the browser; drop/upload audio (wav, mp3, m4a, ogg/opus, webm); a watch folder; WhatsApp "export chat" voice notes (`.opus`). |
| D5 | Outputs | Transcript (original script), optional English gloss (flagged as machine-translated), summary, to-dos with due date/time, people and places; `.ics` (one VEVENT/VTODO per item), JSON, Markdown; "Share as text". Timezone default `Asia/Kolkata`, configurable. |
| D6 | Installs | Project `.venv` + pip, incl. a pip-installed static ffmpeg (`imageio-ffmpeg` or equivalent) so neither CI nor the host needs a system package; a system `ffmpeg` is used if present. Playwright Chromium. |
| D7 | Data | Committed fixtures are synthetic (open TTS, license recorded) and short. Public evaluation sets (e.g. IndicVoices/Vistaar subsets) are fetched by `setup.sh` when their licenses allow, never committed. No real personal recordings in git. |
| D8 | Merging | Agent merges its own PRs under the policy below. |

## Use cases

| ID | Title | Description |
|---|---|---|
| UC01 | Record a note | Record in the browser; stop; processing starts automatically. |
| UC02 | Import audio | Drop or pick an audio file of a supported format. |
| UC03 | Watch folder and WhatsApp exports | Audio files placed in a watch folder or a WhatsApp export are queued and processed. |
| UC04 | Transcribe any supported language | The language is detected (or set), including code-mixed speech, and transcribed in its own script. |
| UC05 | Extract to-dos | The SLM produces a summary and to-dos with normalised due dates, people and places as validated JSON. |
| UC06 | Review and edit | The user sees transcript and to-dos side by side, edits, ticks which to export. |
| UC07 | Export and share | Download `.ics`, JSON or Markdown, or share/copy as text. |
| UC08 | Language gate | A note in a language that isn't `ENABLED` gets a clear message with what is supported and its measured accuracy. |
| UC09 | Bad audio | Silence, music only, too short, too long, corrupt or unsupported files each get a specific, kind message. |
| UC10 | Private and offline | After setup, processing makes zero network requests; audio and text are never uploaded or logged. |
| UC11 | Hostile speech | Spoken instructions to the system ("ignore everything and…") are content, never obeyed. |
| UC12 | Long notes | Notes up to 30 minutes are chunked, transcribed and summarised without running out of memory. |

## Architecture

```
mic (browser) · file drop · watch folder · WhatsApp .opus
                 ▼
 audio/   ffmpeg decode → 16 kHz mono → VAD trim/chunk → checks (silence, music, length)
                 ▼
 lid/     language ID (ASR model's own or a small LID model) → language gate (config)
                 ▼
 asr/     Indic ASR model (chosen by measurement) · baseline: multilingual Whisper
                 ▼
 extract/ Indic-capable SLM, JSON-schema constrained → guard (spans exist in transcript)
          dates: SLM proposes, deterministic Indic date resolver normalises
                 ▼
 export/  .ics · JSON · Markdown · share text        ui/ FastAPI + HTMX (record, review, edit, export)
```

## The SLM showcase

Tested explicitly: per-language **CER/WER** on CPU; **code-mixed** transcription (both scripts/Latin handled); extraction of to-dos and **relative dates in Indian phrasing**; faithfulness (every to-do traceable to transcript words).

| Candidate | Role | Size / format | License (verify at build) | Notes |
|---|---|---|---|---|
| SraVaani (ARTPARK-IISc) | ASR (default candidate) | ~430M, FP16 ~900 MB | verify (gated download) | Indic-dialect ASR. Confirm the repo, size, language list and license on Hugging Face in S0 before benchmarking; drop it with a note if any of them don't hold. |
| IndicConformer (AI4Bharat) | ASR | ~600M | verify | multilingual Indic conformer |
| Whisper small / medium (faster-whisper) | **ASR baseline** | 244M / 769M | MIT | generic multilingual |
| Sarvam-1 or another Indic-tuned small LM | extraction (default candidate) | ~2B | verify open weights + terms | Indic-first tokenizer |
| Qwen3-4B-Instruct | extraction | 4B GGUF Q4 | Apache-2.0 | multilingual general model |
| Gemma small instruct | extraction | ≤ 4B | Gemma terms (verify) | multilingual |
| dateparser + keyword rules | **extraction baseline** | — | BSD | deterministic |

Selection: ASR in S0 (CER/WER per language, real-time factor, RAM); extraction in S1 (to-do F1, date accuracy, faithfulness, schema validity). **Ship rule:** an Indic ASR model replaces Whisper as default only if it improves average CER across enabled languages by ≥ 20% relative; the SLM extractor ships only if to-do F1 beats the rules baseline by ≥ 10 pp with ≥ 0.95 faithfulness. Otherwise the baseline ships and the numbers are published.

## Fixtures and metrics

- `fixtures/audio/`: short synthetic notes per language generated with an open Indic TTS (license recorded), plus code-mixed scripts, silence, music, clipped and corrupt files; gold transcripts, gold to-dos and gold dates (with a fixed "now").
- `fixtures/text/`: ≥ 300 transcript-level extraction cases across languages with gold JSON, incl. ≥ 40 relative-date expressions per major language and ≥ 10 injection cases.
- Public evaluation subsets fetched at setup (license permitting) for realistic CER/WER.
- Metrics: CER/WER per language, RTF, peak RAM, to-do precision/recall/F1, date exact-match, faithfulness rate, schema validity.

## Acceptance criteria

`Plat`: `host` = pytest; `web` = Playwright (Chromium, fake audio capture from a fixture file); `device` = real microphone/phone by the owner (NOT_RUN unless done).

| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | - | Clean checkout: `setup.sh` installs, fetches and sha256-verifies pinned models; `voicenote --help` and `voicenote doctor` run offline. | pytest CLI e2e |
| A02 | P0 | host | UC02 | `voicenote transcribe <file>` handles wav/mp3/m4a/ogg/opus/webm fixtures and prints the transcript with the detected language. | pytest e2e |
| A03 | P0 | host | UC04 | ASR selection eval recorded per language for every candidate and the Whisper baseline (CER/WER, RTF, RAM); ship rule applied in `docs/evidence/S0/asr_selection.md`. | eval JSON |
| A04 | P0 | host | UC04 | Language ID accuracy ≥ 0.95 on enabled-language fixtures; code-mixed notes are labelled as their primary language with the mix flagged. | eval run |
| A05 | P0 | host | UC05 | Extraction output is 100% schema-valid; a forced-invalid output falls back to rules and is flagged. | pytest real model + adversarial outputs |
| A06 | P0 | host | UC05 | Extraction selection eval (to-do F1, date accuracy, faithfulness) recorded for candidates and the rules baseline; ship rule applied. | eval JSON |
| A07 | P0 | host | UC05 | Relative-date resolver: Indic and English expressions resolve to the gold date/time for a fixed "now" and timezone on ≥ 95% of cases per enabled language. | pytest |
| A08 | P0 | host | UC07 | `.ics` export validates (RFC 5545 parser round-trip), one item per selected to-do, correct timezone; JSON and Markdown match the reviewed items exactly. | pytest |
| A09 | P0 | web | UC01 | Recording in the UI (fake audio capture of a fixture) produces the transcript and to-dos on screen. | Playwright |
| A10 | P0 | web | UC06 | Edits to transcript and to-dos are reflected exactly in every export. | Playwright |
| A11 | P0 | web | UC07 | Share/copy produces plain text with summary and to-dos (clipboard read back). | Playwright |
| A12 | P0 | host | UC04, UC08 | Per-language bars: every `ENABLED` language meets its CER and extraction bars on its eval set; results table committed. | eval run |
| A13 | P0 | host | UC08 | A configured language below its bar loads as `UNSUPPORTED`; a note in it shows the supported list and its measured numbers; nothing further runs. | pytest |
| A14 | P1 | host | UC04 | Code-mixed Hindi–English and Tamil–English fixtures meet the code-mixed CER bar (or `PARTIAL` with numbers). | eval run |
| A15 | P0 | host | UC09 | Silence, music-only, too-short, too-long (> 30 min), corrupt and unsupported inputs each give a specific message; no crash. | pytest negative |
| A16 | P1 | host | UC12 | A 30-minute note is processed with peak RAM within the D1 budget and a coherent summary. | pytest `bench` (building host) |
| A17 | P0 | host | UC11 | Spoken-injection fixtures: no obeyed instruction; extracted items stay faithful. | pytest real model |
| A18 | P0 | host | UC10 | With network denied, processing succeeds and issues zero requests; no audio/text in logs or temp files after completion. | pytest offline + audit |
| A19 | P1 | host | UC03 | Files dropped into the watch folder and a WhatsApp export are queued, processed once, and results written next to them. | pytest |
| A20 | P1 | device | UC01 | Owner's real-microphone notes in two Indian languages are transcribed and extracted acceptably (owner-recorded, not committed). | owner run notes |
| A21 | P0 | host | - | License inventory for dependencies, models, TTS used for fixtures and evaluation datasets; seeded violation caught. | audit script |
| A22 | P1 | web | - | A real end-to-end demo recorded as a ≤ 15 MB 720p video with captions. | video manifest |

## Conformance

| ID | Slice | Refs | Artifact (committed path) | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC04 | `docs/evidence/S0/asr_selection.md` per-language table + sample transcripts | The comparison is fair and the transcripts read right |
| O02 | S1 | UC05, UC07 | `docs/evidence/S1/owner/` sample to-dos and a calendar import screenshot | To-dos and dates are right; calendar import works |
| O03 | S3 | UC04, UC08 | `docs/evidence/S3/language_matrix.md` (enabled / unsupported with numbers) | The language promises are honest |
| O04 | S5 | UC01, UC07 | `docs/demo/voicenote-demo.mp4` | The demo shows the real product working |

## Slices

TDD and evidence as in `AGENTS.md`.

### S0 — Transcribe a note in its own language: pick the ASR model by measurement

**Acceptance IDs:** A01, A02, A03, A04

Observable result: `voicenote transcribe fixtures/audio/ta_reminder.opus` prints a Tamil transcript in Tamil script with the detected language, from the measured-and-chosen local ASR model.

### S1 — From transcript to to-dos and calendar

**Acceptance IDs:** A05, A06, A07, A08

Observable result: `voicenote process <file>` prints a summary and to-dos with resolved dates and writes a valid `.ics` that imports into a calendar.

### S2 — Record, review, edit, share in the browser

**Acceptance IDs:** A09, A10, A11

Observable result: the user records in the local UI, sees transcript and to-dos, edits them, and exports or shares.

### S3 — Indian languages and code-mixing, configurable within the models' limits

**Acceptance IDs:** A12, A13, A14

Observable result: the language matrix shows which languages are enabled with their numbers; a below-bar language is clearly refused.

### S4 — Robust, private, hands-free inputs

**Acceptance IDs:** A15, A16, A17, A18, A19, A20

Observable result: bad audio gets kind messages, long notes work, injection is ignored, the network can be off, and watch-folder/WhatsApp notes are processed automatically.

### S5 — Conformance, licenses, demo

**Acceptance IDs:** A21, A22

Observable result: conformance report, license inventory, `docs/KNOWN_LIMITS.md` and the demo video in the repo.

## Toolchain and preflight

- `ci`: python3. `build`: python3 ≥ 3.11, git, an ffmpeg binary (system or the pip static build), disk ≥ 20 GB, PyPI + Hugging Face reachable (and a Hugging Face token in `HF_TOKEN` if a chosen model is gated); info: RAM, cores, Playwright Chromium.
- CI gets ffmpeg from the pip static build in `setup.sh`; no apt and no workflow change needed.

## Risks

| Risk | Mitigation |
|---|---|
| Indic ASR weak on accents/dialects/noise | Per-language bars, `UNSUPPORTED` gate, published matrix, owner device pass (A20) |
| Gated or non-redistributable model licenses | Verify before shipping; fall back to the next candidate; inventory A21 |
| Synthetic TTS too clean vs real speech | Add public eval subsets and the owner device pass; state the gap in KNOWN_LIMITS |
| CPU too slow for long notes | VAD chunking, streaming ASR variant, RTF budget, A16 |
| Date ambiguity (12/03, "next Friday") | Deterministic resolver with locale rules; ambiguous dates flagged for review |
| Hallucinated to-dos | Faithfulness guard: every item must map to transcript spans |

## CI and evidence strategy

- The shared workflow (`ubuntu-latest`, Python 3.11) calls this project's `scripts/setup.sh`, `test.sh`, `demo.sh`, `verify.sh`. In the plan phase these are the honest plan-only scripts (plan lint, linter self-test, work-queue preview). **S0 replaces all four** with the real ones; the plan-only scripts fail once the phase is `BUILDING`, so CI can never pass a building project on plan checks alone.
- `setup.sh` (from S0): create `.venv`, install pinned dependencies (resolved at build time, recorded in `docs/evidence/<slice>/versions.json`), download every pinned model **once** into the gitignored `.cache/models/` and verify size + sha256 against `scripts/model_manifest.json` (retry transient downloads up to 6 times). `test.sh`: ruff, mypy (strict on `src/`), pytest with markers `fast` (no model inference) and `slow` (real model inference), JUnit XML to `docs/evidence/<slice>/junit/host*.xml` (and `chromium*.xml` for UI flows). `demo.sh`: the slice's end-to-end demo commands on fixtures, offline after setup. `verify.sh`: plan lint + evidence integrity.
- **CI wall-clock budget.** One project's whole CI run (setup incl. model download + `test.sh` + `demo.sh` + `verify.sh`) must stay ≤ 45 minutes on `ubuntu-latest` (4 vCPU). Measure it on the first S0 CI run and record it in `docs/status.md`. Full candidate benchmarks, long-input tests and anything else over budget get the pytest marker `bench`, run on the building host only (machine specs recorded), and are excluded from CI. A `bench` result can back `PASS` only through its committed host JUnit. CI always runs every `fast` test and a `slow` real-model smoke subset of the shipped default.
- **Real models in CI.** The default model for each role must fit the CI budget in D-table "CI budget". Heavier benchmark candidates run on the building host and are recorded with machine specs; they never replace the CI run of the shipped default. If CI cannot run a required real-model test, it fails and the slice is `BLOCKED` until the owner sets the `MONOREPO_CI_RUNNER` repository variable to a capable runner. Mocks never substitute for required model inference.
- **Live integrations** (`live` platform rows: real Google/IMAP/Reddit/market accounts) run only on the building host with owner-provided credentials in environment variables or the OS keyring, never committed. CI runs the same adapters against recorded, sanitized contract fixtures (`fast`). A `live` row without a real run is `NOT_RUN`, never `PASS`.
- Committed evidence (JUnit, logs, `summary.json`, model manifest, eval JSON) comes from the building host's own real run; CI re-runs the suite independently. Each slice's `summary.json` records a `source_digest` over `src/`, `tests/`, `fixtures/`, the lock file and config; `scripts/verify_evidence.py` (created in S0) enforces it for the current slice and that every `PASS` is backed by a passing JUnit testcase.
- Never commit model weights, OAuth tokens, credentials, real mail/receipts/recordings/documents, scraped third-party article text, or build output.

## Autonomy and merge policy

- The building agent runs without routine questions: decide, record the decision in the ledger or the slice issue, continue.
- It may merge its own PR (squash, via its runner doc's command) only when: `monorepo / verify` passed on the PR head; `bash scripts/verify.sh` and the full local suite passed on the same tree with committed evidence whose `source_digest` matches; the diff contains only in-scope files; nothing is `BLOCKED`. Then verify GitHub reports `MERGED`, `git checkout main && git pull --ff-only`, record the merge SHA in the **next** slice's status update, and continue.
- Never push to `main`, force-push, bypass checks, change repo/org settings, spend money (no paid API tiers), send email, place trades, publish, deploy, or install anything outside D-table "Installs".
- Stop and report `BLOCKED` (do not improvise) when: preflight finds a missing prerequisite; a test fails for reasons not fixable within the slice after 3 genuine attempts; CI fails after 3 attempts; RAM/disk runs out for a required step (report the numbers); a required step would need a weakened/skipped/faked test or an invented number; a data source's terms forbid the planned use; the plan's premise is contradicted by measurement (post the finding first, then `needs-decision` with options).
- After each merged PR report: slice, branch, PR URL, commands with exit codes, evidence paths, per-acceptance-ID status, model manifest changes, merge SHA from GitHub, limitations, next slice.
