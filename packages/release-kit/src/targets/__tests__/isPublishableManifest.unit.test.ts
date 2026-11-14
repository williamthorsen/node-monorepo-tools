import { describe, expect, it } from 'vitest';

import { isPublishableManifest } from '../isPublishableManifest.ts';

describe(isPublishableManifest, () => {
  it('returns true when `private` is absent', () => {
    expect(isPublishableManifest({ name: 'pkg' })).toBe(true);
  });

  it('returns true when `private` is false', () => {
    expect(isPublishableManifest({ name: 'pkg', private: false })).toBe(true);
  });

  it('returns false when `private` is true', () => {
    expect(isPublishableManifest({ name: 'pkg', private: true })).toBe(false);
  });

  it('returns false when `private` is a truthy non-boolean', () => {
    expect(isPublishableManifest({ name: 'pkg', private: 'true' })).toBe(false);
  });

  it('returns true when the manifest is not an object', () => {
    expect(isPublishableManifest(undefined)).toBe(true);
  });
});
