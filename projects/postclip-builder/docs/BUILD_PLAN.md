# BUILD_PLAN — postclip-builder (STUB — not yet planned in depth)

**Status: stub.** This records direction and constraints agreed so far. A full plan (use cases, acceptance IDs, slices, test strategy) is written after `postclip` is `COMPLETE`.

## Purpose

Wrap a pinned, **bundled** build of the `postclip` web app (Capacitor; assets packaged inside the app, never a live remote URL) into installable iOS and Android apps suitable for the App Store and Google Play.

## Why a separate project

- `postclip` must stand alone as a web app/PWA and be fully testable on Linux.
- Native work needs a Mac (Xcode), signing credentials, store accounts and device testing — a different toolchain, risk profile and review process.
- The native UX must be minimal and non-invasive: the app exists mainly to receive a screenshot from the OS share sheet and return clean text.

## Direction (to be confirmed in the full plan)

- **Shell:** Capacitor with the built `postclip` assets bundled. Not `server.url`/hosted-URL (Capacitor does not intend it for production; offline use and the no-cloud promise require bundling; Apple Guideline 4.2 rejects thin website wrappers).
- **Native value (what makes it an app, not a wrapper):**
  - iOS Share Extension and Android `SEND`-image intent filter that deliver the screenshot into postclip's pipeline through the **host bridge** (`window.__POSTCLIP_HOST__`, contract in `projects/postclip/docs/BUILDER_CONTRACT.md`);
  - optionally native OCR (Apple Vision / ML Kit) exposed through the same bridge;
  - native share-out via the OS share sheet.
- **UX principle:** share a screenshot → see the cleaned text → share/copy. No accounts, no onboarding walls, no extra tabs.
- **Pinned input:** a recorded postclip commit/tag and the sha256 of its `dist/`.

## Prerequisites (owner)

- A Mac with Xcode and Android Studio (see the earlier device-setup notes in the repo history of the postclip plan PR).
- Apple Developer Program (paid, annual) and Google Play developer account (one-time fee) — owner purchases; agents never spend money.
- Signing keys and store credentials stay outside the repo.

## Known risks

- App Store Guideline 4.2 can still reject a thin wrapper even when assets are bundled; native share-in and native OCR are the differentiators, and the fallback is distributing postclip as an installable web app only.
- WebView limits on iOS (memory for an in-browser LLM, storage eviction) — to be measured on real devices.
- Store review of privacy claims ("nothing leaves your phone") requires an accurate privacy policy.

## Non-goals (for now)

Any implementation, store submission, CI for native builds, or changes to `postclip`.
