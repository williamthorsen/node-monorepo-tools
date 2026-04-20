import { describe, expect, it } from 'vitest';

import { isForwardVersion } from '../compareVersions.ts';

describe(isForwardVersion, () => {
  it('returns true when the target increments the major component', () => {
    expect(isForwardVersion('0.9.9', '1.0.0')).toBe(true);
  });

  it('returns true when the target increments the minor component', () => {
    expect(isForwardVersion('0.3.7', '0.4.0')).toBe(true);
  });

  it('returns true when the target increments the patch component', () => {
    expect(isForwardVersion('0.3.7', '0.3.8')).toBe(true);
  });

  it('returns false when the target equals the current version', () => {
    expect(isForwardVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when the target downgrades the major component', () => {
    expect(isForwardVersion('2.0.0', '1.9.9')).toBe(false);
  });

  it('returns false when the target downgrades the minor component', () => {
    expect(isForwardVersion('0.4.0', '0.3.9')).toBe(false);
  });

  it('returns false when the target downgrades the patch component', () => {
    expect(isForwardVersion('0.3.8', '0.3.7')).toBe(false);
  });

  it('compares the minor component numerically (0.10.0 greater than 0.9.0)', () => {
    expect(isForwardVersion('0.9.0', '0.10.0')).toBe(true);
  });

  it('compares the patch component numerically (0.0.10 greater than 0.0.9)', () => {
    expect(isForwardVersion('0.0.9', '0.0.10')).toBe(true);
  });

  it('throws when the current version has a pre-release suffix', () => {
    expect(() => isForwardVersion('1.0.0-alpha', '1.0.0')).toThrow("Invalid semver version: '1.0.0-alpha'");
  });

  it('throws when the target version has a pre-release suffix', () => {
    expect(() => isForwardVersion('1.0.0', '1.0.0-beta')).toThrow("Invalid semver version: '1.0.0-beta'");
  });

  it('throws when a version is non-canonical (two-component)', () => {
    expect(() => isForwardVersion('1.0', '1.0.1')).toThrow("Invalid semver version: '1.0'");
  });

  it('throws when a version is empty', () => {
    expect(() => isForwardVersion('', '1.0.0')).toThrow("Invalid semver version: ''");
  });
});
