import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  {ignores:['**/node_modules/**','**/.expo/**','**/dist/**']},
  js.configs.recommended,
  {files:['apps/**/*.mjs'], languageOptions:{globals:{Request:'readonly',Response:'readonly'}}},
  {files:['apps/**/*.{ts,tsx}','packages/sdk/src/**/*.ts','packages/sdk/test-support/**/*.ts','packages/integration/src/**/*.ts',
    'modules/starry-id-v1/src/w3-local-vnext-typed-self-profile.ts',
    'packages/rebuild-billing/src/trusted-store-namespace.ts',
    'packages/rebuild-ai3/src/**/*.ts'],
   languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},
   plugins:{'@typescript-eslint':plugin},
   rules:{'no-undef':'off','no-unused-vars':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]}
  },
  // Original AI-2 dd1f1ccb byte-preserved: its explicit control-character validation regex is intentional.
  {files:['packages/rebuild-billing/src/trusted-store-namespace.ts'],rules:{'no-control-regex':'off'}},
];
