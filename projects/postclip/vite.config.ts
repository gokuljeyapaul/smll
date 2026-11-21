import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'fixtures/**/*.{test,spec}.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
