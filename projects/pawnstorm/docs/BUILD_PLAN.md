# BUILD_PLAN — pawnstorm

**pawnstorm** is a browser chess app where **small open-weight language models play chess**: SLM vs SLM, human vs SLM, or a **guided** game where the human plays an SLM while a second SLM coaches them. Models are **plug and play**: pick a bundled one, paste a Hugging Face GGUF link, load a local file, or point it at a model server running on your own machine. Because every game is recorded with exactly which model played it, pawnstorm doubles as a **chess benchmark for small models**, with tournaments, a rating ladder and tactics puzzles. Everything runs locally on CPU; no cloud model is ever called.

Executed autonomously by a building agent on Linux (runner-neutral, `docs/runners/`); machine-linted by `python3 scripts/plan_lint.py`.

## Purpose and honesty statement

- Goal: show, with numbers, how well today's small models actually play and explain chess, whether that's good or bad, and give anyone a fair, reproducible way to measure the next small model.
- Chess is a hard test for small language models: they must keep track of the board, follow the rules, and choose well. Many will play illegal or weak moves. That is a result to publish, not hide: illegal-move rates and losses to trivial baselines are reported as prominently as wins.
- Ratings are **relative to this app's own ladder** (D9), with confidence intervals. They are never presented as FIDE or online-site ratings.
- A passing suite proves behaviour on the fixtures, opening suite and puzzles used, for the pinned models. Results for a user-added model hold only for that exact file (sha256) and settings.
- Non-goals (v1): online play between people, accounts, cloud models, native iOS/Android apps, a strong chess engine of our own, time-control tournaments for humans, variants (Chess960 etc.).

## Owner decisions and defaults

| ID | Decision | Default (apply unless the owner changes it) |
|---|---|---|
| D1 | CI budget | Shipped default player and coach models ≤ 1B parameters each, GGUF ≤ Q4/Q5, ≤ 1 GB on disk each. CI runs a real-model **smoke** only: ≤ 20 fixed positions per role plus one capped game of ≤ 20 plies with the shipped default in headless Chromium. Full games, tournaments, candidate selection, puzzle sets and coach evaluation are `bench` (building host). S0 measures per-move latency and the whole CI run and records both. |
| D2 | Stack | TypeScript + Vite single-page app, installable PWA; `chess.js` (or an equally small, permissively licensed rules library, chosen at build) for rules and PGN; in-browser CPU inference via `wllama` (llama.cpp WebAssembly, GGUF), with `transformers.js` (ONNX, WASM) as a second runtime only if a candidate needs it; Vitest for unit tests; Playwright (Chromium) for e2e and for the headless arena runner. Node LTS resolved at build and pinned in `.nvmrc`. |
| D3 | Game modes | **Watch:** SLM vs SLM (or SLM vs ladder bot), with pause, step, speed and "why?" (the model's short reason, shown as the model's own words). **Play:** human vs SLM, choose colour, undo, resign, offer draw (the SLM side answers by a simple rule: accepts only if the position is a dead draw or repeated). **Guided:** human vs SLM, with a second SLM as coach (D5). Any model can take any seat, including the same model on both sides (loaded once). |
| D4 | Plug-and-play models | A model is a **profile** in `config/models.json` (schema-validated): id, name, source, chat template, context length, sampling (temperature, top-p, seed, max tokens), and prompt profile. Sources: (a) **bundled presets**: pinned by repo + revision + sha256 in `scripts/model_manifest.json`, downloaded once and cached in browser storage; (b) **Hugging Face GGUF link**: the user pastes a repo/file; the app downloads it, computes and shows its sha256, and reads the chat template and context length from GGUF metadata (overridable); (c) **local file**: a GGUF picked from disk, kept in browser storage (OPFS); (d) **local model server**: an OpenAI-compatible endpoint (Ollama, llama.cpp server, LM Studio and similar). **Local only:** an endpoint is accepted only on loopback (`localhost`, `127.0.0.0/8`, `[::1]`) or a private LAN address (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`); anything else is refused with "pawnstorm only talks to models on your own machine or network". User-added models are playable at once but labelled **unverified** until they have benchmark results on this device. |
| D5 | Coach (guided mode) | The coach gets the position, the move history, the legal moves and a set of **facts computed by code** (checks, captures, pieces attacked and defended, hanging pieces, material balance, the opponent's last move and its threats). It answers in a fixed JSON shape: hint level, optional suggested move, a short explanation, and the squares/pieces it refers to. Three hint levels: 1 "what to look at" (no move), 2 "which piece", 3 "the move and why". After each human move, the coach can flag a blunder ("that leaves your knight on f3 undefended"). A **verifier** checks every hint before it is shown: the suggested move must be legal; every square, piece and claim it names (check, capture, attacked, hanging, defended) must be true on the board; anything unverifiable is removed and the hint falls back to the deterministic hint for that position. |
| D6 | Move protocol | The player model receives the board as FEN plus an ASCII diagram, the move history (SAN) and, depending on the **move mode**, the legal moves. Modes: `free` (no legal-move list), `listed` (legal moves in the prompt, default for play), `constrained` (decoding restricted by grammar to legal moves; only on runtimes that support grammars, otherwise the mode is shown as unsupported for that model, never silently replaced). The reply must contain exactly one move in SAN or UCI, plus an optional short reason. Illegal or unparseable replies get up to 2 retries with the specific error; then the **illegal-move policy** applies: in casual play a random legal move is played and visibly flagged ("pawnstorm moved for the model"); in benchmarks the model forfeits the game (configurable). Every attempt is logged in the game record. |
| D7 | Phone | Mobile-first, responsive UI (works from 360 px wide, ≥ 44 px touch targets, tap-to-move and drag-to-move, no horizontal scroll). Running a model inside a phone browser may be slow or run out of memory; the app measures and warns before loading, and fails closed with a clear message. A phone can instead use a local model server on the same Wi-Fi (D4 d). No native apps. |
| D8 | Storage and privacy | No accounts, no telemetry, no analytics, strict CSP. Stored only in this browser: cached model files, the user's model profiles, saved games (PGN) and benchmark results. "Clear all data" removes everything (optionally keeping model files), after a confirmation that shows what goes. After models are cached, the app makes no network requests except to a configured local model server. Export/import of games (PGN) and results (JSON). |
| D9 | Baselines and rating ladder | Built-in bots written for this project (no third-party engine in the product): **L0** random legal mover, **L1** greedy (best immediate material, random tie-break), **L2** minimax depth 2 with material + simple mobility, **L3** minimax depth 3 with alpha-beta. Ratings are fitted with a Bradley–Terry / Elo model anchored at **L0 = 0**, reported with 95% confidence intervals, and only shown once a model has ≥ 40 games against ≥ 2 opponents. |
| D10 | Benchmark rules | Fixed **opening suite** (`fixtures/openings.json`: ≥ 50 short, balanced openings written as move lists for this project), every pairing played with colours swapped, deterministic seeds, max 200 plies (then a draw by adjudication rule recorded as such), per-move token and wall-clock caps. Every result and PGN header records: model id, file sha256, quantization, runtime + version, threads, sampling settings, seed, move mode, prompt-profile version, app version, device summary. **Puzzles:** a fixed subset of the Lichess puzzle database (CC0), stored with its source, scored as "first move correct" and "full line correct". A **reference engine** (e.g. Stockfish, GPL-3) may be used only by the benchmark tooling on the building host for move-quality metrics (average centipawn loss, blunder rate); it is never bundled into the production build. |
| D11 | Limits (small-model aware) | Defaults in `config/limits.json`, schema-validated: model file ≤ 4 GB (warning above 1.5 GB on phones); two different models loaded at once only if estimated memory fits (else one is unloaded, or the user is told why not); prompt assembled against the model's real context length minus a reserved answer budget, with history shortened to the last N moves plus FEN when needed (never cutting the FEN or the legal-move list); answer capped in tokens and seconds, after which the illegal-move policy applies. |
| D12 | Installs | Project-local `npm ci` (lockfile committed); Playwright Chromium. For `bench` only: a reference engine binary or npm package on the building host, not part of the shipped app. |
| D13 | Merging | Agent merges its own PRs under the policy below. |

## Use cases

| ID | Title | Description |
|---|---|---|
| UC01 | Watch two SLMs play | Pick two models (or one model against itself, or a model against a ladder bot) and watch the game move by move, with each model's short reason. |
| UC02 | Play against an SLM | Choose a model and a colour; move by tap or drag; undo, resign, offer a draw; the game ends correctly (checkmate, stalemate, repetition, 50-move rule, insufficient material). |
| UC03 | Guided game | Play an SLM while a coach SLM offers hints at three levels and flags blunders; every hint is checked against the board before it is shown. |
| UC04 | Plug in a model | Add a model from a Hugging Face GGUF link, a local file or a local model server; set its chat template, context and sampling; it appears in every seat picker. |
| UC05 | Illegal moves handled | A model that answers with an illegal or garbled move is retried with the error, then the illegal-move policy applies, and the game record shows exactly what happened. |
| UC06 | Run a tournament | Choose models and bots, the opening suite and the move mode; run a round-robin with colours swapped; see standings, ratings with confidence intervals, illegal-move rates and speed. |
| UC07 | Solve puzzles | Run a model through the puzzle set and see its first-move and full-line accuracy by theme. |
| UC08 | Leaderboard and export | See all results on this device, filter by mode and settings, and export PGN, JSON and a shareable plain-text summary. |
| UC09 | Reproduce a result | Re-running a benchmark with the same model file, settings and seed gives the same moves (at temperature 0) and the same result. |
| UC10 | Phone | Play, watch and read results on a phone browser, with a local model or a model server on the same Wi-Fi. |
| UC11 | Offline and private | After models are cached, everything works with the network off; nothing is uploaded or tracked. |
| UC12 | Clear data | Remove one model, one saved game or benchmark run, or clear everything stored, with a clear confirmation of what goes. |

## Architecture

```
seat pickers (Watch / Play / Guided / Arena)
        ▼
 game/    rules + PGN (chess.js) · game controller · clocks/caps · illegal-move policy
        ▼
 players/ Player interface: propose(position, history, legalMoves, mode) → move + reason
          ├─ human (tap/drag)   ├─ ladder bots L0–L3 (own code)
          └─ SLM player: prompt profile → runtime adapter → move parser → legality check → retries
 runtimes/ wllama (GGUF, WASM, CPU; grammar for `constrained`) · transformers.js (optional)
           · local server (OpenAI-compatible, loopback/LAN only)
 coach/   board facts (code) → coach SLM → hint verifier → fallback deterministic hint
 bench/   tournament scheduler · opening suite · puzzles · rating fit · result store · export
 ui/      responsive board, model library, leaderboard, settings (PWA, strict CSP)
 tools/   headless arena CLI = the same app in headless Chromium via Playwright (bench, CI smoke)
```

## The SLM showcase

What is tested explicitly: following the rules (illegal-move rate per move mode), playing strength against fixed baselines, tactics (puzzles), explaining a position truthfully (coach claims verified against the board), and staying fast and small enough for a CPU in a browser.

| Candidate | Role | Size / format | License (verify at build) | Notes |
|---|---|---|---|---|
| Qwen3 0.6B / 1.7B | player, coach | GGUF Q4 | Apache-2.0 | 1.7B only as a host bench candidate (above D1) |
| Qwen2.5 0.5B / 1.5B Instruct | player, coach | GGUF Q4 | Apache-2.0 | 1.5B host bench only |
| SmolLM2 360M / 1.7B Instruct | player, coach | GGUF Q4 | Apache-2.0 | small enough for phones |
| Gemma 3 1B instruct | player, coach | GGUF Q4 | Gemma terms (verify) | |
| Llama 3.2 1B Instruct | player, coach | GGUF Q4 | Llama 3.2 Community License (verify) | |
| Any chess-tuned open-weight small model found at build time | player | ≤ 1B for default, larger for host bench | verify | include only with a verified license and a pinned revision |
| Ladder bots L0–L3 | **player baseline** | — | own code | random, greedy, minimax d2/d3 |
| Deterministic hints from board facts | **coach baseline** | — | own code | templated text from the same facts the coach sees |

Selection and **ship rules** (both by measurement on the building host, numbers published in `docs/evidence/`):
- **Default player (S0):** among candidates within D1, the model with the best score against the ladder in `listed` mode, over ≥ 40 games per candidate with colours swapped, ships as the default opponent only if it scores ≥ 60% against **L0** and its illegal-move rate (before retries) is ≤ 10%. If no candidate meets that, the app still ships them all, the default opponent becomes **L1** with the SLMs available as "experimental", and the finding is published with numbers.
- **Coach (S3):** the coach SLM ships as the default in guided mode only if (a) ≥ 95% of its shown hints pass the verifier unchanged, and (b) a simulated learner (L1 with random blunders at a fixed rate) that follows its hints improves its score against L2 by ≥ 10 percentage points more than when following the deterministic hints. Otherwise guided mode ships with the deterministic hints, the coach SLM stays selectable as "experimental", and the numbers are published.

## Fixtures and metrics

- `fixtures/positions/`: ≥ 150 FEN positions with expected legal-move sets and outcomes: castling (all rights cases), en passant, promotion (incl. under-promotion), check/checkmate/stalemate, repetition, 50-move rule, insufficient material; plus perft counts for the standard start and well-known test positions.
- `fixtures/replies/`: ≥ 200 recorded and hand-written model replies (clean SAN, UCI, SAN with chatter, two moves, illegal, ambiguous, empty, wrong side, instructions instead of a move) with the expected parse result.
- `fixtures/openings.json`: the D10 opening suite (written for this project).
- `fixtures/puzzles.jsonl`: a fixed ≥ 300-puzzle subset of the Lichess puzzle database (CC0), with themes and ratings, source and date recorded; small smoke subset for CI.
- `fixtures/coach/`: ≥ 100 positions with the board facts and gold "true claims", plus ≥ 30 coach outputs seeded with false claims (wrong square, imaginary check, illegal move).
- Metrics: illegal-move rate before/after retries per mode, score and rating vs ladder with 95% CI, puzzle first-move and full-line accuracy, per-move latency (p50/p95) and tokens per move, peak memory, coach verified-claim rate, coached-learner score delta; on the host only, average centipawn loss and blunder rate from the reference engine.

## Acceptance criteria

`Plat`: `host` = Vitest/Node; `web` = Playwright (Chromium) against the built app; `device` = a real phone, by the owner (NOT_RUN unless done). Rows marked `bench` in Verification run on the building host only (D1).

| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | - | Clean checkout: `setup.sh` runs `npm ci`, installs Playwright Chromium and downloads + sha256-verifies the pinned preset models; `npm run build` produces the app; `npm run arena -- --help` works offline. | Vitest + CLI e2e |
| A02 | P0 | host | UC02 | Rules: every fixture position yields exactly the expected legal moves and outcome; perft counts match for the fixture positions to the listed depth; PGN export/import round-trips. | Vitest |
| A03 | P0 | host | UC05 | Move parser: every `fixtures/replies/` case gives the expected result (move, or a specific error); retries carry the error; after the retry limit the casual policy plays a flagged random legal move and the benchmark policy forfeits; every attempt appears in the game record. | Vitest |
| A04 | P0 | web | UC01 | A real pinned SLM plays a capped game against L1 in headless Chromium through the arena CLI; every played move is legal; the game record has the D10 metadata. | Playwright (CI smoke) |
| A05 | P0 | host | UC01, UC06 | Player selection: every candidate and the ladder played under D10 rules; results, ratings with CIs, illegal-move rates, latency and memory recorded; ship rule applied in `docs/evidence/S0/model_selection.md`. | `bench` eval JSON + host JUnit |
| A06 | P0 | host | UC01 | Ladder bots: L0 only plays legal moves uniformly; L1 always takes the best immediate material; L2/L3 find every mate-in-1 / mate-in-2 fixture; L3 scores ≥ 70% vs L1 over 40 games. | Vitest |
| A07 | P0 | host | UC04 | Context and limits: for every fixture position and each preset's real context length, the assembled prompt fits with the answer budget reserved (asserted with the model's own tokenizer), FEN and legal-move list are never cut, and token/time caps trigger the illegal-move policy. Out-of-range `limits.json` is refused at startup. | Vitest + real tokenizer |
| A08 | P0 | web | UC02 | Play mode: human (tap and drag) vs a real SLM; illegal human moves are refused; undo, resign and draw offer work; checkmate, stalemate, repetition, 50-move and insufficient-material endings are announced correctly. | Playwright |
| A09 | P0 | web | UC01 | Watch mode: two SLMs (and one model against itself, loaded once) play with pause, step and speed; each move shows the model's reason as its own words; a flagged fallback move is visibly marked. | Playwright |
| A10 | P0 | web | UC10 | Play, watch and results work at 360×800, 390×844 and 1280×800 with no horizontal overflow and ≥ 44 px touch targets; keyboard move entry works. | Playwright (viewport matrix) |
| A11 | P1 | device | UC10 | On the owner's real phone: a bundled model loads (or fails closed with the memory message) and a game against a local model server on the same Wi-Fi works. | owner run notes |
| A12 | P0 | web | UC04 | Add model from a Hugging Face GGUF link and from a local file: the sha256 is shown, chat template and context are read from metadata (and can be overridden), the model is labelled unverified and is usable in every seat; a non-GGUF, truncated or oversized file is refused with a specific reason. | Playwright (fixture GGUF served locally) |
| A13 | P0 | host | UC04, UC11 | Local-only endpoints: loopback and private-LAN URLs are accepted; public hosts, public IPs, DNS names resolving to public IPs and redirects to them are refused with the specific message; no request is sent before the check passes. | Vitest negative |
| A14 | P0 | web | UC04 | A local OpenAI-compatible server (a test server in the suite running a real pinned GGUF) plays a game through the endpoint adapter. | Playwright |
| A15 | P0 | host | UC04 | Profile schema: `config/models.json` validates; bad profiles (missing fields, unknown runtime, `constrained` on a runtime without grammars) are refused or shown as unsupported, never silently changed. | Vitest |
| A16 | P0 | host | UC03 | Coach verifier: every true fixture hint passes; every seeded false claim (wrong square, imaginary check/capture, illegal move, wrong piece) is caught and the hint falls back to the deterministic one. | Vitest + real model outputs |
| A17 | P0 | web | UC03 | Guided mode: hint levels 1–3 and blunder flags appear for a real coach SLM against a real opponent SLM; hints never reveal more than the chosen level. | Playwright |
| A18 | P0 | host | UC03 | Coach selection: verified-claim rate and coached-learner score delta measured for coach candidates vs deterministic hints; ship rule applied in `docs/evidence/S3/coach_selection.md`. | `bench` eval JSON + host JUnit |
| A19 | P0 | host | UC06, UC09 | Tournaments: round-robin with colours swapped over the opening suite; standings and Bradley–Terry ratings with 95% CIs match a reference computation on fixture results; ratings are hidden below the minimum game count. | Vitest |
| A20 | P0 | host | UC09 | Reproducibility: re-running a 4-game benchmark with the same model file, settings and seed at temperature 0 gives identical PGNs and results; changing any recorded setting changes the result fingerprint. | Vitest + real model |
| A21 | P0 | host | UC07 | Puzzles: scoring of first-move and full-line accuracy matches gold on fixture answers; a real model's run on the CI puzzle subset produces a results file with per-theme accuracy. | Vitest + real model |
| A22 | P0 | web | UC06, UC08 | Arena UI: start a small tournament from the browser, see live standings, then the leaderboard with filters; export PGN, JSON and a plain-text summary whose contents match the stored results. | Playwright |
| A23 | P1 | host | UC06 | Move-quality metrics on the building host: average centipawn loss and blunder rate per model from the reference engine, recorded with engine version and depth. | `bench` eval JSON |
| A24 | P0 | web | UC11 | After models are cached, with the network blocked, play, watch, guided and arena modes work and the app makes zero network requests (local model server excepted when configured). | Playwright offline |
| A25 | P0 | web | UC12 | Removing one model, game or benchmark run removes only that; "Clear all data" empties every store (cache, OPFS, IndexedDB, local storage) except model files when kept, and the next load behaves like a fresh install. | Playwright |
| A26 | P0 | host | UC11 | Privacy and build audit: no telemetry/analytics code or requests, strict CSP present, test hooks absent from the production build, the reference engine absent from the production build. | Vitest audit |
| A27 | P0 | host | - | License inventory for dependencies, models, piece-set and other artwork, opening suite and puzzle data; the reference engine is listed as bench-only; seeded violation caught. | audit script |
| A28 | P1 | web | - | A real end-to-end demo (watch, play, guided, plug in a model, tournament, leaderboard) recorded as a ≤ 15 MB 720p video. | video manifest |

## Conformance

| ID | Slice | Refs | Artifact (committed path) | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC01, UC06 | `docs/evidence/S0/model_selection.md` with sample PGNs (viewable as text) and the illegal-move table | The comparison is fair and the games look like real (if weak) chess |
| O02 | S1 | UC02, UC10 | `docs/evidence/S1/owner/` screenshots at phone (390×844) and desktop size of watch and play | The board feels good on a phone and desktop |
| O03 | S2 | UC04 | `docs/evidence/S2/owner/` "add a model" screenshots for each source + the refused-endpoint message | Plugging in a model is easy and the local-only rule is clear |
| O04 | S3 | UC03 | `docs/evidence/S3/owner/` guided-game screenshots with hints at each level and a blunder flag | The hints are helpful and true |
| O05 | S4 | UC06, UC08 | `docs/evidence/S4/owner/` leaderboard screenshots and an exported plain-text summary | The benchmark results are clear and honest |
| O06 | S5 | UC01, UC03 | `docs/demo/pawnstorm-demo.mp4` | The demo shows the real product working |

## Slices

TDD and evidence as in `AGENTS.md`.

### S0 — SLMs play legal chess: rules, move protocol, ladder, pick the default by measurement

**Acceptance IDs:** A01, A02, A03, A04, A05, A06, A07

Observable result: `npm run arena -- --white preset:<default> --black ladder:L1 --games 2` plays two real games in headless Chromium and prints the PGNs, the result and the illegal-move count; `docs/evidence/S0/model_selection.md` shows which model ships as the default opponent and why.

- Scope: scaffold + real scripts, model manifest, rules wrapper, Player interface, wllama runtime, prompt profiles, move parser + illegal-move policy, ladder bots, arena CLI, selection bench; phase → `BUILDING`.

### S1 — Watch and play in the browser, phone-first

**Acceptance IDs:** A08, A09, A10, A11

Observable result: in the browser (laptop or phone), the user watches two SLMs play with their reasons shown, and plays a full game against the default model by tap or drag.

### S2 — Plug and play: add any local model

**Acceptance IDs:** A12, A13, A14, A15

Observable result: the user pastes a Hugging Face GGUF link (or picks a file, or enters a local model server URL), the model appears labelled unverified, and it plays a game; a public endpoint is refused with the local-only message.

### S3 — Guided mode with a coach SLM

**Acceptance IDs:** A16, A17, A18

Observable result: in a guided game, the coach gives level 1–3 hints and flags blunders, every hint checked against the board; `docs/evidence/S3/coach_selection.md` shows whether the coach SLM beat the deterministic hints.

### S4 — Arena: tournaments, puzzles, leaderboard, reproducible results

**Acceptance IDs:** A19, A20, A21, A22, A23

Observable result: the user runs a small round-robin from the browser (or `npm run arena -- --tournament`), sees standings, ratings with confidence intervals, puzzle accuracy and the leaderboard, and exports PGN/JSON/text; re-running with the same seed reproduces it.

### S5 — Offline, privacy, clear data, licenses, demo

**Acceptance IDs:** A24, A25, A26, A27, A28

Observable result: the app works with the network off, "Clear all data" leaves nothing behind, the audit and license inventory are committed with `docs/KNOWN_LIMITS.md`, and the demo video is in the repo.

## Toolchain and preflight

- `ci`: python3 (plan phase). `build`: node + npm (LTS, pinned in `.nvmrc` by S0), git, disk ≥ 15 GB, registry.npmjs.org + huggingface.co + the Playwright download host reachable; info: RAM, cores, Playwright Chromium, reference engine presence (needed only for `bench` A23).
- The CI runner's preinstalled Node is used; if it is too old for the toolchain, report `BLOCKED` and ask the owner (no `.github/` edits).

## Risks

| Risk | Mitigation |
|---|---|
| Small models play many illegal or very weak moves | Move modes incl. `listed` and `constrained`, retries with the error, flagged fallback, published illegal-move rates, ship rule with an L1 fallback default |
| In-browser inference too slow for full games in CI | D1: CI runs a capped smoke; full games and tournaments are `bench`; per-move latency recorded in S0 |
| Multi-threaded WASM needs cross-origin isolation (COOP/COEP) | The app and the test server send the headers; a single-thread fallback is detected, used and shown |
| Two models at once exhaust browser memory (especially phones) | Memory estimate before loading; same model loaded once; fail closed with a clear message (A11, D11) |
| "Plug and play" becomes a path to cloud models | Local-only endpoint rule with negative tests (A13) |
| Coach says confident nonsense | Verifier against board facts, fallback to deterministic hints, ship rule vs the deterministic baseline |
| Ratings misread as real chess ratings | Ladder-anchored ratings, CIs, minimum game count, wording in the UI and KNOWN_LIMITS |
| Results not comparable across models/devices | Full metadata on every result (D10), reproducibility test (A20), device summary shown on the leaderboard |
| GPL engine or copyleft artwork slipping into the build | Reference engine bench-only and audited (A26); piece set chosen with a permissive license and inventoried (A27) |
| Model license surprises | Inventory A27 before shipping; user-added models are the user's responsibility and the app says so |

## CI and evidence strategy

- The shared workflow (`ubuntu-latest`) calls this project's `scripts/setup.sh`, `test.sh`, `demo.sh`, `verify.sh`. In the plan phase these are the honest plan-only scripts (plan lint, linter self-test, work-queue preview). **S0 replaces all four** with the real ones; the plan-only scripts fail once the phase is `BUILDING`, so CI can never pass a building project on plan checks alone.
- `setup.sh` (from S0): `npm ci` with the committed lockfile (versions resolved at build time and recorded in `docs/evidence/<slice>/versions.json`), Playwright Chromium, and download every pinned preset model **once** into the gitignored `.cache/models/`, verifying size + sha256 against `scripts/model_manifest.json` (retry transient downloads up to 6 times). `test.sh`: typecheck, lint, Vitest with `fast` (no model inference) and `slow` (real model inference) groups, Playwright e2e in Chromium; JUnit XML to `docs/evidence/<slice>/junit/host*.xml` and `chromium*.xml`. `demo.sh`: the slice's demo commands on fixtures, offline after setup. `verify.sh`: plan lint + evidence integrity.
- **CI wall-clock budget.** One project's whole CI run (setup incl. model download + `test.sh` + `demo.sh` + `verify.sh`) must stay ≤ 45 minutes on `ubuntu-latest` (4 vCPU). Measure it on the first S0 CI run and record it in `docs/status.md`. Full games, tournaments, candidate selection, puzzle sets, coach evaluation and reference-engine metrics are tagged `bench`, run on the building host only (machine specs recorded), and are excluded from CI. A `bench` result can back `PASS` only through its committed host JUnit. CI always runs every `fast` test and the D1 real-model smoke of the shipped defaults.
- **Real models in CI.** The default model for each role must fit D1. If CI cannot run a required real-model test, it fails and the slice is `BLOCKED` until the owner sets the `MONOREPO_CI_RUNNER` repository variable to a capable runner. Mocks never substitute for required model inference. Unit tests may use recorded model replies for the parser and verifier (A03, A16), clearly separated from real-model tests.
- Committed evidence (JUnit, logs, `summary.json`, model manifest, eval JSON, sample PGNs) comes from the building host's own real run; CI re-runs the suite independently. Each slice's `summary.json` records a `source_digest` over `src/`, `tests/`, `fixtures/`, the lockfile and config; `scripts/verify_evidence.py` (created in S0) enforces it for the current slice and that every `PASS` is backed by a passing JUnit testcase.
- Never commit model weights, reference-engine binaries, build output, `node_modules`, per-flow videos or machine-specific paths. The only committed video is the ≤ 15 MB demo in `docs/demo/`.

## Autonomy and merge policy

- The building agent runs without routine questions: decide, record the decision in the ledger or the slice issue, continue.
- It may merge its own PR (squash, via its runner doc's command) only when: `monorepo / verify` passed on the PR head; `bash scripts/verify.sh` and the full local suite passed on the same tree with committed evidence whose `source_digest` matches; the diff contains only in-scope files; nothing is `BLOCKED`. Then verify GitHub reports `MERGED`, `git checkout main && git pull --ff-only`, record the merge SHA in the **next** slice's status update, and continue.
- Never push to `main`, force-push, bypass checks, change repo/org settings, edit `.github/`, spend money (no paid API tiers), publish, deploy, or install anything outside D-table "Installs".
- Stop and report `BLOCKED` (do not improvise) when: preflight finds a missing prerequisite; a test fails for reasons not fixable within the slice after 3 genuine attempts; CI fails after 3 attempts; RAM/disk runs out for a required step (report the numbers); a required step would need a weakened/skipped/faked test or an invented number; a data source's license forbids the planned use; the plan's premise is contradicted by measurement (post the finding first, then `needs-decision` with options).
- After each merged PR report: slice, branch, PR URL, commands with exit codes, evidence paths, per-acceptance-ID status, model manifest changes, merge SHA from GitHub, limitations, next slice.
