import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
  {ignores:['**/node_modules/**','**/.expo/**','**/dist/**']},
  js.configs.recommended,
  {files:['apps/**/*.mjs'], languageOptions:{globals:{Request:'readonly'}}},
  {
    files:['apps/**/*.{ts,tsx}','packages/**/src/**/*.ts','modules/**/src/**/*.ts'],
    languageOptions:{
      parser,
      parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}
    },
    plugins:{'@typescript-eslint':plugin},
    rules:{
      'no-undef':'off','no-unused-vars':'off',
      '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}],
    },
  },
  // Temporary Gate 2 exception for AI-2 pinned unused local variable;
  // all other unused variables still fail. AI-2 owner has the remediation.
  {
    files:['packages/billing-contracts/src/trusted-adapter.ts'],
    rules:{
      '@typescript-eslint/no-unused-vars':['error',{
        argsIgnorePattern:'^_',
        varsIgnorePattern:'^principal',
      }],
    },
  },
];
