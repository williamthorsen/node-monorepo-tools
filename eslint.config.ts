import baseConfig, { createConfig } from '@williamthorsen/eslint-config-typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

import { deferredLintRules, deferredTestRules } from './.config/eslint/deferred-lint-rules.ts';

const config = defineConfig([
  ...baseConfig,
  globalIgnores([
    // Completely ignore these files.
    '**/*.sh',
    '**/.claude/**',
    '**/.readyup/**/*.js',
    '**/coverage/**',
    '**/dist/**',
    '**/local/**',
  ]),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    rules: {
      'n/no-extraneous-import': ['error', { allowModules: ['vitest'] }],
      'no-console': ['error', { allow: ['debug', 'info', 'warn'] }],
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.tsx', '**/*.md/*.ts'],
    languageOptions: {
      parserOptions: {
        // Anchor the project service (enabled by the base config) at the repo root.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...deferredLintRules,
      '@typescript-eslint/no-confusing-void-expression': [
        'warn',
        {
          ignoreArrowShorthand: true,
          ignoreVoidOperator: true,
          ignoreVoidReturningFunctions: true,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowBoolean: true,
          allowNumber: true,
        },
      ],
    },
  },
  defineConfig({
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [await createConfig.vitest()],
    rules: {
      ...deferredTestRules,
      'vitest/prefer-import-in-mock': 'off', // this rule's fixer can produce bad code; see issue #545
    },
  }),
  {
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Deprecation signals a gradual phase-out, not a removal deadline; the build does not gate on deprecated-API use.
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
]);

export default config;
