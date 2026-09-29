import baseConfig, { commonIgnores, createConfig, toolIgnores } from '@williamthorsen/eslint-config-typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

import { syntaxRestrictions, testCodeRestrictions } from './eslint.restrictions.ts';

const config = defineConfig([
  ...baseConfig,
  {
    // ESLint reports a stale `eslint-disable` without a rule name, and strict-lint promotes only named rules, so
    // raising it here fails the gate on one.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  // The revise-prose helper rewrites its record on every sweep, quoting a string as its YAML emitter chooses.
  globalIgnores([...commonIgnores, ...toolIgnores, '.agents/revise-prose.yaml']),
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
      // Off upstream, re-enabled here: The `import()` form typechecks the specifier, so a moved or renamed module
      // fails the build instead of silently leaving the real module in place.
      'vitest/prefer-import-in-mock': 'warn',
      // Off here: The rule's hand-maintained `Symbol` allow-list omits `dispose`, which a suite-scoped
      // `captureStdio` binding calls to restore the streams, and the rule does not take any option to extend it.
      'unicorn/no-nonstandard-builtin-properties': 'off',
    },
  }),
  {
    // The change-grammar package depends on nothing but itself, so that it runs anywhere: It does not import any
    // module outside the package, any package, or any Node builtin, and it does not read `process`.
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
        { message: 'The change-grammar package does not read the ambient environment.', name: 'process' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message:
                'The change-grammar package does not depend on any package, so it does not pass any dependency on to its consumers.',
              regex: '^[^.]',
            },
          ],
        },
      ],
    },
  },
  {
    // The package's suites stay outside the dependency half of the boundary, because they run ESLint through
    // Vitest and read the filesystem. The path zone still applies to them.
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
