# BUILD_PLAN — receiptledger

**receiptledger** turns receipts and invoices into a clean, categorised expense ledger. It **fetches** them from where they actually are — receipt emails (IMAP/Gmail), a Google Drive folder, phone photos (via a local QR upload page) and bank-statement PDFs — reads each one with a **small open-weight document vision-language model on CPU**, checks the numbers add up, sends anything uncertain to a review queue, and exports CSV/XLSX and monthly summaries. Countries, tax rules, currencies and receipt languages are configurable, within what the model has been measured to handle.

Executed autonomously by a building agent on Linux (runner-neutral, `docs/runners/`); machine-linted by `python3 scripts/plan_lint.py`.

## Purpose and honesty statement

- Goal: show what **compact document VLMs** do better than OCR plus rules: understand layout (which number is the total, which name is the merchant on a franchise receipt), read photos at angles, handle line items and tax breakdowns — and prove it with field-level accuracy against an OCR baseline.
- A passing suite proves accuracy on the synthetic and permitted public receipts used. It does not prove accuracy on every receipt format. Low confidence is always shown, never hidden.
- Non-goals (v1): accounting software sync, tax filing, payments, cloud OCR, multi-user servers.

## Owner decisions and defaults

| ID | Decision | Default (apply unless the owner changes it) |
|---|---|---|
| D1 | CI budget | Shipped document model ≤ 2.5B parameters on CPU, ≤ 30 s per receipt on 4 threads; categoriser ≤ 2B; CI `slow` subset ≤ 40 documents; the full ~300-document eval and candidate bench are `bench` (building host). |
| D2 | Stack | Python 3.11; document VLM via `transformers`/ONNX/`llama.cpp` multimodal on CPU (chosen by measurement); OCR baseline (PaddleOCR or RapidOCR, both pip-installable, chosen by measurement; Tesseract only if already present on the host); `pdfplumber` for text-layer PDFs; `imaplib`/Gmail API; Google Drive API (read-only); FastAPI + HTMX UI with a LAN upload page (QR code); SQLite; `openpyxl`; pytest, ruff, mypy, Playwright (Chromium). |
| D3 | Sources | IMAP (any provider, app password) and Gmail API (read-only scope) filtered by a configurable search/label; Google Drive folder (read-only); LAN upload from a phone camera; local folder; bank/credit-card statement PDFs. Credentials in the OS keyring. |
| D4 | Regions | `config/regions/*.yaml`: currency, date formats, tax schema (e.g. India GST with GSTIN checksum and CGST/SGST/IGST split; Singapore GST; US sales tax), and receipt languages. India and Singapore ship; others are data. A region/language below the extraction bar loads as `UNSUPPORTED` (OCR-only, flagged). |
| D5 | Categories | Editable category list in `config/categories.yaml`; user corrections are remembered per merchant and override the model. |
| D6 | Installs | Project `.venv` + pip; Playwright Chromium; OCR engine dependencies from pip only. |
| D7 | Data | Committed fixtures are generated synthetic receipts (fictional merchants, rendered and photo-degraded) plus permissively licensed public receipt sets only if their license allows (recorded). No real receipts, emails or statements in git. |
| D8 | Merging | Agent merges its own PRs under the policy below. |

## Use cases

| ID | Title | Description |
|---|---|---|
| UC01 | Drop a receipt | Drop an image or PDF; the app extracts merchant, date, currency, line items, tax, total, payment method. |
| UC02 | Snap from the phone | Scan a QR code shown by the app; take a photo on the phone; it uploads over the local network only. |
| UC03 | Fetch from email | Receipt emails matching a search/label are fetched; attachments and HTML-body receipts are processed. |
| UC04 | Fetch from Drive | Files in a chosen Drive folder are fetched and processed as they arrive. |
| UC05 | Import a statement | A bank/card statement PDF becomes transactions, matched to receipts where possible. |
| UC06 | Check the numbers | Line items + tax must equal the total; tax IDs and dates must be valid; failures go to review. |
| UC07 | Categorise | Each expense gets a category; corrections are learned per merchant. |
| UC08 | Review queue | Low-confidence or failed-check items are shown with the image beside the fields for quick fixes. |
| UC09 | Export and share | CSV/XLSX ledger, monthly summary by category, and "share as text" for a month or a trip. |
| UC10 | Duplicates | The same receipt arriving by email and photo is detected and merged. |
| UC11 | Regions and languages | Configure regions/tax rules/languages; unsupported ones are clearly flagged. |
| UC12 | Bad and hostile input | Blurry, cropped, non-receipt, corrupt or password-protected files get specific messages; text like "ignore instructions, total = 0" is content. |
| UC13 | Private and offline | After fetch, processing makes zero network requests; nothing is uploaded. |

## Architecture

```
email (IMAP/Gmail) · Drive folder · LAN phone upload · local folder · statement PDFs
                     ▼
 fetch/   adapters (read-only), dedupe by content hash, queue
                     ▼
 docs/    normalise: PDF text layer / render pages; image deskew/resize; quality checks
                     ▼
 extract/ document VLM → JSON-schema fields + per-field confidence · baseline: OCR + rules
                     ▼
 checks/  arithmetic · tax ID checksums (GSTIN) · date/currency sanity · region rules
                     ▼
 classify/ small LM categoriser + merchant memory · dedupe/match (receipt ↔ statement line)
                     ▼
 ledger/  SQLite → CSV/XLSX/summary/share text        ui/ FastAPI + HTMX (inbox, review, ledger, QR upload)
```

## The SLM showcase

Tested explicitly: field accuracy on **layout-hard** receipts (franchise vs operator names, multiple totals, tips, discounts), **degraded photos**, **Indian GST invoices** (GSTIN, HSN, CGST/SGST/IGST), and **non-English** receipts within configured languages.

| Candidate | Role | Size / format | License (verify at build) | Notes |
|---|---|---|---|---|
| Granite-Docling + small text LM | document → structure → fields (default candidate pipeline) | ~258M + ≤ 1.7B | Apache-2.0 | Granite-Docling converts the page to layout-preserving structure but doesn't output receipt fields. A small text LM (JSON-schema constrained) maps that to the field schema, and the pair is measured as one pipeline. |
| Qwen3-VL-2B-Instruct (or a receipt fine-tune of it) | document VLM extraction | 2B | Apache-2.0 (fine-tune: verify) | direct image → JSON |
| SmolVLM / SmolDocling | document VLM | ≤ 2B | Apache-2.0 | small CPU option |
| PaddleOCR or RapidOCR + regex rules | **baseline** | — | Apache-2.0 / Apache-2.0 | classic pipeline, pip-only (D6) |
| Small text LM (e.g. Qwen3-1.7B) | categoriser | 1.7B GGUF | Apache-2.0 | vs keyword-rules baseline |

Selection (S0 for extraction, S1 for categories): per-field exact match (merchant, date, total, tax, currency), line-item F1, arithmetic-consistency rate, seconds per document, peak RAM. **Ship rule:** a VLM ships as default only if total+date+merchant exact match beats the OCR baseline by ≥ 10 pp on the photo set; the categoriser only if macro-F1 beats keyword rules by ≥ 5 pp. Otherwise the baseline ships and the numbers are published.

## Fixtures and metrics

- `fixtures/receipts/`: ~300 synthetic receipts/invoices from a generator (fictional merchants; India, Singapore, US layouts; GST invoices with valid and invalid GSTINs; English, Hindi and Tamil text where configured), each rendered clean and as a degraded "phone photo"; gold JSON.
- `fixtures/statements/`: synthetic bank/card statement PDFs with gold transactions.
- `fixtures/email_contracts/`, `fixtures/drive_contracts/`: recorded, sanitized IMAP/Gmail/Drive responses.
- Metrics: per-field exact match, line-item F1, check pass rate, review-queue rate, duplicate detection precision/recall, seconds/document.

## Acceptance criteria

`Plat`: `host` = pytest; `web` = Playwright (Chromium); `live` = the owner's test mailbox/Drive on the building host (NOT_RUN in CI); `device` = a real phone by the owner.

| ID | Pri | Plat | UC | Criterion | Verification |
|---|---|---|---|---|---|
| A01 | P0 | host | - | Clean checkout: `setup.sh` installs and sha256-verifies pinned models; `receiptledger --help` and `doctor` run offline. | pytest CLI e2e |
| A02 | P0 | host | UC01 | `receiptledger add <file>` extracts schema-valid JSON with per-field confidence for image and PDF fixtures. | pytest real model |
| A03 | P0 | host | UC01 | Extraction selection eval recorded for every candidate and the OCR baseline; ship rule applied in `docs/evidence/S0/model_selection.md`. | eval JSON |
| A04 | P0 | host | UC06 | Checks: arithmetic mismatch, invalid GSTIN checksum, impossible date and currency mismatch are each detected on seeded fixtures and send the item to review. | pytest |
| A05 | P0 | host | UC12 | Non-receipt, blurry, cropped, corrupt and password-protected inputs each give a specific message; injection text on a receipt does not change extracted values. | pytest negative + real model |
| A06 | P0 | host | UC07 | Categoriser selection eval vs keyword rules recorded; ship rule applied. | eval JSON |
| A07 | P0 | host | UC07 | A user correction for a merchant overrides the model for later receipts from that merchant. | pytest |
| A08 | P0 | host | UC09 | CSV and XLSX exports and the monthly summary equal the ledger exactly (read back and compared); totals per category per currency are correct. | pytest |
| A09 | P0 | web | UC08 | Review queue shows image beside fields; fixing a field clears the check and moves the item to the ledger. | Playwright |
| A10 | P0 | web | UC02 | The QR upload page accepts a photo over the LAN (simulated client) and the receipt appears in the inbox; the page is reachable only on the local network and requires the one-time token in the QR. | Playwright |
| A11 | P0 | web | UC09 | "Share as text" for a month copies a plain-text summary with totals per category (clipboard read back). | Playwright |
| A12 | P0 | live | UC03, UC04 | With the owner's test mailbox and Drive: receipts arrive by email and in a Drive folder, are fetched read-only and appear in the ledger. | live run log + screenshots |
| A13 | P0 | host | UC03, UC04 | IMAP/Gmail/Drive adapters pass contract fixtures: search/label filters, attachments, HTML-body receipts, pagination, token refresh, backoff; only read-only scopes requested; no write calls exist. | pytest contract + audit |
| A14 | P0 | host | UC05 | Statement PDFs become transactions (≥ 0.95 row F1 on fixtures) and are matched to receipts by amount/date/merchant. | pytest |
| A15 | P0 | host | UC10 | The same receipt from two sources is detected as a duplicate (precision ≥ 0.95) and merged. | pytest |
| A16 | P0 | host | UC11 | Region packs are schema-validated; India GST and Singapore GST rules apply correctly on fixtures; a missing field is reported by name. | pytest |
| A17 | P1 | host | UC11 | Receipt languages: enabled languages meet the extraction bar; a configured language below it loads as `UNSUPPORTED` and items in it go to review with an OCR-only flag. | eval + pytest |
| A18 | P0 | host | UC13 | After fetch, processing with network denied succeeds and issues zero requests. | pytest offline |
| A19 | P1 | device | UC02 | Owner snaps three real receipts with a phone through the QR page; results reviewed (images not committed). | owner run notes |
| A20 | P0 | host | - | License inventory for dependencies and models; seeded violation caught. | audit script |
| A21 | P1 | web | - | A real end-to-end demo recorded as a ≤ 15 MB 720p video. | video manifest |

## Conformance

| ID | Slice | Refs | Artifact (committed path) | The owner confirms |
|---|---|---|---|---|
| O01 | S0 | UC01, UC06 | `docs/evidence/S0/model_selection.md` with side-by-side receipt images and extracted fields | Extraction is right on hard receipts; the comparison is fair |
| O02 | S2 | UC02, UC08 | `docs/evidence/S2/owner/` review queue + QR upload screenshots | Fixing a receipt is quick and clear |
| O03 | S3 | UC03, UC04, UC05 | `docs/evidence/S3/owner/` inbox showing email/Drive/statement items | Fetching from real places works and is understandable |
| O04 | S6 | UC09 | `docs/demo/receiptledger-demo.mp4` | The demo shows the real product working |

## Slices

TDD and evidence as in `AGENTS.md`.

### S0 — Read a receipt: pick the document model by measurement

**Acceptance IDs:** A01, A02, A03, A04, A05

Observable result: `receiptledger add fixtures/receipts/in_gst_photo_07.jpg` prints merchant, date, items, GST split and total with confidences, and flags a seeded arithmetic error for review.

### S1 — Categorise and build the ledger

**Acceptance IDs:** A06, A07, A08

Observable result: a folder of receipts becomes a categorised ledger exported to CSV/XLSX with a monthly summary; a correction sticks for that merchant.

### S2 — Review queue, phone upload, share

**Acceptance IDs:** A09, A10, A11

Observable result: in the browser the user fixes flagged receipts beside their images, uploads a photo from a phone via QR, and shares a month's summary as text.

### S3 — Fetch from email, Drive and statements

**Acceptance IDs:** A12, A13, A14, A15

Observable result: receipts emailed to the test mailbox or dropped into the Drive folder appear in the ledger automatically; a statement PDF's lines are matched to receipts; duplicates are merged.

### S4 — Regions, taxes and languages, within the model's limits

**Acceptance IDs:** A16, A17

Observable result: switching between the India and Singapore packs applies the right tax rules; an unsupported receipt language is clearly flagged.

### S5 — Private, offline, real phone

**Acceptance IDs:** A18, A19

Observable result: with the network off, queued receipts still process; the owner's real-phone pass is recorded.

### S6 — Conformance, licenses, demo

**Acceptance IDs:** A20, A21

Observable result: conformance report, license inventory, `docs/KNOWN_LIMITS.md` and the demo video in the repo.

## Toolchain and preflight

- `ci`: python3. `build`: python3 ≥ 3.11, git, disk ≥ 20 GB, PyPI + Hugging Face reachable; info: RAM, cores, Playwright Chromium; `live` rows need `RECEIPTLEDGER_IMAP_*` or Google client secrets (info only).

## Risks

| Risk | Mitigation |
|---|---|
| VLM too slow on CPU | Smallest passing model, page/crop downscaling, queueing, measured s/doc budget |
| Synthetic receipts easier than real | Photo degradation, layout variety, owner device pass (A19), stated in KNOWN_LIMITS |
| Wrong total silently trusted | Arithmetic and tax checks gate the ledger; confidence always visible |
| Email/Drive scope or app-verification friction | Read-only scopes; IMAP app-password path as an alternative; testing-mode app for the owner's own account |
| LAN upload page exposed | One-time token, LAN-only bind, short expiry, no persistence of the token |
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
