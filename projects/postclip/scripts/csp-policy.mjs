/**
 * The shipped Content-Security-Policy (S5 — A29, plan "Privacy and
 * no-storage design": "The strict CSP allows same-origin plus the pinned
 * model host only (connect-src), no third-party scripts, fonts or
 * analytics, no inline eval where avoidable").
 *
 * ONE source of truth, consumed by:
 *   - index.html           (the <meta http-equiv="Content-Security-Policy">)
 *   - vite.config.ts       (the test build appends the local model server
 *                           to connect-src — a test-only difference, exactly
 *                           like the build-time test hooks)
 *   - scripts/inspect_bundle.mjs  (bundle inspection asserts the built
 *                           dist/index.html carries the policy verbatim)
 *   - e2e/prod/a29_production.spec.ts (asserts it in the served page)
 *
 * What each directive allows — nothing more:
 *   default-src 'none'        the strictest possible fallback
 *   script-src 'self'         the app's own bundle; no inline, no eval
 *                             (no 'unsafe-eval', no 'wasm-unsafe-eval' on
 *                             the DOCUMENT: the WASM cores of tesseract.js
 *                             and wllama run inside same-origin dedicated
 *                             workers, which fetch and compile under their
 *                             own (header-delivered) policy, not this one)
 *   style-src 'self'          the bundled stylesheet (React writes styles
 *                             through the CSSOM, which CSP does not block)
 *   img-src 'self'            the PWA manifest icons served same-origin
 *   manifest-src 'self'       manifest.webmanifest
 *   worker-src 'self'         the OCR worker (/ocr-assets/worker.min.js),
 *                             the model-cleanup worker bundle, and the
 *                             service worker registration
 *   connect-src 'self' https://huggingface.co
 *                             same-origin fetches + THE PINNED MODEL HOST
 *                             (the only remote origin the plan allows; the
 *                             model download is the app's only network use)
 *   base-uri 'none'           no <base> injection
 *   form-action 'none'        no form submits anywhere
 *   object-src 'none'         no <object>/<embed>, ever
 *
 * frame-ancestors is deliberately absent: a <meta> CSP cannot enforce it
 * (the spec ignores the directive in meta policies); it belongs to the
 * hosting layer, which plan D10 keeps out of scope.
 */

export const PINNED_MODEL_HOST = 'https://huggingface.co';

export const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  `connect-src 'self' ${PINNED_MODEL_HOST}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/** The TEST build adds exactly one connect-src entry: the local model
 *  server the e2e suite/demo serves the real pinned file from
 *  (e2e/helpers/model-server.ts, scripts/serve_model.mjs). Production
 *  builds never contain this origin (asserted by bundle inspection). */
export const TEST_MODEL_SERVER = 'http://127.0.0.1:4599';

export const TEST_CSP = PROD_CSP.replace(
  "connect-src 'self'",
  `connect-src 'self' ${TEST_MODEL_SERVER}`,
);
