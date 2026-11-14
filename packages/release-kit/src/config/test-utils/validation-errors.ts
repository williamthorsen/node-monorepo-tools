import { expect } from 'vitest';

/**
 * Asserts that at least one error in `errors` is attributed to the given field path, without pinning the message,
 * whose text is Zod's default.
 *
 * An error whose message this package writes (deprecation, duplicate-detection, and collision messages, cross-field
 * warnings, and the "must be a non-empty string" customization) is asserted with
 * `expect(errors).toContain('exact message')` instead.
 */
export function expectErrorAtPath(errors: readonly string[], path: string): void {
  const matched = errors.some((e) => e.startsWith(`${path}:`));
  expect(matched, `expected an error at path '${path}'\nactual errors:\n  ${errors.join('\n  ')}`).toBe(true);
}

/**
 * Asserts that at least one error in `errors` mentions the given substring, for a top-level error without a path
 * prefix, such as Zod's `.strict()` report `Unrecognized key: "X"`, without pinning the wording.
 */
export function expectErrorMentioning(errors: readonly string[], substring: string): void {
  const matched = errors.some((e) => e.includes(substring));
  expect(matched, `expected an error mentioning '${substring}'\nactual errors:\n  ${errors.join('\n  ')}`).toBe(true);
}
