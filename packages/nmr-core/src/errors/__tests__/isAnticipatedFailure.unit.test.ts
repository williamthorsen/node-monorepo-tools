import { describe, expect, it } from 'vitest';

import { isAnticipatedFailure } from '../isAnticipatedFailure.ts';
import { UserError } from '../UserError.ts';

describe(isAnticipatedFailure, () => {
  it('accepts a UserError', () => {
    expect(isAnticipatedFailure(new UserError('Config file not found'))).toBe(true);
  });

  it('accepts a Node system error', () => {
    const systemError = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
      syscall: 'open',
    });

    expect(isAnticipatedFailure(systemError)).toBe(true);
  });

  it('rejects an error with a code but no syscall', () => {
    const codedError = Object.assign(new Error('Invalid argument'), { code: 'ERR_INVALID_ARG_TYPE' });

    expect(isAnticipatedFailure(codedError)).toBe(false);
  });

  it('rejects a plain error and a thrown non-Error', () => {
    expect(isAnticipatedFailure(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isAnticipatedFailure('just a string')).toBe(false);
  });
});
