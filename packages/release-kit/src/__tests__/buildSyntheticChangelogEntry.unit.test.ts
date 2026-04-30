import { describe, expect, it } from 'vitest';

import { buildSyntheticChangelogEntry } from '../buildSyntheticChangelogEntry.ts';

describe(buildSyntheticChangelogEntry, () => {
  it('produces a ChangelogEntry with a Dependency updates section', () => {
    const entry = buildSyntheticChangelogEntry(
      [{ packageName: '@scope/dep', newVersion: '2.0.0' }],
      '1.0.1',
      '2024-01-15',
    );

    expect(entry.version).toBe('1.0.1');
    expect(entry.date).toBe('2024-01-15');
    expect(entry.sections).toHaveLength(1);
    expect(entry.sections[0]?.title).toBe('Dependency updates');
    expect(entry.sections[0]?.audience).toBe('dev');
    expect(entry.sections[0]?.items[0]?.description).toBe('Bumped `@scope/dep` to 2.0.0');
  });

  it('produces one item per propagated-from dependency, in input order', () => {
    const entry = buildSyntheticChangelogEntry(
      [
        { packageName: '@scope/a', newVersion: '1.2.3' },
        { packageName: '@scope/b', newVersion: '4.5.6' },
      ],
      '2.0.0',
      '2024-02-01',
    );

    expect(entry.sections[0]?.items).toStrictEqual([
      { description: 'Bumped `@scope/a` to 1.2.3' },
      { description: 'Bumped `@scope/b` to 4.5.6' },
    ]);
  });

  it('produces an empty items list when no propagated-from entries are supplied', () => {
    const entry = buildSyntheticChangelogEntry([], '0.1.0', '2024-03-01');

    expect(entry.sections).toHaveLength(1);
    expect(entry.sections[0]?.items).toStrictEqual([]);
  });
});
