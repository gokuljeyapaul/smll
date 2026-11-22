/*
 * PostClip service worker (S2 — A08 share target, A11 offline app shell).
 * Two jobs, nothing else — no analytics, no messaging, no third-party origin:
 *
 *  1. App shell (UC04): precache every static file of this build. The list is
 *     generated after the vite build by scripts/build_pwa_precache.mjs and
 *     imported from /precache-manifest.js, so it always matches the real
 *     dist/ — including /ocr-assets/ (worker, WASM core, traineddata), which
 *     makes first-load-then-offline work end to end.
 *
 *  2. Share target (UC02): the OS "Share to PostClip" sheet POSTs the shared
 *     image to /share-target (the manifest declares it). The worker parses
 *     the multipart body, hands the image file to an open window client and
 *     NEVER caches, stores or logs the POST body (plan "Privacy and
 *     no-storage design"): the request is consumed in memory, only the image
 *     field is read (text fields are not read at all), and nothing from the
 *     request ever enters any storage.
 */
'use strict';

importScripts('/precache-manifest.js');

// Must match the allow-list in src/privacy/audit.ts (A15): the app-shell
// cache is one of only two kinds of persistence the plan allows (the other
// is the S3 model cache).
const SHELL_CACHE = 'precache-v1';

// pathname -> full cache key (url + revision query, so every deploy busts
// fixed-name files like /index.html and /ocr-assets/worker.min.js).
const shellKeys = new Map();
for (const entry of self.__postclipPrecache) {
  shellKeys.set(new URL(entry.url, self.location.origin).pathname, entry.cacheKey);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // cache: 'reload' bypasses any HTTP cache so the precache is the real
      // build output; allFetches fail closed — if any file is missing the
      // install fails and the offline shell is never half-populated.
      await cache.addAll(
        self.__postclipPrecache.map((entry) => new Request(entry.cacheKey, { cache: 'reload' })),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge caches from earlier builds; only the current app-shell cache
      // and the S3 model cache (postclip-model-*, one of the two allowed
      // persistences — plan "Privacy and no-storage design") may persist.
      // A new deploy must never purge the user's downloaded model.
      const names = await caches.keys();
      for (const name of names) {
        if (name !== SHELL_CACHE && !name.startsWith('postclip-model')) await caches.delete(name);
      }
      // Take control of the loading page so its fetches (including the
      // share-target POST and the OCR asset loads) go through this worker.
      await self.clients.claim();
    })(),
  );
});

async function respondFromShell(pathname) {
  const cache = await caches.open(SHELL_CACHE);
  const key = shellKeys.get(pathname);
  const hit = key ? await cache.match(key) : null;
  if (hit) return hit;
  // Fail closed: no invented responses — fall through to the network.
  return fetch(pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    // The share-target POST is the ONLY non-GET request this worker touches.
    if (request.method === 'POST' && new URL(request.url).pathname === '/share-target') {
      event.respondWith(handleShareTarget(event));
    }
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // SPA app shell: every navigation is served the precached index.html.
    event.respondWith(respondFromShell('/index.html'));
    return;
  }
  const cacheKey = shellKeys.get(url.pathname);
  if (cacheKey) {
    event.respondWith(respondFromShell(url.pathname));
  }
});

/**
 * UC02: receive the shared image. PRIVACY: the multipart body is consumed
 * here, in memory, and never cached, stored or logged; only the file field
 * named in the manifest's share_target params is even read.
 */
async function handleShareTarget(event) {
  const request = event.request;
  let image = null;
  try {
    const formData = await request.formData();
    for (const value of formData.getAll('image')) {
      if (value instanceof File && value.type.startsWith('image/')) {
        image = value;
        break;
      }
    }
  } catch {
    // Malformed multipart: fail closed — nothing stored, nothing processed.
  }

  if (image) {
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({
          type: 'postclip-share-image',
          name: image.name,
          mime: image.type,
          blob: image,
        });
      }
    } catch {
      // Fail closed: without a window to hand the image to, nothing happens.
    }
  }

  if (request.mode === 'navigate') {
    // The real OS share sheet posts as a navigation: land on the app.
    return Response.redirect('/', 303);
  }
  return new Response(JSON.stringify({ received: image !== null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
