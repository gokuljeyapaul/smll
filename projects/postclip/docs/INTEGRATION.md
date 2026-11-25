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
below. That contract is live since R2-2 (issue #79) and this section is its
single source of truth.

Standalone iOS users can still use PostClip directly from Safari: open the
app, then **paste** (paste-event or the clipboard button, where the engine
grants it) or pick the screenshot from the photo library — the same
result-first screen appears (A33).

## The host messaging contract (R2-2, issue #79)

PostClip embedded in an `<iframe>` (or a WebView) talks to the embedding page
through `window.postMessage`. Four messages exist — no more.

### host → PostClip: hand a screenshot

```js
iframe.contentWindow.postMessage(
  {
    type: 'postclip:load-image',
    image: blob,          // Blob or ArrayBuffer (the screenshot's bytes)
    mime: 'image/png',    // one of: image/png | image/jpeg | image/webp
    requestId: 'id-123',  // your correlation id (string, <= 128 chars)
  },
  'https://your-postclip-origin.example.com'  // the app's origin — never '*'
);
```

* **Size cap: 32 MiB.** Larger messages are rejected with `too-large`
  (PostClip downscales huge images itself, but the channel is bounded).
* **MIME allow-list: `image/png`, `image/jpeg`, `image/webp`** — exactly the
  formats PostClip's byte-sniff stage reads. Anything else is rejected with
  `unsupported-mime`.
* **Shape:** `type`, `image`, `mime`, `requestId` — exactly these. A malformed
  message from an allow-listed origin gets `postclip:error` with code
  `bad-message`; the `requestId` is echoed back when the message carried a
  usable one.
* The image is validated byte-by-byte exactly like a picked or pasted one
  (non-images, tiny and corrupt inputs fail closed with their specific kind
  error — the pipeline is unchanged).

### PostClip → host: the replies

| Message | Shape | When |
|---|---|---|
| `postclip:ready` | `{type: "postclip:ready"}` | once at boot, when the bridge is live (embedded + allow-list non-empty) |
| `postclip:result` | `{type: "postclip:result", requestId, text}` | the read finished; `text` is the cleaned, editable result |
| `postclip:error` | `{type: "postclip:error", requestId, code}` | the read failed; `code` is the specific reason |

Error `code`s: `non-image`, `tiny`, `corrupt`, `no-text`, `non-english`,
`unreadable` (the pipeline's kind errors, each of which the app also shows
inside the frame with one obvious next step) plus the channel's own
`bad-message`, `too-large`, `unsupported-mime`.

A `postclip:result` may arrive **more than once** for one `requestId` when the
optional (off-by-default) tidy-up model upgrades the text after the standard
result — **the last one wins.**

### Origin allow-list (default: none accepted)

The bridge accepts messages **only from origins you explicitly allow-list**,
and replies **only to an allow-listed origin — never `"*"`**. Messages from
any other origin are ignored outright: no reply, no content inspection, no
content logging. Even `postclip:ready` is delivered per-allow-listed-origin,
so a stranger page that merely embeds the app receives nothing.

Configure the allow-list either way (both may be present; entries merge):

1. **Query param** (URL-encoded, comma-separated for multiple origins):

   ```
   https://your-postclip-origin.example.com/?host=https%3A%2F%2Fhost.example.com
   ```

2. **Build-time config** (baked into the bundle at build time):

   ```
   VITE_POSTCLIP_HOST_ORIGINS="https://host.example.com,https://other.example.com"
   ```

Default for both: **empty — nothing is accepted from other origins** and the
app behaves exactly like the standalone PWA (no listener, no ready message).

**Privacy on the channel** (unchanged rules): no post text in any URL, log,
storage or network request. The **only** thing that leaves the embedded app
is the result `postMessage` to your allow-listed origin. Your host page
receives `text` — what you do with it inside your own app is your policy.

## Hosting: the exact header and the iframe snippet

### frame-ancestors (must be an HTTP header)

PostClip's own Content-Security-Policy is shipped as a `<meta>` tag (strict:
`default-src 'none'` plus the specific sources — see `scripts/csp-policy.mjs`).
**A `<meta>` CSP cannot set `frame-ancestors`** — the CSP specification says
the directive is ignored in meta policies. So embedding needs the header on
the **served document** (`dist/index.html`). Serve PostClip with:

```
Content-Security-Policy: frame-ancestors 'self' https://host.example.com;
```

(keep the app's meta CSP as shipped; the browser combines the header and the
meta). Working example configs for the static `dist/` this repo builds:

* **nginx** (a static host shape that matches this repo's output):

  ```nginx
  # postclip.conf — serve the built dist/ with the embedding header
  location / {
      root /srv/postclip-dist;          # the repo's dist/ after `npm run build`
      try_files $uri $uri/ /index.html;
      add_header Content-Security-Policy "frame-ancestors 'self' https://host.example.com" always;
  }
  ```

* **Caddy**:

  ```Caddyfile
  postclip.example.com {
      root * /srv/postclip-dist
      header Content-Security-Policy "frame-ancestors 'self' https://host.example.com"
      try_files {path} /index.html
      file_server
  }
  ```

* **plain Node** (a static server with the header, for evaluation):

  ```js
  import { createServer, readFileSync } from 'node:http';
  import { extname, join, normalize } from 'node:path';
  const ROOT = 'dist';
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
                  '.json': 'application/json', '.svg': 'image/svg+xml' };
  createServer((req, res) => {
    let path = normalize(req.url.split('?')[0]).replace(/^([/\\])+/, '');
    if (!path || path === '/') path = 'index.html';
    try {
      const body = readFileSync(join(ROOT, path));
      res.writeHead(200, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        'content-security-policy': "frame-ancestors 'self' https://host.example.com",
      });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  }).listen(8080);
  ```

Replace `https://host.example.com` with **your** host app's origin (one entry
per origin that may embed). The e2e suite runs this exact shape locally: the
app on one origin, the demo host page on another (`e2e/fixtures/host/`).

### The iframe snippet (allow= / sandbox)

Recommended — the app stays fully functional:

```html
<iframe
  src="https://your-postclip-origin.example.com/?host=https%3A%2F%2Fhost.example.com"
  title="PostClip"
  allow="clipboard-write"
></iframe>
```

* `allow="clipboard-write"` lets the **Copy** button work inside the frame.
  Without it (or in a WebView that blocks the clipboard), Copy **falls back
  and says so** — a specific message telling the user to select the text and
  copy it themselves; it never silently fails. Web Share from inside a frame
  may also be blocked by the embedder: PostClip hides the Share button when
  the engine offers no share, and a blocked share attempt shows its error.
* `sandbox`: do not sandbox, or use `sandbox="allow-scripts"` **with the
  honest costs documented**: a sandboxed frame gets an opaque origin → no
  service worker (no install/offline shell), no model cache storage (the
  optional tidy-up model cannot be cached — the rules cleanup keeps working
  fine), clipboard blocked (the kind fallback above), and Web Share blocked.
  The messaging contract itself works in a sandboxed frame (postMessage does
  not need same-origin); the unsandboxed shape is what the e2e suite covers —
  a real sandboxed-WebView pass stays NOT_RUN (A27).
* Sizing: the layout is fluid from 320 px wide and uses the frame's own
  dynamic viewport (`100dvh`), so **any frame height works** — the host page
  may size the iframe to whatever the mobile app's layout needs.

## Storage reality inside frames

Third-party iframes and WebViews often **partition or wipe** storage
(per-browser storage partitioning; WebViews that clear state on app updates;
private browsing). Inside PostClip that is a **first-class case** (R2-3):

* The standard flow — OCR + the deterministic rules cleanup, Copy/Share —
  needs **no storage at all**. Nothing is stored about any post, ever.
* The app-shell cache and the optional tidy-up model cache may be partitioned
  or wiped by the embedder; PostClip detects a lost model cache and explains
  it kindly (one line, no download button, the standard rules cleanup keeps
  working — A39). If your WebView clears storage between sessions, expect
  the model opt-in to be re-offered inside its collapsed Advanced section
  and everything else to work identically.

## Privacy on every path in

No matter how the image arrives, the rules are unchanged: nothing is
uploaded, no post text is stored anywhere (the only persistence is the
app-shell cache and the optional model cache), the share-target POST body is
never cached or logged, and the strict CSP allows no third-party origin
(`docs/BUILD_PLAN.md` → "Privacy and no-storage design"). The host messaging
channel adds exactly one allowed exit: the result `postMessage` to your
allow-listed origin — and nothing else crosses the frame boundary.
