# folderchat

Cited answers from your folders and Google Drive. **SLM showcase:** Grounded Q&A with verifiable citations.

Ask questions of local folders and Google Drive (incl. shared files and shared drives, read-only) and get answers that quote and cite the exact passage or say "not found"; share answers as text with links to the source docs. A citation-native small model runs locally on CPU.

**Status:** `BUILDING` — S0 delivered (see [`docs/status.md`](docs/status.md)).

| What | Where |
|---|---|
| Full plan (use cases, model candidates, acceptance IDs, slices) | [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) |
| Operating rules for the building agent | [AGENTS.md](AGENTS.md) |
| Ledger | [docs/status.md](docs/status.md) |
| Runner mechanics | [docs/runners/](docs/runners/) |

## Commands

```bash
bash scripts/setup.sh            # venv + pinned deps + pinned models (downloaded once, sha256-verified)
bash scripts/preflight.sh build   # prerequisites
bash scripts/test.sh             # ruff, mypy (strict), pytest fast+slow with JUnit
bash scripts/demo.sh             # add fixtures/corpus + ask a cited question + unanswerable -> not found
bash scripts/verify.sh           # plan lint + evidence integrity
```

Using the app:

```bash
.venv/bin/folderchat add fixtures/corpus                                   # index a folder (PDF, DOCX, MD, TXT, HTML)
.venv/bin/folderchat ask "What is the travel reimbursement limit?"        # cited answer
.venv/bin/folderchat ask "What is the CEO's favourite colour?"            # "not found" + closest passages
.venv/bin/folderchat doctor                                               # offline self-check (models verified by sha256)
```

Models are pinned by revision + sha256 in `scripts/model_manifest.json`, downloaded into the
gitignored `.cache/models/`, and never committed. The shipped default answer mode was chosen by
measurement against a BM25 baseline — see `docs/evidence/S0/model_selection.md` for the numbers.
