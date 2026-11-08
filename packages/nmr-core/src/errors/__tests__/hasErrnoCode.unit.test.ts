import { describe, expect, expectTypeOf, it } from 'vitest';

import { hasErrnoCode } from '../hasErrnoCode.ts';

describe(hasErrnoCode, () => {
  it('returns true for an Error with the code', () => {
    const error = Object.assign(new Error('no such file'), { code: 'ENOENT' });

    expect(hasErrnoCode(error, 'ENOENT')).toBe(true);
  });

  it('returns false for an Error with a different code', () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    expect(hasErrnoCode(error, 'ENOENT')).toBe(false);
  });

  it('returns false for an Error without a code', () => {
    expect(hasErrnoCode(new Error('no such file'), 'ENOENT')).toBe(false);
  });

  it('returns false for a non-Error value with a matching code', () => {
    expect(hasErrnoCode({ code: 'ENOENT' }, 'ENOENT')).toBe(false);
  });

  it('returns false for a thrown value that is not an object', () => {
    expect(hasErrnoCode('ENOENT', 'ENOENT')).toBe(false);
    expect(hasErrnoCode(undefined, 'ENOENT')).toBe(false);
  });

  it('narrows the value to an Error with the code', () => {
    // `expectTypeOf` is a run-time no-op: A mismatch appears as a type error rather than as a failure here.
    expectTypeOf(hasErrnoCode).guards.toEqualTypeOf<Error & { code: string }>();
  });
});
