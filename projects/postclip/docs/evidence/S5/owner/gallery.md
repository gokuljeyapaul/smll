# S5 owner gallery — mobile viewport, offline, keyboard focus (O05)

All screenshots are from one REAL passing run of the app (test build,
Chromium, 390x844 phone viewport, default rules-only state — the model
cleanup is opt-in). What "good" looks like per the plan row O05:
usable one-handed on a phone-sized screen; works offline; focus is visible.

- ![01-home-mobile.jpg](./01-home-mobile.jpg)
  The home screen at 390x844 — the whole flow (drop, paste, choose) within a one-handed thumb arc.
- ![02-keyboard-focus-mobile.jpg](./02-keyboard-focus-mobile.jpg)
  Keyboard-only: Tab lands on Choose screenshot with a clearly VISIBLE focus ring (3px outline).
- ![03-review-mobile.jpg](./03-review-mobile.jpg)
  The review screen at 390x844 after a real pick → OCR → cleanup: readable cleaned text, Share/Copy/Export reachable.
- ![04-export-menu-mobile.jpg](./04-export-menu-mobile.jpg)
  The export menu (Markdown/Text/JSON) open at 390x844.
- ![05-offline-reload-mobile.jpg](./05-offline-reload-mobile.jpg)
  With the network CUT, reloading still brings up the full app — the service worker serves the precached shell.
- ![06-offline-review-mobile.jpg](./06-offline-review-mobile.jpg)
  Still offline: a second screenshot is read and cleaned entirely on-device (offline OCR — A11's flow), zero network requests.

The engine matrix (Chromium + WebKit), the axe accessibility scans and the
keyboard-only flow are proven by the S5 e2e JUnit in docs/evidence/S5/junit/.
