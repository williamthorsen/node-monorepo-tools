import { describe, expect, it } from 'vitest';

import { formatSyncResult } from '../format-sync.ts';

describe(formatSyncResult, () => {
  it('lists each added advisory with its chains and each removed advisory by ID', () => {
    const text = formatSyncResult({
      added: [{ id: 'GHSA-new', paths: ['a>minimatch', 'b>minimatch'], url: 'https://example.com/new' }],
      kept: [{ id: 'GHSA-kept', url: 'https://example.com/kept' }],
      removed: [{ id: 'GHSA-gone', url: 'https://example.com/gone' }],
      scope: 'dev',
    });

    expect(text).toBe(
      [
        '',
        '--- dev ---',
        '  added: 1',
        '    GHSA-new',
        '      a>minimatch',
        '      b>minimatch',
        '  kept: 1',
        '  removed: 1',
        '    GHSA-gone',
        '',
      ].join('\n'),
    );
  });

  it('prints only the counts when nothing was added or removed', () => {
    const text = formatSyncResult({ added: [], kept: [], removed: [], scope: 'prod' });

    expect(text).toBe('\n--- prod ---\n  added: 0\n  kept: 0\n  removed: 0\n');
  });
});
