import baseConfig, { createConfig } from '@williamthorsen/eslint-config-typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

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
    // The suites taking their trees as fixtures bind `test.extend(...)` to `it`, which @vitest/eslint-plugin
    // 1.6.27 misreads: `consistent-test-it` compares the resolved import name (`test`) rather than the local
    // binding, so every describe-nested `it(...)` is a false positive. Delete this block when the upstream fix
    // lands: https://github.com/vitest-dev/eslint-plugin-vitest/issues/956
    //
    // The list grows per converted suite rather than the preamble collapsing into a shared helper: an imported
    // `it` traces back to no vitest export, at which point the plugin stops applying every vitest rule to the file.
    files: [
      '__tests__/workspace-test-presence.app.unit.test.ts',
      'packages/nmr-core/src/__tests__/cache-store.unit.test.ts',
      'packages/nmr-core/src/__tests__/hashWorkingTree.tool.test.ts',
      'packages/nmr-core/src/__tests__/readPackageVersion.unit.test.ts',
      'packages/nmr/src/__tests__/runCli.unit.test.ts',
      'packages/nmr/src/commands/__tests__/build-output.unit.test.ts',
    ],
    rules: {
      'vitest/consistent-test-it': 'off',
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
