/**
 * Build-time constants (see vite.config.ts `define`). `__POSTCLIP_TEST_BUILD__`
 * is true only when the build is made for the e2e/demo test runs
 * (POSTCLIP_TEST_BUILD=1 npm run build); production builds inline `false`,
 * which lets the bundler eliminate every test-only override branch (A29:
 * test hooks exist only in test builds and must be absent from production).
 */
declare const __POSTCLIP_TEST_BUILD__: boolean;
