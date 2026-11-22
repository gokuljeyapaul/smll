import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
