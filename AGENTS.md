Read the root `AGENTS.md` and the active project's `AGENTS.md`, `README.md`, `docs/BUILD_PLAN.md` and `docs/status.md`.

Implement the project using strict TDD and complete functional slices.

For every slice:

1. Write failing unit, integration and E2E tests first.
2. Capture actual RED test execution evidence.
3. Implement the functionality and make the tests pass.
4. Refactor and run regression and negative-path tests.
5. Demonstrate the complete functionality end-to-end.
6. Store sanitized execution logs, test results, reports and genuine screenshots where available under `docs/evidence/<slice>/`.
7. Update `docs/status.md` with delivered functionality, acceptance conformance, evidence links, limitations and the next slice.
8. Update the machine-readable milestone status.
9. Deliver the checkpoint and automatically continue to the next slice.

Do not pause for routine approvals between passing slices.

If mandatory verification fails, remediate it before advancing. Report genuine blockers rather than silently skipping checks.

Continue until all defined slices are implemented and verified, subject to the available execution environment and existing security permissions.

Do not claim privacy compliance or completed validation without actual evidence.
