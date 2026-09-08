import { describe, expect, it } from 'vitest';

import { interpretSelectionProbe } from '../filter-selection.ts';

const SELECTED = JSON.stringify([{ name: '@scope/pkg', path: '/repo/packages/pkg', version: '1.0.0' }]);

describe(interpretSelectionProbe, () => {
  it('reads a resolved selection of no projects as empty', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: '[]' })).toBe('empty');
  });

  it('reads a resolved selection of one project as selected', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: SELECTED })).toBe('selected');
  });

  // The failing exit is what pnpm reports a rejected selector with, and the delegate reports it again.
  it('leaves a selector pnpm rejected unresolved', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 1, stdout: '' })).toBe('unresolved');
  });

  it('leaves a probe that never ran unresolved', () => {
    const error = new Error('spawn pnpm ENOENT');

    expect(interpretSelectionProbe({ error, status: null, stdout: '' })).toBe('unresolved');
  });

  it('leaves output that does not parse unresolved', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: 'Scope: 0 of 24\n' })).toBe('unresolved');
  });

  // A future pnpm reporting an object rather than an array has not said the selection is empty.
  it('leaves parsed output that is not an array unresolved', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: '{}' })).toBe('unresolved');
  });
});
