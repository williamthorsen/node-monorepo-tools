// `@williamthorsen/eslint-config-typescript` v6 added new unicorn rules, surfacing new violations in existing code.
// Errors are downgraded to warnings here until a decision is made whether to remove the rule or fix the violations.
export const deferredLintRules = {
  'unicorn/no-computed-property-existence-check': 'warn',
  'unicorn/no-declarations-before-early-exit': 'warn',
  'unicorn/no-for-each': 'warn',
  'unicorn/no-incorrect-template-string-interpolation': 'warn',
  'unicorn/no-return-array-push': 'warn',
  'unicorn/no-top-level-assignment-in-function': 'warn',
  'unicorn/no-unreadable-for-of-expression': 'warn',
  'unicorn/no-unsafe-string-replacement': 'warn',
  'unicorn/operator-assignment': 'warn',
  'unicorn/prefer-await': 'warn',
  'unicorn/prefer-else-if': 'warn',
  'unicorn/prefer-global-number-constants': 'warn',
  'unicorn/prefer-includes-over-repeated-comparisons': 'warn',
  'unicorn/prefer-iterator-to-array': 'warn',
  'unicorn/prefer-simple-condition-first': 'warn',
  'preserve-caught-error': 'warn',
} as const;

// Remove these; see #545.
export const deferredTestRules = {
  'vitest/expect-expect': 'warn',
  'vitest/no-conditional-expect': 'warn',
  'vitest/no-conditional-in-test': 'warn',
  'vitest/require-mock-type-parameters': 'warn',
  'vitest/require-to-throw-message': 'warn',
  'vitest/prefer-each': 'warn',
} as const;
