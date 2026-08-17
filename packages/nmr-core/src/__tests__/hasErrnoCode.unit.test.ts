import { describe, expect, expectTypeOf, it } from 'vitest';

import { hasErrnoCode } from '../hasErrnoCode.ts';

describe(hasErrnoCode, () => {
  it('returns true for an Error carrying the code', () => {
    const error = Object.assign(new Error('no such file'), { code: 'ENOENT' });

    expect(hasErrnoCode(error, 'ENOENT')).toBe(true);
  });

  it('returns false for an Error carrying a different code', () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    expect(hasErrnoCode(error, 'ENOENT')).toBe(false);
  });

  it('returns false for an Error carrying no code', () => {
    expect(hasErrnoCode(new Error('no such file'), 'ENOENT')).toBe(false);
  });

  it('returns false for a non-Error value carrying a matching code', () => {
    expect(hasErrnoCode({ code: 'ENOENT' }, 'ENOENT')).toBe(false);
  });

  it('returns false for a thrown value that is not an object', () => {
    expect(hasErrnoCode('ENOENT', 'ENOENT')).toBe(false);
    expect(hasErrnoCode(undefined, 'ENOENT')).toBe(false);
  });

  it('narrows the value to an Error carrying the code', () => {
    // `expectTypeOf` is a run-time no-op: a mismatch surfaces as a type error rather than as a failure here.
    expectTypeOf(hasErrnoCode).guards.toEqualTypeOf<Error & { code: string }>();
  });
});
