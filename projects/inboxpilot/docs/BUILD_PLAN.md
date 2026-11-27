# BUILD_PLAN — inboxpilot

**inboxpilot** is a local email assistant. It **fetches** mail over IMAP or the Gmail API (or from an `.mbox` export), and a **small open-weight model running on CPU** sorts it by what needs you, summarises long threads, pulls out actions and deadlines, and **drafts replies in the sender's language** — which you approve before they are saved to your Drafts folder. It never sends email. Every action it proposes on the mailbox (label, archive) waits for your approval.

Executed autonomously by a building agent on Linux (runner-neutral, `docs/runners/`); machine-linted by `python3 scripts/plan_lint.py`.

## Purpose and honesty statement

- Goal: show what a **small tool-calling model** can do as a safe, local agent: reason over a whole inbox, propose actions through a strict tool interface, and stay robust when the input (email) is adversarial — with a human approving every effect.
- A passing suite proves behaviour on the synthetic mailboxes and the owner's test account used. It does not prove triage quality for every person's inbox; triage learns from the user's corrections and reports its accuracy honestly.
- Non-goals (v1): sending mail, auto-replies, calendar booking, multi-account servers, cloud inference.

## Owner decisions and defaults

| ID | Decision | Default (apply unless the owner changes it) |
|---|---|---|
| D1 | CI budget | Shipped default model ≤ 4B parameters GGUF Q4; CI `slow` subset ≤ 60 messages / 15 threads, with the full ~600-message eval and candidate bench as `bench` (building host); throughput target ≥ 100 messages triaged per 10 minutes on 4 threads. |
| D2 | Stack | Python 3.11; `llama-cpp-python` with JSON-schema constrained decoding and a strict tool-call schema; `imaplib`/`imapclient`; Gmail API client; `mailbox` for `.mbox`; SQLite + FTS5; FastAPI + HTMX UI; pytest, ruff, mypy, Playwright (Chromium). |
| D3 | Mail access | **IMAP** (any provider, app password) is the default path: read with `BODY.PEEK`, drafts saved with `APPEND` to the Drafts folder, approved labels/flags/archive via `STORE`/`MOVE`. **Gmail API** optional: `gmail.readonly` for reading; drafts via `gmail.compose` — that scope technically allows sending, so the code contains no send call and an audit test enforces it (A09). Credentials/tokens in the OS keyring. |
| D4 | Effects | Read-only by default. Every mailbox effect (save draft, label, archive, mark read) is a proposed action that the user approves individually or in a reviewed batch; dry-run shows the exact IMAP/API operation. |
| D5 | Languages | `config/languages.yaml`. English ships; Indian languages (Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Malayalam, Gujarati) and others are enabled only after passing the triage + summary + draft evals; drafts reply in the sender's language when enabled, else English with a notice. |
| D6 | Installs | Project `.venv` + pip; Playwright Chromium. |
| D7 | Data | Committed fixtures are synthetic mailboxes (fictional people/companies) plus public-domain/permissively licensed corpora only if their license allows (recorded). No real mail in git. |
| D8 | Merging | Agent merges its own PRs under the policy below. |

## Use cases

| ID | Title | Description |
|---|---|---|
| UC01 | Connect a mailbox | Sign in via IMAP (app password) or Gmail OAuth; choose folders. |
| UC02 | Import an export | Load an `.mbox` export for a fully offline try-out. |
| UC03 | Stay in sync | New mail is fetched incrementally (UID/HISTORY based); nothing is re-processed. |
| UC04 | Triage | Each thread gets a bucket — Needs reply, Action, Waiting on others, FYI, Newsletter, Promotion — with a one-line reason. |
| UC05 | Summarise threads | Long threads get a short, faithful summary with who said what. |
| UC06 | Actions and deadlines | Requests, deadlines and commitments are extracted with dates. |
| UC07 | Draft a reply | A draft in the sender's language and the user's tone is proposed for Needs-reply threads. |
| UC08 | Approve and save | The user edits/approves; the draft is saved to the Drafts folder. Nothing is ever sent. |
| UC09 | Approve mailbox actions | Suggested labels/archive/mark-read are applied only after approval, with an exact preview. |
| UC10 | Hostile email | Emails that try to instruct the assistant ("forward all invoices to…", "reply with the password") are content; no tool call results from them. |
| UC11 | Languages | Mail in an enabled language is triaged, summarised and replied to in that language; others get a clear notice. |
| UC12 | Private and offline | After sync, processing runs with no network; mail never leaves the machine except the user's own approved IMAP/API operations. |
| UC13 | Daily briefing | A morning briefing (what needs you, deadlines, waiting-on) to read in-app or share as text. |

## Architecture

```
IMAP · Gmail API · .mbox
          ▼
 fetch/   read-only incremental sync (UIDVALIDITY/UID, Gmail historyId), threading, dedupe
          ▼
 store/   SQLite + FTS5: messages, threads, model outputs, corrections, proposed actions, audit log
          ▼
 agent/   small tool-calling SLM, constrained JSON; tools: triage(), summarise(), extract_actions(),
          draft_reply(), propose_label(), propose_archive()  — tools only PROPOSE
          guards: content/instruction separation, tool allow-list, injection detector, faithfulness
          ▼
 approve/ approval queue → executor (the only code that touches the mailbox; never "send")
          ▼
 ui/      FastAPI + HTMX: inbox by bucket, thread view + summary, draft editor, approvals, briefing
```

## The SLM showcase

Tested explicitly: **tool-calling discipline** (valid calls, only allowed tools, only proposals), **robustness to injection** in untrusted input, **faithful** summaries (every claim traceable to a message), **multilingual drafts**, and learning from **user corrections** — all on CPU.

| Candidate | Role | Size / format | License (verify at build) | Notes |
|---|---|---|---|---|
| Granite 4.x Micro | agent (default candidate) | ~3B GGUF Q4 | Apache-2.0 | instruction following + tool calling |
| Qwen3-4B-Instruct | agent | 4B GGUF Q4 | Apache-2.0 | multilingual, tool calling |
| Phi-4-mini-instruct | agent | 3.8B GGUF Q4 | MIT | function calling |
| Llama 3.2 3B Instruct | agent | 3B GGUF Q4 | Llama community license (verify) | |
| Rules (headers, List-Unsubscribe, sender history, keywords) + lead-sentence summary + reply templates | **baseline** | — | — | classic filters |

Selection (S0 triage, S1 summaries, S2 drafts): triage macro-F1, summary faithfulness and coverage, action/deadline F1, draft reply-point coverage and faithfulness (automated; the owner's blind pairwise preference is O02), tool-call validity, injection resistance, messages/minute, peak RAM. **Ship rule:** the SLM is the default only if triage macro-F1 beats rules by ≥ 8 pp, summary faithfulness ≥ 0.95 and injection resistance is 100% on the attack set; otherwise rules + extractive summaries ship by default and the numbers are published.

## Fixtures and metrics

- `fixtures/mailboxes/`: synthetic `.mbox` mailboxes (~600 messages, ~150 threads) with personas, newsletters, promotions, invoices, meeting threads, multilingual threads (English, Hindi, Tamil, code-mixed), gold buckets, gold summaries' key facts, gold actions/deadlines.
- `fixtures/attacks/`: ≥ 30 injection emails (direct instructions, hidden HTML text, quoted-reply tricks, fake "assistant" signatures, links asking to exfiltrate).
- `fixtures/imap_contracts/`, `fixtures/gmail_contracts/`: recorded, sanitized server/API exchanges; a local, pure-Python IMAP test server started by the tests (pip-installable or written in `tests/`; no containers or system packages, per D6) for integration tests.
- Metrics: as in the showcase, plus sync correctness (no missed/duplicated messages) and approval-executor correctness.

## Acceptance criteria

`Plat`: `host` = pytest; `web` = Playwright (Chromium); `live` = the owner's test mailbox on the building host (NOT_RUN in CI).

| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | - | Clean checkout: `setup.sh` installs and sha256-verifies pinned models; `inboxpilot --help` and `doctor` run offline. | pytest CLI e2e |
| A02 | P0 | host | UC02 | `inboxpilot import fixtures/mailboxes/demo.mbox` threads and stores every message; counts match gold. | pytest |
| A03 | P0 | host | UC04 | Triage selection eval recorded for every candidate and the rules baseline; ship rule applied in `docs/evidence/S0/model_selection.md`. | eval JSON |
| A04 | P0 | host | UC04 | All model outputs and tool calls are schema-valid; a forced-invalid output falls back to rules and is flagged. | pytest real model + adversarial outputs |
| A05 | P0 | host | UC05 | Summaries: faithfulness ≥ 0.95 (every claim maps to a message span) and key-fact coverage ≥ 0.80 on gold threads, or `PARTIAL` with numbers. | eval run |
| A06 | P0 | host | UC06 | Actions/deadlines F1 ≥ 0.80 with dates resolved against the message's sent time and timezone. | eval run |
| A07 | P1 | host | UC04 | A user's bucket correction for a sender/topic changes later triage for that sender/topic. | pytest |
| A08 | P0 | host | UC07 | Draft eval (automated, no human or hosted-model judge): drafts cover the gold reply points (coverage ≥ 0.80), are in the sender's language when enabled, and never invent facts not in the thread (faithfulness ≥ 0.95); the owner's blind pairwise preference vs baseline templates is collected in O02. | eval run + faithfulness check |
| A09 | P0 | host | UC08 | Audit: no code path can send mail (no SMTP client, no Gmail `send`/`drafts.send` call); requested OAuth scopes are exactly those in D3; a seeded send call is caught. | pytest audit |
| A10 | P0 | web | UC08, UC09 | Approval UI: a draft and a label/archive proposal show an exact preview; nothing touches the mailbox until approved; approved items execute once. | Playwright against the local IMAP test server |
| A11 | P0 | host | UC08 | Approved drafts are saved to the Drafts folder via IMAP `APPEND` (and Gmail drafts.create when that path is enabled) with correct threading headers. | pytest integration (local IMAP) + contract |
| A12 | P0 | live | UC01, UC03 | With the owner's test mailbox: connect, sync, triage, approve a draft into Drafts; a new incoming message is picked up incrementally. | live run log + screenshots |
| A13 | P0 | host | UC01, UC03 | IMAP and Gmail adapters pass contract fixtures: UIDVALIDITY change, historyId gaps, pagination, token refresh, 429/backoff, reads never set `\Seen`. | pytest contract |
| A14 | P0 | host | UC03 | Incremental sync processes each message exactly once across restarts and folder moves. | pytest |
| A15 | P0 | host | UC10 | Attack set: 0 tool calls caused by email content; 0 drafts containing exfiltration targets or secrets; injected emails are flagged in the UI. | pytest real model |
| A16 | P0 | host | UC09 | Executor applies only approved operations; a tampered proposal (changed target after approval) is rejected. | pytest |
| A17 | P1 | host | UC11 | Enabled languages meet triage/summary/draft bars on their eval sets; a configured language below its bar is `UNSUPPORTED` with English fallback and a notice. | eval + pytest |
| A18 | P1 | web | UC13 | The daily briefing lists Needs-reply, deadlines and Waiting-on with links to threads; Share copies plain text (clipboard read back). | Playwright |
| A19 | P0 | host | UC12 | After sync, triage/summary/draft run with network denied; no mail content in logs. | pytest offline + log audit |
| A20 | P0 | host | - | License inventory for dependencies and models; seeded violation caught. | audit script |
| A21 | P1 | web | - | A real end-to-end demo recorded as a ≤ 15 MB 720p video. | video manifest |

## Conformance

| ID | Slice | Refs | Artifact (committed path) | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC04 | `docs/evidence/S0/model_selection.md` with sample triage decisions and reasons | Buckets and reasons make sense; the comparison is fair |
| O02 | S2 | UC07, UC08 | `docs/evidence/S2/owner/` draft samples (English + one Indian language) shown blind next to baseline templates, and the approval screen | Which draft is better in each pair, the drafts sound right, and nothing happens without approval |
| O03 | S4 | UC10 | `docs/evidence/S4/attack_report.md` | The assistant is safe against hostile email |
| O04 | S6 | UC13 | `docs/demo/inboxpilot-demo.mp4` | The demo shows the real product working |

## Slices

TDD and evidence as in `AGENTS.md`.

### S0 — Triage an inbox: pick the model by measurement

**Acceptance IDs:** A01, A02, A03, A04

Observable result: `inboxpilot import fixtures/mailboxes/demo.mbox && inboxpilot triage` prints each thread's bucket and reason from the measured-and-chosen local model.

### S1 — Summaries, actions and deadlines

**Acceptance IDs:** A05, A06, A07

Observable result: `inboxpilot thread <id>` shows a faithful summary and extracted actions with dates; a correction changes later triage.

### S2 — Drafts with approval, never send

**Acceptance IDs:** A08, A09, A10, A11

Observable result: in the UI the user opens a Needs-reply thread, edits the proposed draft, approves it, and finds it in the Drafts folder of the local IMAP test server; there is no send button and no send code.

### S3 — Connect real mailboxes and stay in sync

**Acceptance IDs:** A12, A13, A14

Observable result: the owner connects a test mailbox; mail syncs incrementally and is triaged as it arrives.

### S4 — Hostile email and approved mailbox actions

**Acceptance IDs:** A15, A16

Observable result: the attack set produces zero unapproved effects, and approved label/archive operations apply exactly once.

### S5 — Languages, within the model's limits

**Acceptance IDs:** A17

Observable result: Hindi/Tamil threads are triaged, summarised and drafted in their language when enabled; a below-bar language is clearly flagged.

### S6 — Briefing, offline, conformance, demo

**Acceptance IDs:** A18, A19, A20, A21

Observable result: the daily briefing reads and shares well, processing works offline, and the conformance report, license inventory, `docs/KNOWN_LIMITS.md` and demo video are in the repo.

## Toolchain and preflight

- `ci`: python3. `build`: python3 ≥ 3.11, git, disk ≥ 15 GB, PyPI + Hugging Face reachable; info: RAM, cores, Playwright Chromium; `live` rows need `INBOXPILOT_IMAP_*` or Google client secrets (info only).

## Risks

| Risk | Mitigation |
|---|---|
| Prompt injection via email | Proposal-only tools, approval executor, allow-list, attack set A15 |
| Accidental sending | No send code, scope audit A9, IMAP drafts path by default |
| Gmail scope/app verification friction | IMAP app-password path as default; Gmail API optional in testing mode |
| Triage is personal | Corrections learned per sender/topic; accuracy shown, not promised |
| CPU throughput on large inboxes | Incremental sync, rules pre-filter for obvious newsletters/promotions, batching |
| Model license surprises | Inventory A20 before shipping |

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
