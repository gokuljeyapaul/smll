import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const NODE_SCRIPT_GLOBALS = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URLSearchParams: 'readonly',
  MutationObserver: 'readonly',
  // Referenced inside page.evaluate() callbacks, which execute in the browser:
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  location: 'readonly',
  Image: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  caches: 'readonly',
  indexedDB: 'readonly',
  atob: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  ClipboardItem: 'readonly',
  ClipboardEvent: 'readonly',
  DataTransfer: 'readonly',
  requestAnimationFrame: 'readonly',
  AbortSignal: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'artifacts', '.cache', 'coverage', 'docs/evidence', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{mjs,cjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: NODE_SCRIPT_GLOBALS },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // The service worker is a classic worker script, not a module: lint it
    // with worker-script semantics and the ServiceWorkerGlobalScope globals.
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        importScripts: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        skipWaiting: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        console: 'readonly',
        Promise: 'readonly',
      },
    },
  },
);
