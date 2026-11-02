import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  crypto: 'readonly',
  setTimeout: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.wrangler/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
);
