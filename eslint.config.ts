import baseConfig, { commonIgnores, createConfig, toolIgnores } from '@williamthorsen/eslint-config-typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

import { syntaxRestrictions, testCodeRestrictions } from './eslint.restrictions.ts';

const config = defineConfig([
  ...baseConfig,
  {
    // A stale `eslint-disable` reports under no rule name, and strict-lint promotes only named rules, so raising
    // it here is what fails the gate on one.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  globalIgnores([...commonIgnores, ...toolIgnores]),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    rules: {
      'no-console': ['error', { allow: ['debug', 'info', 'warn'] }],
      'no-restricted-syntax': ['error', ...syntaxRestrictions],
    },
  },
  {
    files: ['**/__tests__/**', '**/test-utils/**'],
    rules: {
      'no-restricted-syntax': ['error', ...testCodeRestrictions],
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Anchor the project service (enabled by the base config) at the repo root.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
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
      // Assertions here run through helpers named `expectX` and `assertX`; without these patterns the rule reports
      // every test that uses one. `expect*` subsumes plain `expect`.
      'vitest/expect-expect': ['warn', { assertFunctionNames: ['expect*', 'assert*'] }],
      // Off upstream, re-enabled here: the `import()` form typechecks the specifier, so a moved or renamed module
      // fails the build instead of silently leaving the real module in place.
      'vitest/prefer-import-in-mock': 'warn',
      // Off here: the rule's hand-maintained `Symbol` allow-list omits `dispose`, which a suite-scoped
      // `captureStdio` binding calls to restore the streams, and the rule takes no options to extend it.
      'unicorn/no-nonstandard-builtin-properties': 'off',
    },
  }),
  {
    // The change-grammar package depends on nothing but itself, so that it runs anywhere: no module outside the
    // package, no package, no Node builtin, and no `process`.
    files: ['packages/change-grammar/src/**/*.ts'],
    rules: {
      'import-x/no-nodejs-modules': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            {
              except: ['./packages/change-grammar'],
              from: '.',
              message: 'The change-grammar package imports nothing outside its own directory.',
              target: './packages/change-grammar/src',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { message: 'The change-grammar package reads no ambient environment.', name: 'process' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message: 'The change-grammar package depends on no package, so it carries none to its consumers.',
              regex: '^[^.]',
            },
          ],
        },
      ],
    },
  },
  {
    // The package's suites stay outside the dependency half of the boundary, because they run ESLint through
    // Vitest and read the filesystem. The path zone still binds them.
    files: ['packages/change-grammar/src/**/__tests__/**/*.ts'],
    rules: {
      'import-x/no-nodejs-modules': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
]);

export default config;
