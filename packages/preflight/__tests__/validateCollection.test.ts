import { describe, expect, it } from 'vitest';

import type { PreflightCollection } from '../src/types.ts';
import { validateCollection } from '../src/validateCollection.ts';

/** Build a minimal valid collection for testing. */
function makeCollection(overrides?: Partial<PreflightCollection>): PreflightCollection {
  return {
    checklists: [
      { name: 'a', checks: [{ name: 'check-a', check: () => true }] },
      { name: 'b', checks: [{ name: 'check-b', check: () => true }] },
    ],
    ...overrides,
  };
}

describe(validateCollection, () => {
  it('passes when collection has no suites', () => {
    expect(() => validateCollection(makeCollection())).not.toThrow();
  });

  it('passes when suites reference valid checklist names', () => {
    const collection = makeCollection({ suites: { s: ['a', 'b'] } });

    expect(() => validateCollection(collection)).not.toThrow();
  });

  it('throws when a suite name collides with a checklist name', () => {
    const collection = makeCollection({ suites: { a: ['b'] } });

    expect(() => validateCollection(collection)).toThrow('Suite name(s) collide with checklist name(s): a');
  });

  it('throws when multiple suite names collide with checklist names', () => {
    const collection = makeCollection({ suites: { a: ['b'], b: ['a'] } });

    expect(() => validateCollection(collection)).toThrow(/a, b/);
  });

  it('throws when a suite references an unknown checklist', () => {
    const collection = makeCollection({ suites: { s: ['missing'] } });

    expect(() => validateCollection(collection)).toThrow('suite "s" references unknown checklist "missing"');
  });

  it('throws when multiple suites reference unknown checklists', () => {
    const collection = makeCollection({ suites: { s1: ['missing'], s2: ['also-missing'] } });

    expect(() => validateCollection(collection)).toThrow(/missing.*also-missing/);
  });

  it('includes available checklists in the error message for unknown references', () => {
    const collection = makeCollection({ suites: { s: ['missing'] } });

    expect(() => validateCollection(collection)).toThrow('Available checklists: a, b');
  });

  it('passes when suites is an empty record', () => {
    const collection = makeCollection({ suites: {} });

    expect(() => validateCollection(collection)).not.toThrow();
  });
});
