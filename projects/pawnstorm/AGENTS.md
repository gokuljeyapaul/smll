# AGENTS.md — pawnstorm

## Mission

Build **pawnstorm**: a browser chess app (TypeScript + Vite SPA, PWA) where small open-weight language models play chess — SLM vs SLM, human vs SLM, and guided games where a second SLM coaches the human. Models are plug and play (bundled presets, Hugging Face GGUF links, local files, or a model server on the user's own machine/LAN), and every game is recorded with exactly which model played it, so the app doubles as a reproducible chess benchmark for small models.

The complete, linted specification is `docs/BUILD_PLAN.md`; follow it. This project lives at `projects/pawnstorm/` inside the single smll monorepo: do not run `git init`, do not touch other projects, do not share code or models with other projects (each project picks and ships its **own** small language model).

**Autonomy.** Run without asking the owner questions. Decide, record the decision in the ledger or the slice issue, and continue. Stop only under the stop conditions in the plan ("Autonomy and merge policy"). "continue pawnstorm" is the whole launch message.

**Runners.** This file and the plan are runner-neutral. Mechanics that differ per environment live in `docs/runners/` (`hermes.md`). A runner doc never relaxes a rule here.

**Builder vs product model.** The building agent may use any approved coding model (e.g. Hermes on Ollama Cloud). The **product** must never call a cloud model: every inference the shipped app performs runs locally on CPU, in the browser or on a local/LAN model server (plan D4), and the bundled presets are pinned in `scripts/model_manifest.json`.

## Read first (in this order)

1. Monorepo-root `AGENTS.md` (branch / PR / evidence / work-queue rules).
2. This file, `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json`, `docs/evidence/`.
3. Run `bash scripts/preflight.sh build` and `bash scripts/verify.sh`; resume from the ledger and the issue queue, never from chat history.
4. Check that `main`'s latest CI run is green before starting a slice.

## Hard rules

- **Honesty over green.** Statuses are `PASS | PARTIAL | NOT_RUN | BLOCKED`. `PASS` only when a committed, passing JUnit testcase backs it. Never invent logs, games, ratings, metrics, hashes, versions, screenshots or videos.
- **The SLM must earn its place.** The default opponent and the coach are chosen **by measurement** against the plan's named baselines (ladder bots, deterministic hints), on this project's fixtures, on CPU. If no SLM meets the ship rule, the baseline ships as the default and the finding is published with numbers (a valid, valuable completion).
- **Real components.** Game and model tests run the real pinned weights through the real runtime in real Chromium. Recorded model replies may test the parser and verifier, never stand in for model evidence.
- **Local only.** No telemetry, no analytics, strict CSP; model endpoints only on loopback or private LAN (plan D4); after models are cached the app works offline.
- **Fail closed.** Illegal or garbled moves, invalid coach claims, bad model files, out-of-memory and unreachable servers degrade to the plan's safe behaviour with a visible flag; nothing is silently replaced or invented.
- **Benchmark honesty.** Every result records the full D10 metadata; ratings are ladder-anchored with confidence intervals, never called FIDE or site ratings.
- **No copyleft in the product.** The reference engine (e.g. Stockfish) is bench-only on the building host and never bundled; artwork and data licenses are checked and inventoried.
- **Resolve versions at build time**, pin them in the lockfile and `.nvmrc`, record them in `versions.json`. Models are pinned by repo, revision and sha256 in `scripts/model_manifest.json` with license notes.
- Test hooks exist only in dev/test builds and are absent from the production build (A26).

## Delivery loop (one slice = one PR)

1. `git checkout main && git pull --ff-only`; previous slice `MERGED`, or stack on its green, waiting PR per root `AGENTS.md` Git step 8; `bash scripts/preflight.sh build`.
2. Branch `feature/pawnstorm/S<n>-<short-name>`.
3. **RED first**: failing behavioural tests (Vitest assertions, a Playwright flow failing on missing behaviour, or an eval check failing its bar). Build/import errors are not RED. Save real output + exit code to `docs/evidence/S<n>/red.log`.
4. **GREEN**: implement; run typecheck, lint, Vitest, Playwright e2e (Chromium), the real-model smoke, negative tests and all prior regression; save `green.log`, `e2e.log`, `negative.log`, `junit/*.xml`, `versions.json`, and any eval JSON the slice names (bench runs on the building host).
5. Produce the slice's **Owner-visual** artifacts (plan, "Conformance"), phone-viewable; post the tick-list in the slice issue; never tick them yourself.
6. Write `docs/evidence/S<n>/summary.json`, update `docs/status.md`, `milestone-status.json` (S0 sets phase `BUILDING`; `COMPLETE` only when the last slice is merged and every O row is confirmed) and README commands.
7. Review the staged diff for secrets/stray files; open **one PR** with `.github/pull_request_template.md`; follow the merge policy.

### `summary.json` schema

```json
{
  "slice": "S0",
  "source_digest": "<python3 scripts/verify_evidence.py --print-digest on the final tree>",
  "tested_on": {"os": "", "node": "", "chromium": "", "cpu": "", "ram_gb": 0, "runner": ""},
  "models": {"<role>": {"repo": "", "revision": "", "file": "", "sha256": "", "license": ""}},
  "acceptance": {"A01": {"status": "PASS", "tests": ["junit:docs/evidence/S0/junit/host.xml::<testcase>"], "notes": ""}},
  "commands": {"red": {"command": "", "exit_code": 1, "evidence": "docs/evidence/S0/red.log"}},
  "limitations": []
}
```

## Work queue

Follow the root `AGENTS.md` "Work queue". Issues carry the `pawnstorm` label and are generated by `python3 ../../tools/gen_issues.py --project pawnstorm` (preview by default; `--create --repo gokuljeyapaul/smll` creates them).

## Merge policy

As in the plan's "Autonomy and merge policy": merge your own PR only when every gate holds; otherwise stop at `READY_FOR_MERGE` with the exact platform error.
