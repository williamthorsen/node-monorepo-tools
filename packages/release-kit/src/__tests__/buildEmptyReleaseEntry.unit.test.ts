import { describe, expect, it } from 'vitest';

import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';

describe(buildEmptyReleaseEntry, () => {
  it('produces a ChangelogEntry with a single Notes section', () => {
    const entry = buildEmptyReleaseEntry('1.0.1', '2026-05-06');

    expect(entry.version).toBe('1.0.1');
    expect(entry.date).toBe('2026-05-06');
    expect(entry.sections).toHaveLength(1);
    expect(entry.sections[0]?.title).toBe('Notes');
    expect(entry.sections[0]?.audience).toBe('dev');
  });

  it('produces a single Forced version bump. item', () => {
    const entry = buildEmptyReleaseEntry('2.0.0', '2026-05-06');

    expect(entry.sections[0]?.items).toStrictEqual([{ description: 'Forced version bump.' }]);
  });

  it('returns no extra top-level keys (round-trip safe)', () => {
    const entry = buildEmptyReleaseEntry('1.2.3', '2026-05-06');

    // eslint-disable-next-line unicorn/no-array-sort -- toSorted() requires Node 20; project targets Node 18.17+
    expect(Object.keys(entry).sort()).toStrictEqual(['date', 'sections', 'version']);
  });
});
