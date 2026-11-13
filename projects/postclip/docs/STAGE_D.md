# Stage D — device verification on the owner's Mac (interactive)

Stage D (slices D0–D3) is done **together, in a Claude Code session on the owner's Mac**, after Hermes has finished Stage L (phase `DEVICE_VERIFICATION`, `docs/STAGE_D_HANDOFF.md` present). It is not an autonomous prompt: the owner approves installs and merges.

## One-time Mac setup (owner)

1. Install **Xcode** (App Store), open it once, accept the license, install an **iOS simulator runtime** (Xcode > Settings > Platforms), then `sudo xcode-select -s /Applications/Xcode.app`.
2. Install **Android Studio**; in SDK Manager install the latest SDK platform, build-tools, platform-tools, command-line tools and the emulator; create an **arm64 AVD**; set `ANDROID_HOME` and add `platform-tools` and `emulator` to `PATH`. A JDK 17 comes with Android Studio or via `brew install openjdk@17`.
3. Check with `bash projects/postclip/scripts/preflight.sh` — it must report no `MISSING`. Claude Code can then `brew install maestro ffmpeg facebook/fb/idb-companion` (the only installs plan D5 allows on the Mac) after you say go.

## The thin pass

Hermes ships `scripts/stage_d_all.sh` (see the plan's "Stage D thin pass"). The session is: install tools -> `bash scripts/stage_d_all.sh --tier 1` -> fix what breaks (D0) -> `--tier 2` time-boxed (D1) -> `--tier 3` attempts (D2) -> final conformance (D3). Tier 2/3 IDs that cannot be proven quickly end `PARTIAL`/`NOT_RUN` with reasons; that is an accepted outcome.

## How Stage D runs

1. Pull `main` (contains Stage L). Read `docs/STAGE_D_HANDOFF.md`.
2. D0 -> D1 -> D2 -> D3, one PR per slice, RED first: the authored Maestro flows run for the first time and are expected to expose selector/config/app bugs; each fix gets a failing reproduction first.
3. Every passing flow is recorded to `artifacts/video/` (never committed) and listed with sha256 in `docs/evidence/video_manifest.json`; JUnit results go to `docs/evidence/<slice>/junit/ios*.xml` and `android*.xml`.
4. Riskiest techniques are verified first and may end `PARTIAL`: iOS share extension via Photos, simulator clipboard image seeding, iOS radios-off, Telegram delivery.
5. D3 re-runs the cleanup evaluation on **real OCR text** dumped from the devices (A20), builds the compilation video, and makes `verify_evidence.py` pass with phase `COMPLETE`.

## What Stage D cannot prove

Real-phone LLM speed/RAM (A30) unless a physical device is attached; accuracy on real, non-synthetic screenshots; delivery into third-party apps that are not installed on the simulator/emulator.
