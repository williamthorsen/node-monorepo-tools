import { describe, expect, it } from 'vitest';

import { applyChangelogOverrides, formatStaleOverrideKeyWarning } from '../applyChangelogOverrides.ts';
import type { ChangelogEntry, ChangelogOverride } from '../types.ts';

describe(applyChangelogOverrides, () => {
  function makeEntry(hashes: string[]): ChangelogEntry {
    return {
      version: '1.0.0',
      date: '2024-01-01',
      sections: [
        {
          title: 'Features',
          audience: 'all',
          items: hashes.map((hash) => ({ description: `Item ${hash}`, hash })),
        },
      ],
    };
  }

  function makeEntryFromItems(...items: [hash: string, entry: number][]): ChangelogEntry {
    return {
      version: '1.0.0',
      date: '2024-01-01',
      sections: [
        {
          title: 'Features',
          audience: 'all',
          items: items.map(([hash, entry]) => ({ description: `Item ${hash}:${entry}`, hash, entry })),
        },
      ],
    };
  }

  it('returns a fresh-array no-op when overrides map is empty', () => {
    const entries = [makeEntry(['abc1234'])];
    const result = applyChangelogOverrides(entries, new Map());
    expect(result.entries).not.toBe(entries);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc1234');
    expect(result.warnings).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
  });

  it('matches a full hash and applies the override', () => {
    const entries = [makeEntry(['abc1234567890'])];
    const overrides = new Map([['abc1234567890', { description: 'Replacement description' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Replacement description');
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual(['abc1234567890']);
  });

  it('matches a short prefix when only one hash starts with it', () => {
    const entries = [makeEntry(['abc1234567890', 'def4567890'])];
    const overrides = new Map([['abc12', { description: 'Short-prefix match' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Short-prefix match');
    expect(result.entries[0]?.sections[0]?.items[1]?.description).toBe('Item def4567890');
  });

  it('reports an error when a prefix matches multiple hashes', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([['abc', { description: 'Ambiguous' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors[0]).toMatch(/ambiguous/);
    expect(result.errors[0]).toContain('abc111');
    expect(result.errors[0]).toContain('abc222');
    // No mutation when ambiguous.
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc111');
  });

  it('applies a bare key to every item of the commit', () => {
    const entries = [makeEntryFromItems(['abc111', 1], ['abc111', 2], ['def222', 1])];
    const overrides = new Map([['abc', { audience: 'skip' as const }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual(['abc']);
    expect(result.entries[0]?.sections[0]?.items.map((item) => item.description)).toStrictEqual(['Item def222:1']);
  });

  it('applies an ordinal key to the item derived from that entry alone', () => {
    const entries = [makeEntryFromItems(['abc111', 1], ['abc111', 2])];
    const overrides = new Map([['abc:2', { description: 'Second, reworded' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual(['abc:2']);
    expect(result.entries[0]?.sections[0]?.items.map((item) => item.description)).toStrictEqual([
      'Item abc111:1',
      'Second, reworded',
    ]);
  });

  it.each([
    [{ description: 'Reworded' }, 'description'],
    [{ body: 'Reworded' }, 'body'],
    [{ description: 'Reworded', body: 'Reworded' }, 'description and body'],
  ])('reports a bare key that sets %j on a commit with several items, naming the ordinal keys', (override, fields) => {
    const entries = [makeEntryFromItems(['abc111', 2], ['abc111', 1])];
    const result = applyChangelogOverrides(entries, new Map([['abc', override]]));
    expect(result.errors).toStrictEqual([
      `Override key 'abc' sets ${fields} on a commit with several items; use abc:1, abc:2`,
    ]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries[0]?.sections[0]?.items.map((item) => item.description)).toStrictEqual([
      'Item abc111:2',
      'Item abc111:1',
    ]);
  });

  it('omits an ordinal key whose entry position the commit lacks from matchedKeys', () => {
    const entries = [makeEntryFromItems(['abc111', 1], ['abc111', 2])];
    const result = applyChangelogOverrides(entries, new Map([['abc:3', { audience: 'skip' as const }]]));
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries[0]?.sections[0]?.items).toHaveLength(2);
  });

  it('never matches an ordinal key to a title-derived item', () => {
    const entries = [makeEntry(['abc111'])];
    const result = applyChangelogOverrides(entries, new Map([['abc:1', { audience: 'skip' as const }]]));
    expect(result.errors).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries[0]?.sections[0]?.items).toHaveLength(1);
  });

  it('reports an error when the prefix of an ordinal key matches multiple hashes', () => {
    const entries = [makeEntryFromItems(['abc111', 1], ['abc222', 1])];
    const result = applyChangelogOverrides(entries, new Map([['abc:1', { audience: 'skip' as const }]]));
    expect(result.errors).toStrictEqual([
      "Override key 'abc:1' is ambiguous: matches multiple commits (abc111, abc222). Use a longer prefix or the full commit hash.",
    ]);
    expect(result.matchedKeys).toStrictEqual([]);
  });

  it('reports a bare key and an ordinal key that match the same item, and applies neither', () => {
    const entries = [makeEntryFromItems(['abc111', 1], ['abc111', 2])];
    const overrides = new Map<string, ChangelogOverride>([
      ['abc', { breaking: true }],
      ['abc111:2', { description: 'Second, reworded' }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors).toStrictEqual([
      "Override keys 'abc' and 'abc111:2' both match the item at abc111:2; keep one",
    ]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries).toStrictEqual(entries);
  });

  it('reports two different prefixes of one commit, naming both keys', () => {
    const entries = [makeEntry(['abc111'])];
    const overrides = new Map<string, ChangelogOverride>([
      ['abc', { audience: 'skip' }],
      ['abc111', { description: 'Reworded' }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.errors).toStrictEqual(["Override keys 'abc' and 'abc111' both match commit abc111; keep one"]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries).toStrictEqual(entries);
  });

  it('omits a zero-match key from matchedKeys (caller decides whether to warn)', () => {
    const entries = [makeEntry(['abc111'])];
    const overrides = new Map([['xyz999', { description: 'Stale' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    // The applier doesn't emit any per-batch zero-match warnings; the orchestrator aggregates
    // `matchedKeys` across batches and warns on each globally stale key exactly once.
    expect(result.warnings).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Item abc111');
  });

  it("drops an item when audience is 'skip'", () => {
    const entries = [makeEntry(['abc1234'])];
    const overrides = new Map([['abc1234', { audience: 'skip' as const }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections).toHaveLength(0);
  });

  it('prunes a section that becomes empty after skipping its only item', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          { title: 'Features', audience: 'all', items: [{ description: 'Item 1', hash: 'abc111' }] },
          { title: 'Bug fixes', audience: 'all', items: [{ description: 'Item 2', hash: 'def222' }] },
        ],
      },
    ];
    const overrides = new Map([['abc111', { audience: 'skip' as const }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections).toHaveLength(1);
    expect(result.entries[0]?.sections[0]?.title).toBe('Bug fixes');
  });

  it('keeps the version visible even when all sections are pruned', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([
      ['abc111', { audience: 'skip' as const }],
      ['abc222', { audience: 'skip' as const }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.sections).toHaveLength(0);
  });

  it('overrides the body of a single item', () => {
    const entries = [makeEntry(['abc1234'])];
    const overrides = new Map([['abc1234', { body: 'Cleaned-up body text' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.body).toBe('Cleaned-up body text');
  });

  it('re-derives migration from a replacement body', () => {
    const entries = [makeEntry(['abc1234'])];
    const overrides = new Map([['abc1234', { body: 'Reworded.\n\nMigration: Import from the new subpath.' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.migration).toBe('Import from the new subpath.');
  });

  it("clears a migration that the superseded body contained when the replacement doesn't contain one", () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [
              {
                description: 'Item abc1234',
                body: 'Migration: Import from the old subpath.',
                migration: 'Import from the old subpath.',
                hash: 'abc1234',
              },
            ],
          },
        ],
      },
    ];
    const overrides = new Map([['abc1234', { body: 'Reworded, with no migration step.' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]).not.toHaveProperty('migration');
  });

  it('leaves migration alone when the override does not replace the body', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [
              {
                description: 'Item abc1234',
                body: 'Migration: Import from the new subpath.',
                migration: 'Import from the new subpath.',
                hash: 'abc1234',
              },
            ],
          },
        ],
      },
    ];
    const overrides = new Map([['abc1234', { description: 'Reworded headline' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.migration).toBe('Import from the new subpath.');
  });

  it("keeps each change-record entry's migration when a body override applies to its item", () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [
              { description: 'First', migration: 'Rename `a` to `b`.', hash: 'abc1234', entry: 1 },
              { description: 'Second', hash: 'abc1234', entry: 2 },
            ],
          },
        ],
      },
    ];
    const overrides = new Map([
      ['abc1234:1', { body: 'Migration: Replaced prose.' }],
      ['abc1234:2', { body: 'Migration: Replaced prose.' }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items).toStrictEqual([
      {
        description: 'First',
        body: 'Migration: Replaced prose.',
        migration: 'Rename `a` to `b`.',
        hash: 'abc1234',
        entry: 1,
      },
      { description: 'Second', body: 'Migration: Replaced prose.', hash: 'abc1234', entry: 2 },
    ]);
  });

  it('toggles breaking on an existing item', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [{ description: 'Item', hash: 'abc1234', breaking: true }],
          },
        ],
      },
    ];
    const overrides = new Map([['abc1234', { breaking: false }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.breaking).toBe(false);
  });

  it('passes synthetic items (without a hash) through untouched', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: '📦 Dependencies',
            audience: 'dev',
            items: [{ description: 'Bumped foo to 1.0.0' }],
          },
        ],
      },
    ];
    const overrides = new Map([['anything', { description: 'Should not match' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.entries[0]?.sections[0]?.items[0]?.description).toBe('Bumped foo to 1.0.0');
    expect(result.warnings).toStrictEqual([]);
    expect(result.matchedKeys).toStrictEqual([]);
  });

  it('reports each matched key in matchedKeys without any warnings or errors', () => {
    const entries = [makeEntry(['abc1234', 'def5678'])];
    const overrides = new Map([
      ['abc1234', { description: 'First' }],
      ['def5678', { description: 'Second' }],
    ]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(new Set(result.matchedKeys)).toStrictEqual(new Set(['abc1234', 'def5678']));
    expect(result.warnings).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
  });

  it('omits ambiguous-prefix keys from matchedKeys and reports an error instead', () => {
    const entries = [makeEntry(['abc111', 'abc222'])];
    const overrides = new Map([['abc', { description: 'Ambiguous' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    expect(result.matchedKeys).toStrictEqual([]);
    expect(result.errors[0]).toMatch(/ambiguous/);
  });

  it('does not mutate the input entries (purity check)', () => {
    const entries = [makeEntry(['abc1234'])];
    const snapshot = structuredClone(entries);
    const overrides = new Map([['abc1234', { description: 'Replacement' }]]);
    applyChangelogOverrides(entries, overrides);
    expect(entries).toStrictEqual(snapshot);
  });
});

describe(formatStaleOverrideKeyWarning, () => {
  it('includes the offending key and a stale-reference hint', () => {
    const message = formatStaleOverrideKeyWarning('abc1234');
    expect(message).toContain("'abc1234'");
    expect(message).toMatch(/stale reference/);
  });
});
