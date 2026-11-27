# BUILD_PLAN — folderchat

**folderchat** lets a person ask questions of their own documents — local folders **and Google Drive** (their own files, shared-with-me files and shared drives) — and get answers that **quote and cite the exact passage**, or say plainly "not found in your documents". Answers can be **shared as plain text with links to the source docs**. Everything after sync runs locally on CPU with a small open-weight model built for grounded, cited answering.

Executed autonomously by a building agent on Linux (runner-neutral, `docs/runners/`); machine-linted by `python3 scripts/plan_lint.py`.

## Purpose and honesty statement

- Goal: show the unique strength of **citation-native small models** — models mid-trained to answer only from supplied sources and quote them — compared with a general small model and with plain keyword search.
- A passing suite proves behaviour on the synthetic corpora and the owner's test Drive used. It does not prove accuracy on arbitrary documents. Anything not run is `NOT_RUN`.
- Non-goals (v1): editing documents, write access to Drive, multi-user server deployment, OCR of handwritten scans, cloud inference.

## Owner decisions and defaults

| ID | Decision | Default (apply unless the owner changes it) |
|---|---|---|
| D1 | CI budget | Shipped default answer model ≤ 2B parameters (GGUF Q4/Q8 or safetensors on CPU); embedding model ≤ 500M; CI `slow` answer subset ≤ 40 questions; the full ≥ 150-question eval and candidate bench are `bench` (building host). |
| D2 | Stack | Python 3.11; `llama-cpp-python` (or `transformers` CPU where the model has no GGUF); `sentence-transformers` embeddings; SQLite + FTS5 (BM25) + a local vector index (sqlite-vec or hnswlib, chosen by measurement); `pypdf`/`pdfplumber`, `python-docx`; FastAPI + HTMX UI; Google API Python client; pytest, ruff, mypy, Playwright (Chromium). |
| D3 | Google Drive | Two ways in, both **read-only**. **(a) Synced Drive folder (default, zero setup):** Google's own "Drive for desktop" app (macOS/Windows) already mirrors My Drive and Shared drives into a normal folder. folderchat offers that folder as the source "Google Drive (synced folder)", auto-detected at its default location when present (macOS `~/Library/CloudStorage/GoogleDrive-*/`, Windows the Drive for desktop drive letter) or picked by hand, and indexes it like any local folder: no OAuth, no client config, no Google Cloud project. Google Docs/Sheets/Slides appear there only as `.gdoc`/`.gsheet`/`.gslides` shortcut files without their text; they are listed with the reason "Google-native file: connect Drive directly to index its text", never indexed empty. The shortcut file's contents are treated as untrusted: only a document id or URL is read from it (to build the Drive link, D4), any account email in it is ignored and never stored. "Shared with me" files appear only if the user added a shortcut to My Drive (Drive for desktop's own rule). In streaming mode a file that isn't available locally is read on demand by the OS; if the read fails it is listed with a reason. **(b) Direct Drive connection (optional):** OAuth "installed app" flow with read-only scopes (`drive.readonly`; `drive.metadata.readonly` where enough), for Google-native file text, Shared with me without shortcuts, and machines without Drive for desktop (e.g. Linux). It needs an OAuth client config from the owner (`FOLDERCHAT_GOOGLE_CLIENT_SECRETS`); without it the UI hides the option and points to (a). Covers My Drive, Shared with me and shared drives; Google Docs/Sheets/Slides exported to text; incremental sync via the Drive Changes API; tokens in the OS keyring. If both are set up for the same files, the direct connection wins and the synced copies are not indexed twice. The app never writes to Drive either way. |
| D4 | Sharing | "Share answer" produces **plain text** (answer + numbered citations with quoted spans) **and links**: Drive `webViewLink` for directly connected Drive files and for synced Google-native shortcuts whose id is known (recipients still need Drive permission — the app says so); for other synced-folder files a readable Drive location ("Google Drive › My Drive › Policies › travel.pdf, p. 3"), since the synced folder doesn't expose the file's Drive link; and `file://` path + page for local files. Copy to clipboard and OS share sheet where available. No answer is uploaded anywhere. |
| D5 | Languages | Configurable in `config/languages.yaml`. English ships; others are enabled only after passing the answer + retrieval eval for that language; otherwise questions in it are answered with a clear `UNSUPPORTED_LANGUAGE` notice and keyword results. |
| D6 | Installs | Project `.venv` + pip; Playwright Chromium. |
| D7 | Permissions | Index only what the signed-in user can read; record each file's owner, sharing state and `capabilities.canDownload`; files that cannot be downloaded are listed but not indexed. A file removed from the user's access disappears from the index on the next sync. |
| D8 | Merging | Agent merges its own PRs under the policy below. |
| D9 | Where data lives | **Nothing is uploaded or copied.** Local files are read in place and never moved or duplicated. The app stores only its index: extracted text chunks, embeddings, file paths/Drive ids, hashes and anchors, in one SQLite database in the user's data dir (`~/.local/share/folderchat/` on Linux, the platform equivalent elsewhere; overridable with `FOLDERCHAT_DATA_DIR`). Drive files are downloaded or exported to memory or a temp file only long enough to extract text, then deleted; only their extracted text and link go into the index. "Remove folder" and "Disconnect Drive" purge every chunk, embedding and cached token for that source. |
| D10 | Phone use | The UI is mobile-first and responsive (works from 360 px wide, ≥ 44 px touch targets, no horizontal scroll). By default the server listens on localhost only. `folderchat serve --lan` opts in to phone access on the same Wi-Fi: it shows a QR code carrying a one-time token, and requests without the token are refused. It is never exposed beyond the local network. In `--lan` mode the phone can also **upload** files (UC13). The phone is a browser client: the index, the model and every source (local folders, the synced Drive folder, a direct Drive connection) live on the computer running `serve`, so the phone needs no Drive app, sign-in or model. Because `file://` links and local paths mean nothing on a phone, clicking a citation in the UI always opens the source through the server's own token-protected viewer at the cited page (Drive files with a known link also offer "Open in Drive"). Native iOS/Android apps and running the model on the phone itself are out of scope for v1. |
| D11 | Uploads from a phone | Uploaded files are the one case where the app stores a file. They are saved to `<data dir>/uploads/`, a managed folder that is indexed like any local folder and shown as the source "Phone uploads". Uploads accept only the supported formats (UC09), within the D12 limits, and need the QR token. Each upload can be deleted on its own; deleting removes the file and its index entries. |
| D12 | Limits (small-model aware) | Defaults in `config/limits.yaml`, validated by a schema; values outside the safe range are refused at startup. **Per file:** ≤ 50 MB, ≤ 500 pages, ≤ 2 M extracted characters. **Per source:** ≤ 20,000 files, with a warning above 5,000 that shows the estimated index time. **Question:** ≤ 1,000 characters. **Model context:** the prompt (instructions + question + retrieved passages) is assembled against a token budget derived from the pinned model's real context length, minus a reserved answer budget, and is never truncated mid-passage. The number of passages is cut to fit, and the answer says when only part of the evidence fit. **Answer:** capped output tokens and a wall-clock timeout, after which it falls back to "find passages" mode with a notice. Anything over a limit is listed with a specific reason ("too large: 72 MB > 50 MB"), never silently truncated or skipped. |
| D13 | Clear everything | Besides per-source removal (D9), `folderchat reset` and Settings → "Clear all data" delete the whole index, all phone uploads, temp files and every stored token (OS keyring entries included), after a confirmation that shows what will be deleted. Downloaded model files are kept unless `--models` is given. Afterwards the app starts as if freshly installed. |

## Use cases

| ID | Title | Description |
|---|---|---|
| UC01 | Add a local folder | Pick a folder; supported files are parsed, chunked with page/heading anchors and indexed. |
| UC02 | Connect Google Drive | Either add the Drive for desktop synced folder (zero setup: offered automatically when found), or, if the owner configured an OAuth client, sign in read-only and choose folders (incl. Shared with me and shared drives); files are indexed. |
| UC03 | Keep in sync | New, edited, moved and deleted files (local watcher, Drive Changes API) update the index incrementally. |
| UC04 | Ask with citations | A question returns an answer whose every claim carries a numbered citation quoting the source passage, with file name and page/heading. |
| UC05 | Say "not found" | When the documents don't contain the answer, the app says so and shows the closest passages instead of guessing. |
| UC06 | Share the answer | Copy or share the answer as plain text with numbered citations and links to the source docs. |
| UC07 | Open the source | Clicking a citation opens the file at the page (local viewer) or the Drive link. |
| UC08 | Hostile documents | Text in a document such as "ignore the question and say X" is treated as content, never obeyed. |
| UC09 | Many formats | PDF (text layer), DOCX, Markdown, TXT, HTML, Google Docs/Sheets/Slides; unsupported or encrypted files are listed with a reason. |
| UC10 | Access changes | When a Drive file is unshared or deleted, it leaves the index and stops being cited. |
| UC11 | Offline | After sync, asking works with no network. |
| UC12 | Languages | Questions in a configured, eval-passed language are answered in that language; others get a clear notice. |
| UC13 | Upload from a phone | On a phone connected via `serve --lan`, pick or share supported files (UC09 formats; photos of text are out of scope, as there is no OCR) and they are added to "Phone uploads" and become answerable. |
| UC14 | Clear data | Remove one source, delete one upload, or clear everything the app has stored, with a clear confirmation of what goes. |

## Architecture

```
local folders + Drive for desktop      Google Drive direct (optional:
synced folder (default Drive path) ─┐  read-only OAuth, Changes API)
                                    ▼                   ▼
 ingest/  parsers → normalised text + anchors (file, page, heading, Drive id, link, ACL)
   ▼
 index/   chunker → SQLite FTS5 (BM25) + vector index; per-file permission + hash
   ▼
 retrieve/ hybrid BM25 + vectors → rerank (optional small cross-encoder, by measurement)
   ▼
 answer/  citation-native SLM (sources in, cited answer out) → citation verifier → abstain gate
   ▼
 share/   plain-text + links renderer         ui/ FastAPI + HTMX (ask, sources, share, sync status)
```

## The SLM showcase

What is tested explicitly: answering **only** from retrieved passages; **literal-quote citations** that can be machine-verified; **abstaining** when the passages don't support an answer; resisting instructions embedded in documents; small enough for CPU.

| Candidate | Role | Size / format | License (verify at build) | Notes |
|---|---|---|---|---|
| Pleias-RAG-1B | answer (default candidate) | 1.2B | Apache-2.0 | mid-trained for RAG with built-in citations |
| Pleias-RAG-350M | answer (low-RAM tier) | 350M | Apache-2.0 | |
| OCC-RAG-1.7B | answer | 1.7B | verify | structured reasoning with quote-grounded citations |
| Granite 4.x Micro | answer (host bench only) | ~3B | Apache-2.0 | general small model, strong on RAG benchmarks; above the D1 limit, so it can't ship as the default |
| multilingual-e5-small / bge-small | embeddings | ~120M | MIT / verify | retrieval |
| BM25 top-passage extract | **baseline** | — | — | "keyword search + show passage" |

Selection (S0): citation precision (cited quote is a verbatim substring of the cited chunk), citation recall (claims supported), answer correctness (exact/F1 vs gold), abstention F1 on unanswerable questions, latency to first token and full answer on 4 CPU threads, peak RAM. **Ship rule:** the SLM ships as default only if citation precision ≥ 0.95, abstention F1 ≥ 0.80 and answer F1 beats the BM25 baseline by ≥ 10 pp; otherwise the app ships in "find passages" mode by default and the numbers are published.

## Fixtures and metrics

- `fixtures/corpus/`: a synthetic company handbook, project specs, meeting notes and policy PDFs/DOCX (generated, fictional), ~60 files incl. near-duplicate versions, tables, multi-page sections.
- `fixtures/qa.jsonl`: ≥ 150 questions with gold answers and gold supporting spans; ≥ 40 unanswerable; ≥ 15 injection documents/questions; multi-hop questions across two files.
- `fixtures/drive_synced/`: a synthetic folder laid out like a Drive for desktop mirror (`My Drive/`, `Shared drives/<name>/`, a shortcut-added shared file, `.gdoc`/`.gsheet`/`.gslides` shortcut files in the documented format, one with an account email field, one malformed, one zero-byte placeholder). It is built from Google's documented behaviour, not a real mirror; the README records that, and A25 is checked against a real Drive for desktop folder only as an owner-visual item (O03).
- `fixtures/drive_contracts/`: recorded, sanitized Drive API responses (files.list, changes.list, export, permissions) for contract tests.
- Retrieval: recall@k, MRR. Answering: as in the showcase. Sync: time to reflect a change, correctness of deletes.

## Acceptance criteria

`Plat`: `host` = pytest; `web` = Playwright (Chromium) against the local UI; `live` = the owner's real test Google account on the building host (NOT_RUN in CI).

| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | - | Clean checkout: `setup.sh` installs and sha256-verifies the pinned models; `folderchat --help` and `folderchat doctor` run offline. | pytest CLI e2e |
| A02 | P0 | host | UC01, UC09 | Adding the fixture folder indexes every supported file with page/heading anchors; unsupported/encrypted files are listed with reasons. | pytest |
| A03 | P0 | host | UC04 | Retrieval recall@8 ≥ 0.90 on answerable fixture questions (hybrid vs BM25-only vs vectors-only recorded). | eval run |
| A04 | P0 | host | UC04 | Answer selection eval recorded for every candidate and the baseline; ship rule applied in `docs/evidence/S0/model_selection.md`. | eval JSON |
| A05 | P0 | host | UC04 | Citation verifier: every displayed citation's quote is a verbatim substring of the cited chunk; an unverifiable citation is removed and its claim marked unsupported. | pytest real model + adversarial outputs |
| A06 | P0 | host | UC05 | Unanswerable questions return "not found" with closest passages; abstention F1 meets the bar (or `PARTIAL` with numbers). | eval run |
| A07 | P0 | host | UC08 | Injection fixtures are never obeyed; answers stay grounded in the question. | pytest real model |
| A08 | P0 | web | UC04, UC07 | In the UI, asking shows the answer streaming, numbered citations, and clicking one opens the source at the right page. | Playwright |
| A09 | P0 | web | UC06 | "Share answer" copies plain text containing the answer, quoted citations and a link per source (Drive link or file path + page); clipboard read back equals the rendered text. | Playwright |
| A10 | P1 | host | UC06 | Shared text states when recipients need Drive permission to open links; local-file links are flagged as only working on this machine. | pytest |
| A11 | P1 | live | UC02 | Direct connection (D3 b), only when the owner has provided an OAuth client config and a test account: sign-in (read-only scope), choose a folder, a shared-with-me file and a shared drive; all are indexed and answerable. | live run log + screenshots |
| A12 | P0 | host | UC02, UC09 | Drive adapter passes contract fixtures: pagination, Google Docs/Sheets/Slides export, `canDownload=false` files listed not indexed, token refresh, 403/429 backoff. | pytest contract |
| A13 | P0 | host | UC03 | Incremental sync: edits, moves, renames and new files (local watcher + Changes API fixtures) update only affected chunks; no full re-index. | pytest |
| A14 | P0 | host | UC10 | A file deleted or unshared (fixture change) is purged from the index and never cited again. | pytest |
| A15 | P0 | host | - | The app requests only read-only Drive scopes and contains no Drive write call (code + dependency audit). | pytest audit |
| A16 | P0 | host | UC11 | After sync, asking works with network denied (socket guard). | pytest offline |
| A17 | P1 | host | UC12 | Language config: an enabled language passes its eval set; a configured-but-failing language returns `UNSUPPORTED_LANGUAGE` with keyword results. | pytest + eval |
| A18 | P0 | host | - | License inventory for dependencies and models; seeded violation caught. | audit script |
| A19 | P1 | web | - | A real end-to-end demo (add folder + Drive, ask, cite, share) recorded as a ≤ 15 MB 720p video. | video manifest |
| A20 | P0 | web | UC04, UC06 | The ask → answer → open citation → share flow works at 360×800, 390×844 and 1280×800 with no horizontal overflow and ≥ 44 px touch targets. | Playwright (viewport matrix) |
| A21 | P0 | host | UC01, UC02 | Data location: after indexing, source files are byte-identical and untouched; no copy of any source file exists in the data dir or temp after indexing; the server binds to localhost by default; in `--lan` mode a request without the QR token is refused; "Remove folder"/"Disconnect Drive" leaves no chunks, embeddings or tokens for that source. | pytest |
| A22 | P0 | web | UC13 | From a phone-sized browser in `--lan` mode with the QR token, uploading a fixture PDF and DOCX adds them to "Phone uploads" and a question about them is answered with citations; deleting one upload removes the file and its chunks; an upload without the token, of an unsupported type or over the size limit is refused with a specific message. | Playwright (360×800) |
| A23 | P0 | host | UC14 | `folderchat reset` (and the UI action) leaves no index, uploads, temp files or keyring tokens behind, keeps models unless `--models` is given, and the next start behaves like a fresh install; per-source removal deletes only that source. | pytest |
| A24 | P0 | host | UC01, UC04 | Limits: each D12 limit has a boundary test (just under passes, just over is refused with the specific reason); out-of-range `limits.yaml` values are refused at startup; for every question the assembled prompt fits the pinned model's context with the answer budget reserved (asserted with the model's own tokenizer); when passages are dropped to fit, the answer says so; a timed-out answer falls back to passage mode. | pytest real model |
| A25 | P0 | host | UC02, UC03, UC10 | Synced Drive folder (D3 a) on `fixtures/drive_synced/`: auto-detection finds the default macOS/Windows locations under a fake home and offers nothing when absent; regular files under My Drive and Shared drives are indexed and answerable with the source "Google Drive (synced folder)"; Google-native shortcuts are listed with the specific reason and never indexed; a shortcut's id becomes a Drive link, its email field is never stored or shown, and a malformed shortcut is listed, not crashed on; share text uses the readable Drive location for synced files; a file that vanishes from the folder (unshared or deleted upstream) is purged on the next sync and never cited again; with a direct connection also configured, no file is indexed twice; with no OAuth client config the direct option is hidden and the synced folder is offered. | pytest |
| A26 | P0 | web | UC07, UC13 | At 390×844 in `--lan` mode, clicking a citation of a local file (and, once S2 lands, of a synced Drive file) opens it through the server's viewer at the cited page; the viewer refuses requests without the QR token and serves only files that are in the index. | Playwright (390×844) |

## Conformance

| ID | Slice | Refs | Artifact (committed path) | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC04, UC05 | `docs/evidence/S0/model_selection.md` with sample answers, citations and "not found" cases | Answers are grounded and citations really say what's claimed |
| O02 | S1 | UC06, UC07 | `docs/evidence/S1/owner/` UI screenshots at phone (390×844) and desktop size + a shared-text sample | It works well on a phone, the shared answer reads well, and the links make sense |
| O03 | S2 | UC02, UC10 | `docs/evidence/S2/owner/` synced-folder source, Google-native "connect directly" notice, sync status, unshare-then-gone screenshots (plus Drive sign-in screenshots if A11 ran), and a one-page "try it on your own Drive for desktop folder" checklist | Adding the synced Drive folder is clear, works on the owner's real Drive for desktop folder, and respects sharing |
| O04 | S5 | UC04, UC06 | `docs/demo/folderchat-demo.mp4` | The demo shows the real product working |

## Slices

TDD and evidence as in `AGENTS.md`.

### S0 — Ask a local folder, get cited answers: pick the model by measurement

**Acceptance IDs:** A01, A02, A03, A04, A05, A06, A24

Observable result: `folderchat add fixtures/corpus && folderchat ask "What is the travel reimbursement limit?"` prints a cited answer with verified quotes, and an unanswerable question prints "not found" with the closest passages.

- Scope: scaffold + real scripts, model manifest, parsers, chunker, hybrid index, candidate bench, citation verifier, abstain gate; phase → `BUILDING`.

### S1 — Local web UI and sharing

**Acceptance IDs:** A08, A09, A10, A20, A21, A22, A26

Observable result: in the browser (on the laptop, or on a phone over the same Wi-Fi via `serve --lan`) the user asks, reads streamed cited answers, opens a source at its page, and copies/shares the answer as text with links.

### S2 — Google Drive: synced folder by default, direct connection optional, respect sharing

**Acceptance IDs:** A11, A12, A13, A14, A15, A23, A25

Observable result: the user adds their Drive for desktop folder with no setup (or, where the owner configured an OAuth client, signs in read-only and picks Drive folders incl. shared ones), asks questions across local + Drive files, and an unshared file disappears from answers after sync.

- A11 is `live` and needs the owner's OAuth client config and test account; without them it is `NOT_RUN` with a note, which does not block the merge. The direct adapter is still built and proven against contract fixtures (A12–A15).

### S3 — Hostile documents and offline

**Acceptance IDs:** A07, A16

Observable result: injection documents are answered as content, and the app answers with the network off.

### S4 — Languages, configurable within the model's limits

**Acceptance IDs:** A17

Observable result: adding a language to `config/languages.yaml` either passes its eval and works, or is refused with a clear `UNSUPPORTED_LANGUAGE` notice.

### S5 — Conformance, licenses, demo

**Acceptance IDs:** A18, A19

Observable result: conformance report for every ID, license inventory, `docs/KNOWN_LIMITS.md`, and the demo video in the repo.

## Toolchain and preflight

- `ci`: python3. `build`: python3 ≥ 3.11, git, disk ≥ 15 GB, PyPI + Hugging Face reachable; info: RAM, cores, Playwright Chromium; S2 adds Google OAuth client config presence (`FOLDERCHAT_GOOGLE_CLIENT_SECRETS` path) as info, required only for `live` rows.
- Optional, for A11 only: the owner provides an OAuth "Desktop app" client config and a **test** Google account with a few synthetic files (never personal data), and signs in once on the building host (the agent never types passwords). The default synced-folder path needs neither.

## Risks

| Risk | Mitigation |
|---|---|
| Small model hallucinates beyond sources | Citation verifier strips unverifiable claims; abstain gate; ship rule falls back to passage mode |
| Retrieval misses the right chunk | Hybrid retrieval, measured chunking, recall@k bar |
| Drive OAuth app verification for restricted scopes (`drive.readonly`) | Use as an unverified app in "Testing" mode for the owner's own account. Testing-mode refresh tokens expire after 7 days, so re-sign-in must be a clear, tested path (expired token gives a "Reconnect Drive" prompt, never a crash). Documented in KNOWN_LIMITS. |
| Drive for desktop doesn't exist on Linux (the building host), and its on-disk format can change | Synced-folder support is tested on a documented-format fixture (A25) and confirmed by the owner on a real folder (O03); shortcut parsing is best-effort and fails closed (listed, never crashed on); Linux users use the direct connection. Documented in KNOWN_LIMITS. |
| Synced-folder files have no Drive link | Share text uses the readable Drive location (D4); the direct connection gives real links |
| Shared links don't open for recipients | Share text states the permission requirement (A10) |
| Large Drives / rate limits | Changes API incremental sync, backoff, per-folder selection |
| Prompt injection via documents | Content-only prompting, A07 |
| Model license surprises | Inventory A18 before shipping |

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
