<!--
PR template for the smll monorepo. One functional slice = one PR.
Replace every <placeholder>. Never claim an unexecuted check passed; use
NOT_RUN / BLOCKED / PARTIAL honestly. Do not write a merge SHA for this PR.
-->
## Project

<project folder name under projects/>

## Functional slice

<slice id and one-line observable result, e.g. S3, or I18-S1 — issue #18 slice 1>

Linked issue(s): <#N or "none">

## Implementation summary

- <what changed, one bullet per behavior>

## Acceptance criteria

| ID | Result (PASS / PARTIAL / NOT_RUN / BLOCKED) | Evidence |
|---|---|---|
| <ID> | <result> | `projects/<project>/docs/evidence/<slice>/<file>` |

## TDD evidence

- **RED:** `<path to red.log>` — <N failed / M passed, exit code, the behavioral assertion that failed (not an import error)>
- **GREEN:** `<path to green.log>` — <N passed, exit code>
- **E2E / demo:** `<path>` — <command, exit code>
- **Negative / privacy:** `<path>` — <N passed, exit code>
- **Regression:** `<path>` — <full-suite result, exit code>
- **Offline (if models involved):** `<path>`
- **Machine report:** `<path to summary.json>`

## Demo commands

```bash
<real commands a reviewer can run>
```

## Status and merge state

- `docs/status.md` and `milestone-status.json` updated: <yes/no>
- State: `READY_FOR_MERGE` (merge SHA is recorded in the next PR, never here)
- Merged by: owner (auto-merge is unavailable on this repository)

## Limitations

- <known limits, unassessed checks, synthetic-only caveat>
