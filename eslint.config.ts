import baseConfig, { createConfig } from '@williamthorsen/eslint-config-typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

const config = defineConfig([
  ...baseConfig,
  {
    // A stale `eslint-disable` reports under no rule name, and strict-lint promotes only named rules, so raising
    // it here is what fails the gate on one.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
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
      'no-console': ['error', { allow: ['debug', 'info', 'warn'] }],
      'no-restricted-syntax': [
        'error',
        // ESLint replaces a rule's options rather than merging them, so the base config's entries are restated here.
        'DebuggerStatement',
        'LabeledStatement',
        'WithStatement',
        {
          // Matches on the operator rather than the binding's name, so `err` and `e` are caught too. `isError`
          // recognizes an Error crossing a realm boundary, which the built-in test reports as false, so no
          // position is exempt.
          selector: "BinaryExpression[operator='instanceof'][right.name='Error']",
          message:
            "Test a thrown value's errno with `hasErrnoCode` from '@williamthorsen/nmr-core'; otherwise narrow it with `isError`, or extract its message with `describeError`, from '@williamthorsen/toolbelt.errors'.",
        },
      ],
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
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
]);

export default config;
