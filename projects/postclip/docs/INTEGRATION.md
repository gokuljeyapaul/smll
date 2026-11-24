# INTEGRATION — sharing into PostClip from other apps

PostClip is an installable web app (PWA). How a screenshot gets from a phone's
share sheet into PostClip depends on the platform; this page states honestly
what works, what cannot work, and the supported route for hosts that embed
PostClip (R2-2, issue #79).

## Android (installed PWA) — share directly

On Android Chrome with PostClip installed, the app registers as a **share
target** (`manifest.webmanifest` → `share_target`, multipart `POST` accepting
`image/*` to `/share-target`). Sharing a screenshot from any app to PostClip:

1. the service worker receives the multipart POST,
2. hands the image to the app **without storing or logging the body**
   (the privacy audit re-checks this on every share flow — A15),
3. the app starts reading the screenshot by itself and ends on the text with
   a large **Copy** button first (R2-1, A32).

Automated coverage: the service-worker share-target POST is simulated
end-to-end in Chromium (A08/A32 — the same handler the Android share sheet
hits). The **real** Android installed-PWA share is `NOT_RUN` on the build
runner (the plan's optional real-device pass A27; the checklist lives in
`docs/KNOWN_LIMITS.md`).

## iPhone / any host that cannot receive shares in a plain web app

**Plain web apps cannot receive shared images on iOS** — Safari/iOS does not
support the Web Share Target API, so a share from the iOS share sheet cannot
hand an image to PostClip directly. That is a platform limit, honestly stated,
not a missing feature.

The supported route is the **host mobile app**: your iOS (or Android) app
receives the share through the native share sheet, then hands the image to an
embedded PostClip (iframe or WebView) through the **host messaging contract**
specified and delivered by **R2-2 (issue #79)** — the
`postclip:load-image` / `postclip:result` `postMessage` API with an origin
allow-list. When R2-2 lands, its contract section in this document is the
single source of truth for the hand-off (message shapes, sizes, MIME
allow-list, origin rules, and the privacy guarantees that stay unchanged).

Until R2-2 lands, iOS users can still use PostClip standalone from Safari:
open the app, then **paste** (paste-event or the clipboard button, where the
engine grants it) or pick the screenshot from the photo library — the same
result-first screen appears (A33).

## Privacy on every path in

No matter how the image arrives, the rules are unchanged: nothing is
uploaded, no post text is stored anywhere (the only persistence is the
app-shell cache and the optional model cache), the share-target POST body is
never cached or logged, and the strict CSP allows no third-party origin
(`docs/BUILD_PLAN.md` → "Privacy and no-storage design").
