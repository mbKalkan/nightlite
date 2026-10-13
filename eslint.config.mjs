import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'test/fixtures/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/extension/**/*.ts', 'scripts/**/*.mjs', 'test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/webview/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
);
