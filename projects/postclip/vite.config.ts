import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { PROD_CSP, TEST_CSP } from './scripts/csp-policy.mjs';

// S5 (A29): the TEST build appends exactly one connect-src origin to the
// shipped CSP — the local model server (e2e/demo serve the real pinned file
// from http://127.0.0.1:4599 through the test-only ?testModelUrl flag).
// Production builds carry scripts/csp-policy.mjs's PROD_CSP verbatim; the
// difference is asserted by scripts/inspect_bundle.mjs on both builds.
const cspTestBuildPlugin: Plugin = {
  name: 'postclip-csp-test-build',
  transformIndexHtml(html) {
    if (process.env.POSTCLIP_TEST_BUILD !== '1') return html;
    if (!html.includes(PROD_CSP)) {
      throw new Error('csp: index.html does not carry the PROD_CSP meta verbatim');
    }
    return html.replace(PROD_CSP, TEST_CSP);
  },
};

export default defineConfig({
  plugins: [react(), cspTestBuildPlugin],
  define: {
    // S3 (A29): the test-only overrides (model URL, capability-probe flag)
    // exist ONLY in test builds — `POSTCLIP_TEST_BUILD=1 npm run build`
    // (npm run build:test, used by test:e2e and the demo). Production builds
    // inline `false`, so every test-hook branch is dead-code-eliminated and
    // absent from the shipped bundle.
    __POSTCLIP_TEST_BUILD__: JSON.stringify(process.env.POSTCLIP_TEST_BUILD === '1'),
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'fixtures/**/*.{test,spec}.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
