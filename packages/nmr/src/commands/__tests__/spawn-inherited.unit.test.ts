import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolveInheritedExitCode } from '../spawn-inherited.ts';

describe(resolveInheritedExitCode, () => {
  it.each([
    { outcome: { signal: 'SIGKILL', status: null }, expected: 128 + os.constants.signals.SIGKILL },
    { outcome: { signal: 'SIGTERM', status: null }, expected: 128 + os.constants.signals.SIGTERM },
    { outcome: { signal: null, status: 0 }, expected: 0 },
    { outcome: { signal: null, status: 3 }, expected: 3 },
    { outcome: { signal: null, status: null }, expected: 1 },
  ] as const)('maps $outcome to $expected', ({ outcome, expected }) => {
    expect(resolveInheritedExitCode(outcome)).toBe(expected);
  });
});
