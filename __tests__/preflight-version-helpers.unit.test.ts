import { describe, expect, it } from 'vitest';

/**
 * Mirror of `compareVersions` from `.preflight/collections/nmr.ts`.
 *
 * Duplicated here because the collection script does not export its helpers.
 * Keep in sync with the source if the algorithm changes.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Mirror of the version-extraction regex from `hasMinDevDependencyVersion`. */
const versionRegex = /(\d+\.\d+\.\d+)/;

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('4.0.0', '4.0.0')).toBe(0);
  });

  it('returns positive when first version is greater (major)', () => {
    expect(compareVersions('5.0.0', '4.0.0')).toBeGreaterThan(0);
  });

  it('returns negative when first version is less (major)', () => {
    expect(compareVersions('3.0.0', '4.0.0')).toBeLessThan(0);
  });

  it('compares minor versions when majors are equal', () => {
    expect(compareVersions('4.1.0', '4.0.0')).toBeGreaterThan(0);
    expect(compareVersions('4.0.0', '4.1.0')).toBeLessThan(0);
  });

  it('compares patch versions when major and minor are equal', () => {
    expect(compareVersions('4.0.1', '4.0.0')).toBeGreaterThan(0);
    expect(compareVersions('4.0.0', '4.0.1')).toBeLessThan(0);
  });

  it('handles version below minimum across all components', () => {
    expect(compareVersions('3.9.5', '4.0.0')).toBeLessThan(0);
  });
});

describe('version extraction regex', () => {
  it('extracts version from a caret range', () => {
    expect(versionRegex.exec('^4.1.2')?.[1]).toBe('4.1.2');
  });

  it('extracts version from a tilde range', () => {
    expect(versionRegex.exec('~4.0.0')?.[1]).toBe('4.0.0');
  });

  it('extracts version from a bare version', () => {
    expect(versionRegex.exec('4.0.0')?.[1]).toBe('4.0.0');
  });

  it('extracts version from a gte range', () => {
    expect(versionRegex.exec('>=4.0.0')?.[1]).toBe('4.0.0');
  });

  it('returns null for non-numeric specifiers', () => {
    expect(versionRegex.exec('workspace:^')).toBeNull();
    expect(versionRegex.exec('latest')).toBeNull();
    expect(versionRegex.exec('*')).toBeNull();
  });
});
