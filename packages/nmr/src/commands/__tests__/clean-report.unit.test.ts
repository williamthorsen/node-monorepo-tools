import { describe, expect, it } from 'vitest';

import { renderCleanOutcome, renderCleanProgress } from '../clean-report.ts';

describe(renderCleanOutcome, () => {
  it.for([
    { style: 'plain', expected: 'Cleaned 2 packages.' },
    { style: 'rich', expected: '🧹 Cleaned 2 packages.' },
  ] as const)('closes a sweep in the $style style', ({ style, expected }) => {
    expect(
      renderCleanOutcome(
        { kind: 'sweep', checkResultsDir: '/repo', cleanedDirs: ['/repo/a', '/repo/b'], skippedCount: 0 },
        style,
      ),
    ).toBe(expected);
  });

  it('counts a single cleaned package in the singular, with the packages left to an empty override', () => {
    expect(
      renderCleanOutcome(
        { kind: 'sweep', checkResultsDir: '/repo', cleanedDirs: ['/repo/b'], skippedCount: 1 },
        'plain',
      ),
    ).toBe('Cleaned 1 package, skipping 1 with an empty clean override.');
  });

  it('closes nothing for a one-package clean', () => {
    expect(
      renderCleanOutcome({ kind: 'package', checkResultsDir: '/repo', packageDir: '/repo/a' }, 'rich'),
    ).toBeUndefined();
  });
});

describe(renderCleanProgress, () => {
  it.for([
    { style: 'plain', expected: 'Removed all recorded check results.' },
    { style: 'rich', expected: '🧹 Removed all recorded check results.' },
  ] as const)('reports the removal of the check results in the $style style', ({ style, expected }) => {
    expect(renderCleanProgress({ kind: 'check-results-removed' }, style)).toBe(expected);
  });

  it.for([
    { style: 'plain', expected: 'a: Removed build output and cache.' },
    { style: 'rich', expected: '🧹 a: Removed build output and cache.' },
  ] as const)('names a cleaned package by its directory in the $style style', ({ style, expected }) => {
    expect(renderCleanProgress({ kind: 'package-cleaned', packageDir: '/repo/packages/a' }, style)).toBe(expected);
  });
});
