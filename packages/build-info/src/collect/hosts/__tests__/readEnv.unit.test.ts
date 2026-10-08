import { describe, expect, it } from 'vitest';

import { readEnv } from '../readEnv.ts';

describe(readEnv, () => {
  it('returns a set value', () => {
    expect(readEnv({ KEY: 'value' }, 'KEY')).toBe('value');
  });

  it('treats an empty value as unset', () => {
    expect(readEnv({ KEY: '' }, 'KEY')).toBeUndefined();
    expect(readEnv({}, 'KEY')).toBeUndefined();
  });
});
