# AGENTS.md — postclip-builder

This project is a **plan-only stub**. Do **not** implement anything here until the owner replaces `docs/BUILD_PLAN.md` with a full plan and sets `milestone-status.json` phase to `BUILDING`.

- Read the monorepo-root `AGENTS.md`, this file, `README.md`, `docs/BUILD_PLAN.md`, `docs/status.md` first.
- Do not modify `projects/postclip`; consume only a pinned build of it (by commit/tag and a recorded hash of `dist/`).
- Building this project needs a Mac with Xcode and Android Studio and, for publishing, an Apple Developer account and a Google Play developer account. Signing keys and store credentials are never committed and never handled by agents without explicit owner instruction.
- No publishing, TestFlight/Play uploads, tags or releases without explicit owner confirmation.
- Honest statuses only (`PASS | PARTIAL | NOT_RUN | BLOCKED`); never claim store acceptance, device tests, or anything not actually run.
