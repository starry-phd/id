import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  {ignores:['**/node_modules/**','**/.expo/**','**/dist/**']},
  js.configs.recommended,
  {files:['apps/**/*.mjs'], languageOptions:{globals:{Request:'readonly'}}},
  {files:['apps/**/*.{ts,tsx}','packages/sdk/src/**/*.ts','packages/sdk/test-support/**/*.ts','packages/integration/src/**/*.ts'],
   languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},
   plugins:{'@typescript-eslint':plugin},
   rules:{'no-undef':'off','no-unused-vars':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]}
  }
];
