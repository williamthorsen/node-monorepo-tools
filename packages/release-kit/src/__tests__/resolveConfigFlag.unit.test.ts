import { describe, expect, it } from 'vitest';

import { resolveConfigFlag } from '../resolveConfigFlag.ts';

describe(resolveConfigFlag, () => {
  it('resolves a relative path against the invocation directory', () => {
    expect(resolveConfigFlag('alt.config.ts', '/repo/packages/a')).toBe('/repo/packages/a/alt.config.ts');
  });

  it('resolves a parent-relative path against the invocation directory', () => {
    expect(resolveConfigFlag('../../.config/alt.config.ts', '/repo/packages/a')).toBe('/repo/.config/alt.config.ts');
  });

  it('returns an absolute path unchanged', () => {
    expect(resolveConfigFlag('/elsewhere/alt.config.ts', '/repo/packages/a')).toBe('/elsewhere/alt.config.ts');
  });

  it('returns undefined when the flag is absent', () => {
    expect(resolveConfigFlag(undefined, '/repo/packages/a')).toBeUndefined();
  });
});
