import { describe, expect, it } from 'vitest';

import { interpretDelegateProbe, interpretSelectionProbe } from '../filter-selection.ts';

const MONOREPO_ROOT = '/repo';

const ROOT_ENTRY = { name: 'repo', path: MONOREPO_ROOT, version: '0.0.0' };
const PACKAGE_ENTRY = { name: '@scope/pkg', path: '/repo/packages/pkg', version: '1.0.0' };
const OTHER_PACKAGE_ENTRY = { name: '@scope/other', path: '/repo/packages/other', version: '1.0.0' };

describe(interpretSelectionProbe, () => {
  it('reads a resolved selection of no projects as empty', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: '[]' }, MONOREPO_ROOT)).toBe('empty');
  });

  it('reads a resolved selection of one package as single', () => {
    const stdout = JSON.stringify([PACKAGE_ENTRY]);

    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout }, MONOREPO_ROOT)).toBe('single');
  });

  it('reads a resolved selection of two packages as multiple', () => {
    const stdout = JSON.stringify([PACKAGE_ENTRY, OTHER_PACKAGE_ENTRY]);

    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout }, MONOREPO_ROOT)).toBe('multiple');
  });

  // The listing counts the root wherever the filter leaves it standing; the delegate runs there only where the
  // pattern selects it positively, so this reading is the delegate's to settle.
  it('reads a selection of the root project alone as root-only', () => {
    const stdout = JSON.stringify([ROOT_ENTRY]);

    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout }, MONOREPO_ROOT)).toBe('root-only');
  });

  // The listed root may not run, so it does not count toward a second scope.
  it('reads the root beside one package as single', () => {
    const stdout = JSON.stringify([ROOT_ENTRY, PACKAGE_ENTRY]);

    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout }, MONOREPO_ROOT)).toBe('single');
  });

  it('reads the root beside two packages as multiple', () => {
    const stdout = JSON.stringify([ROOT_ENTRY, PACKAGE_ENTRY, OTHER_PACKAGE_ENTRY]);

    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout }, MONOREPO_ROOT)).toBe('multiple');
  });

  // The failing exit is what pnpm reports a rejected selector with, and the delegate reports it again.
  it('leaves a selector pnpm rejected unresolved', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 1, stdout: '' }, MONOREPO_ROOT)).toBe('unresolved');
  });

  it('leaves a probe that never ran unresolved', () => {
    const error = new Error('spawn pnpm ENOENT');

    expect(interpretSelectionProbe({ error, status: null, stdout: '' }, MONOREPO_ROOT)).toBe('unresolved');
  });

  it('leaves output that does not parse unresolved', () => {
    const probe = { error: undefined, status: 0, stdout: 'Scope: 0 of 24\n' };

    expect(interpretSelectionProbe(probe, MONOREPO_ROOT)).toBe('unresolved');
  });

  // A future pnpm reporting an object rather than an array has not said the selection is empty.
  it('leaves parsed output that is not an array unresolved', () => {
    expect(interpretSelectionProbe({ error: undefined, status: 0, stdout: '{}' }, MONOREPO_ROOT)).toBe('unresolved');
  });
});

describe(interpretDelegateProbe, () => {
  it('reads a run that reached a scope as single', () => {
    expect(interpretDelegateProbe({ error: undefined, status: 0, stdout: 'nmr-selected-scope' })).toBe('single');
  });

  it('reads a run that reached no scope as empty', () => {
    expect(interpretDelegateProbe({ error: undefined, status: 0, stdout: '' })).toBe('empty');
  });

  it('leaves a run pnpm failed unresolved', () => {
    expect(interpretDelegateProbe({ error: undefined, status: 1, stdout: '' })).toBe('unresolved');
  });

  it('leaves a run that never started unresolved', () => {
    const error = new Error('spawn pnpm ENOENT');

    expect(interpretDelegateProbe({ error, status: null, stdout: '' })).toBe('unresolved');
  });
});
