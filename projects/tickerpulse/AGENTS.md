# AGENTS.md — tickerpulse

## Mission

Build **tickerpulse**: a local, CPU-only research app that fetches news, filings, social posts and prices for a watchlist, has a small open-weight model read every item into structured signals, and produces explained, backtested Buy/Hold/Sell signals per ticker for configurable markets. Paper trading only; not financial advice.

The complete, linted specification is `docs/BUILD_PLAN.md`; follow it. This project lives at `projects/tickerpulse/` inside the single smll monorepo: do not run `git init`, do not touch other projects, do not share code or models with other projects (each project picks and ships its **own** small language model — that is the point of the portfolio).

**Autonomy.** Run without asking the owner questions. Decide, record the decision in the ledger or the slice issue, and continue. Stop only under the stop conditions in the plan ("Autonomy and merge policy"). "continue tickerpulse" is the whole launch message.

**Runners.** This file and the plan are runner-neutral. Mechanics that differ per environment live in `docs/runners/` (`hermes.md`). A runner doc never relaxes a rule here.

**Builder vs product model.** The building agent may use any approved coding model (e.g. Hermes on Ollama Cloud). The **product** must never call a cloud model: every inference the shipped app performs runs locally on CPU with the pinned open-weight model(s) in `scripts/model_manifest.json`.

## Read first (in this order)

1. Monorepo-root `AGENTS.md` (branch / PR / evidence / work-queue rules).
2. This file, `README.md`, `docs/BUILD_PLAN.md` **in full**, `docs/status.md`, `milestone-status.json`, `docs/evidence/`.
3. Run `bash scripts/preflight.sh build` and `bash scripts/verify.sh`; resume from the ledger and the issue queue, never from chat history.
4. Check that `main`'s latest CI run is green before starting a slice.

## Hard rules

- **Honesty over green.** Statuses are `PASS | PARTIAL | NOT_RUN | BLOCKED`. `PASS` only when a committed, passing JUnit testcase backs it. Never invent logs, metrics, hashes, versions, screenshots or videos.
- **The SLM must earn its place.** Every model role in the plan is chosen **by measurement** in its slice against a named non-SLM baseline, on this project's fixtures, on CPU. If the SLM does not beat the baseline by the plan's margin, the baseline ships as the default and the finding is published with numbers (a valid, valuable completion).
- **Real components.** Model tests run the real pinned weights through the real runtime. Unit tests may stub pure logic; stubs never count as evidence for model, fetch, sync or offline behaviour.
- **Local-first, fail closed.** After setup and data fetch, processing runs offline. Invalid model output, failed guards, bad input, or an unreachable source degrade to the previous safe stage with a visible flag; nothing is silently dropped or invented.
- **No secrets, no private data in git.** Credentials come from env vars or the OS keyring. Fixtures are synthetic or public-domain/permissively licensed and recorded with their source and license.
- **Resolve versions at build time**, pin them, record them in `versions.json`. Model repos are pinned by revision and sha256 in `scripts/model_manifest.json` with license and license-check notes.
- **Configurable, within the model's limits.** Anything the plan marks configurable (languages, markets, sources, categories) is data in `config/`, validated by a schema; a configured value the pinned model has not passed its eval for is refused or flagged `UNSUPPORTED`, never silently attempted.

## Delivery loop (one slice = one PR)

1. `git checkout main && git pull --ff-only`; previous slice `MERGED`; `bash scripts/preflight.sh build`.
2. Branch `feature/tickerpulse/S<n>-<short-name>`.
3. **RED first**: failing behavioural tests (pytest assertions, an e2e CLI/UI flow failing on missing behaviour, or an eval check failing its bar). Import/build errors are not RED. Save real output + exit code to `docs/evidence/S<n>/red.log`.
4. **GREEN**: implement; run lint, types, unit, integration, real-model, e2e, negative and all prior regression; save `green.log`, `e2e.log`, `negative.log`, `junit/*.xml`, `versions.json`, and any eval JSON the slice names.
5. Produce the slice's **Owner-visual** artifacts (plan, "Conformance"), phone-viewable; post the tick-list in the slice issue; never tick them yourself.
6. Write `docs/evidence/S<n>/summary.json`, update `docs/status.md`, `milestone-status.json` (S0 sets phase `BUILDING`; `COMPLETE` only when the last slice is merged and every O row is confirmed) and README commands.
7. Review the staged diff for secrets/stray files; open **one PR** with `.github/pull_request_template.md`; follow the merge policy.

### `summary.json` schema

```json
{
  "slice": "S0",
  "source_digest": "<python3 scripts/verify_evidence.py --print-digest on the final tree>",
  "tested_on": {"os": "", "python": "", "cpu": "", "ram_gb": 0, "runner": ""},
  "models": {"<role>": {"repo": "", "revision": "", "file": "", "sha256": "", "license": ""}},
  "acceptance": {"A01": {"status": "PASS", "tests": ["junit:docs/evidence/S0/junit/host.xml::<testcase>"], "notes": ""}},
  "commands": {"red": {"command": "", "exit_code": 1, "evidence": "docs/evidence/S0/red.log"}},
  "limitations": []
}
```

## Work queue

Follow the root `AGENTS.md` "Work queue". Issues carry the `tickerpulse` label and are generated by `python3 ../../tools/gen_issues.py --project tickerpulse` (preview by default; `--create --repo gokuljeyapaul/smll` creates them).

## Merge policy

As in the plan's "Autonomy and merge policy": merge your own PR only when every gate holds; otherwise stop at `READY_FOR_MERGE` with the exact platform error.
