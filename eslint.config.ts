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
    },
  }),
  {
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    rules: {
      // Deprecation signals a gradual phase-out, not a removal deadline; the build does not gate on deprecated-API use.
      '@typescript-eslint/no-deprecated': 'off',
      // Bans the module-level `let` a memo needs, because a cache that lives only as long as one call is not a cache.
      'unicorn/no-top-level-assignment-in-function': 'off',
      // Asks that the cheaper operand lead a `&&` chain, at the cost of the reading order the surrounding code
      // establishes, and its own diagnostic concedes it cannot verify the reorder is safe. Goes away once
      // williamthorsen/eslint-config#124 turns the rule off centrally.
      'unicorn/prefer-simple-condition-first': 'off',
    },
  },
]);

export default config;
