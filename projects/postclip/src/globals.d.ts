/**
 * Build-time constants (see vite.config.ts `define`). `__POSTCLIP_TEST_BUILD__`
 * is true only when the build is made for the e2e/demo test runs
 * (POSTCLIP_TEST_BUILD=1 npm run build); production builds inline `false`,
 * which lets the bundler eliminate every test-only override branch (A29:
 * test hooks exist only in test builds and must be absent from production).
 */
declare const __POSTCLIP_TEST_BUILD__: boolean;

/** Vite `?url` asset imports (the wllama WASM binary the worker loads). */
declare module '*?url' {
  const url: string;
  export default url;
}

/** The shipped CSP constants (scripts/csp-policy.mjs — one source of truth
 *  shared by vite.config.ts, the bundle inspection and the e2e specs). */
declare module '*/csp-policy.mjs' {
  export const PINNED_MODEL_HOST: string;
  export const PROD_CSP: string;
  export const TEST_MODEL_SERVER: string;
  export const TEST_CSP: string;
}
