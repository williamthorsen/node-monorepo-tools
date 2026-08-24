import type { CheckOutcome } from 'readyup';
import { expect } from 'vitest';

/** Extracts the detail string from a check outcome, asserting first that the check failed. */
export function getDetail(outcome: boolean | CheckOutcome): string {
  expect(outcome).toBeTypeOf('object');
  if (typeof outcome === 'boolean') throw new TypeError('expected a CheckOutcome');
  expect(outcome.ok).toBe(false);
  return outcome.detail ?? '';
}
