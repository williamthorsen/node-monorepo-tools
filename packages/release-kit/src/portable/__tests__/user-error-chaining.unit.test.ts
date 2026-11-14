import { UserError } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { asUserError, chainUserError, prefixUserError } from '../user-error-chaining.ts';

describe(asUserError, () => {
  it('wraps a plain error in a UserError with the same message and the original as its cause', () => {
    const original = new Error('Command failed: git push origin main');

    const result = asUserError(original);

    expect(result).toBeInstanceOf(UserError);
    expect(result.message).toBe('Command failed: git push origin main');
    expect(result.cause).toBe(original);
  });

  it('returns a UserError as it is', () => {
    const original = new UserError('already handled');

    expect(asUserError(original)).toBe(original);
  });
});

describe(chainUserError, () => {
  it("prefixes the cause's message and keeps the cause", () => {
    const cause = new Error('ENOENT: no such file or directory');

    const result = chainUserError('Failed to read package.json', cause);

    expect(result).toBeInstanceOf(UserError);
    expect(result.message).toBe('Failed to read package.json: ENOENT: no such file or directory');
    expect(result.cause).toBe(cause);
  });
});

describe(prefixUserError, () => {
  it('prefixes a UserError', () => {
    const cause = new UserError('git log exited with code 1');

    const result = prefixUserError('Failed to read the release history for v', cause);

    expect(result).toBeInstanceOf(UserError);
    expect(result).toHaveProperty('message', 'Failed to read the release history for v: git log exited with code 1');
  });

  it('returns any other value unchanged', () => {
    const crash = new TypeError('Cannot read properties of undefined');

    expect(prefixUserError('Failed to read the release history for v', crash)).toBe(crash);
  });
});
