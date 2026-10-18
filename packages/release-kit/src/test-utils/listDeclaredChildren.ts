import type { RdyCheck } from 'readyup';
import { assert } from 'vitest';

/** Returns the dependent checks that a check declares, asserting that it does not build them at run time. */
export function listDeclaredChildren(check: RdyCheck): readonly RdyCheck[] {
  assert(typeof check.checks !== 'function', `Expected "${check.name}" to declare its dependent checks`);
  return check.checks ?? [];
}
