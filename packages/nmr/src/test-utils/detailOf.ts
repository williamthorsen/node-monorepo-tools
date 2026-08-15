import type { CheckReturnValue } from 'readyup';
import { expect } from 'vitest';

/** Extracts the detail string from a check outcome, asserting first that the check failed. */
export function detailOf(outcome: CheckReturnValue): string {
  expect(outcome).toBeTypeOf('object');
  if (typeof outcome === 'boolean') throw new TypeError('expected a CheckOutcome');
  expect(outcome.ok).toBe(false);
  return outcome.detail ?? '';
}
