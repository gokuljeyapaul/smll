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
  // Referenced inside page.evaluate() callbacks, which execute in the browser:
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  location: 'readonly',
  Image: 'readonly',
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
);
