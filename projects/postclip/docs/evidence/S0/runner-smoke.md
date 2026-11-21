# Runner smoke — Hermes on openclawlaunch (Linux container), first session

Recorded per `AGENTS.md` "Read first" step 4 (first session; this file did not
exist). All results below were produced by the commands shown, on this machine,
in this session. Machine facts and tool versions are recorded again in
`docs/evidence/S0/versions.json` for the slice itself.

## Machine

- OS: Debian GNU/Linux 13 (trixie), x86_64 (Linux 6.8.0-147-generic)
- 16 vCPU, 62 GiB RAM, 39 GB free disk at session start
- Login `hermes` (uid 10000) with passwordless sudo

## Toolchain (real versions)

- node v26.12.1, npm 12.0.2 (`.nvmrc` pins 26.12.1)
- python3 3.14.9, git 2.47.3
- ffmpeg n9.0.1-11-ge47273f4d9-20260831
- Playwright 1.65.1; browsers installed to a writable path
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright`):
  chromium-1255 + chromium_headless_shell-1255, webkit-2388, ffmpeg-1013
  (the preinstalled `/opt/hermes/tools` browsers path is read-only to this user
  and Playwright could not lock it; the redirect was required and works)

## Checks run, with results

1. `bash scripts/preflight.sh build` — **OK**: python3, OS, node, npm, git,
   disk ≥ 15 GB, network reachability (registry.npmjs.org, huggingface.co,
   cdn.playwright.dev) all green; RAM/ffmpeg/Playwright info items PRESENT.
2. Playwright launches both engines headless — **PASS**: proven by the S0 e2e
   run itself (a01 passes in chromium and webkit against `vite preview` of the
   built dist/).
3. `ffmpeg -version` — present, version above.
4. GitHub mechanics (hermes.md): `gh` (at `/opt/data/.local/bin/gh`,
   authenticated as `atina-autobot[bot]`) — issue comment posted live
   (https://github.com/gokuljeyapaul/smll/issues/53#issuecomment-7061303459),
   check-runs read via `gh api` (b64b668 `verify` = success), branch push OK.
   PR creation/merge: **exercised by the S0 slice PR itself** (this runner doc
   does not mandate a separate throwaway PR; per the repository PR template and
   the owner's standing instruction, the owner merges — `READY_FOR_MERGE` flow).
5. Clipboard capabilities (probed; matters for A03/UC03):
   - Chromium: `writeText`/`readText` work when the context grants
     `clipboard-read`/`clipboard-write` (granted in `playwright.config.ts`).
   - WebKit: Playwright's WebKit has **no grantable clipboard permissions**
     (its permission map covers geolocation/notifications/etc. only —
     `clipboard-write` and `clipboard-sanitized-write` are rejected as unknown);
     `writeText` succeeds without any permission; `readText` is platform-denied.
     Verified workaround (no app changes): a **real paste round-trip** —
     writeText, then focus a probe textarea and press Ctrl/Cmd+V — returns the
     exact clipboard content in both engines. The uc01 spec uses this for WebKit.
   - npm 12 blocked two postinstall scripts (`tesseract.js`, `protobufjs` — both
     cosmetic banners); both were denied via `npm install-scripts deny`, which
     is recorded in package.json for reproducibility.

## Limits found

- WebKit-on-Linux is not iOS Safari (plan risk table); stated, not a smoke item.
- Vision/image analysis is unavailable on this instance's model endpoint, so
  fixture screenshots were never "eyeballed" by the agent; their legibility is
  proven the honest way — by the real OCR bench numbers (A20) and the manifest
  lint (A31), and by the owner's own eyes in the O01 gallery.
