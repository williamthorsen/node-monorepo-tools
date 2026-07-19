import config from '@williamthorsen/eslint-config-typescript';

/**
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...config,
  {
    // Completely ignore these files
    ignores: ['**/*.sh', '**/.claude/**', '**/.readyup/**/*.js', '**/coverage/**', '**/dist/**', '**/local/**'],
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    rules: {
      'n/no-extraneous-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
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
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    // Config files legitimately mutate and compose configuration objects at module top level.
    files: ['**/*.config.{cjs,js,mjs,ts}', '**/config/**'],
    rules: {
      'unicorn/no-top-level-side-effects': 'off',
    },
  },
  {
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // TODO(#481): Fix violations and then remove overrides, or selectively make overrides permanent.
    // Context: `eslint-config-typescript` v6 (which includes an upgrade of `eslint-plugin-unicorn` from 63 to 72,
    // adding new core rules) surfaced pre-existing violations that `eslint --fix` cannot resolve.
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
      'preserve-caught-error': 'off',
      'unicorn/max-nested-calls': 'off',
      'unicorn/no-computed-property-existence-check': 'off',
      'unicorn/no-declarations-before-early-exit': 'off',
      'unicorn/no-for-each': 'off',
      'unicorn/no-incorrect-template-string-interpolation': 'off',
      'unicorn/no-return-array-push': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/no-unsafe-string-replacement': 'off',
      'unicorn/operator-assignment': 'off',
      'unicorn/prefer-await': 'off',
      'unicorn/prefer-else-if': 'off',
      'unicorn/prefer-global-number-constants': 'off',
      'unicorn/prefer-includes-over-repeated-comparisons': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      'unicorn/require-array-sort-compare': 'off',
    },
  },
];
