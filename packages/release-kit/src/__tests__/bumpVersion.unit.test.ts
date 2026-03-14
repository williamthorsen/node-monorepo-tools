import { describe, expect, it } from 'vitest';

import { bumpVersion } from '../bumpVersion.ts';

describe(bumpVersion, () => {
  it('bumps the patch version', () => {
    const actual = bumpVersion('1.2.3', 'patch');
    expect(actual).toBe('1.2.4');
  });

  it('bumps the minor version and resets patch', () => {
    const actual = bumpVersion('1.2.3', 'minor');
    expect(actual).toBe('1.3.0');
  });

  it('bumps the major version and resets minor and patch', () => {
    const actual = bumpVersion('1.2.3', 'major');
    expect(actual).toBe('2.0.0');
  });

  it('handles version 0.0.0', () => {
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1');
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
    expect(bumpVersion('0.0.0', 'major')).toBe('1.0.0');
  });

  it('handles version 0.1.0', () => {
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpVersion('0.1.0', 'minor')).toBe('0.2.0');
    expect(bumpVersion('0.1.0', 'major')).toBe('1.0.0');
  });

  it('throws for an invalid version string', () => {
    expect(() => bumpVersion('invalid', 'patch')).toThrow("Invalid semver version: 'invalid'");
  });

  it('throws for a version with a pre-release suffix', () => {
    expect(() => bumpVersion('1.2.3-beta.1', 'patch')).toThrow("Invalid semver version: '1.2.3-beta.1'");
  });

  it('throws for an empty string', () => {
    expect(() => bumpVersion('', 'patch')).toThrow("Invalid semver version: ''");
  });
});
