import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyChangelogOverrides,
  formatStaleOverrideKeyWarning,
  loadChangelogOverrides,
  validateChangelogOverrides,
} from '../changelogOverrides.ts';
import type { ChangelogEntry } from '../types.ts';

describe(loadChangelogOverrides, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-overrides-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty map when the file does not exist', () => {
    const result = loadChangelogOverrides(join(tempDir, 'missing.json'));
    expect(result).toStrictEqual({ overrides: new Map() });
  });

  it('returns an error when the file contains malformed JSON', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(filePath, '{not-valid', 'utf8');

    const result = loadChangelogOverrides(filePath);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatch(/Failed to parse override file/);
  });

  it('returns an error when the top-level JSON is not an object', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(filePath, '[]', 'utf8');

    const result = loadChangelogOverrides(filePath);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatch(/top-level value must be an object/);
  });

  it('parses a valid override file into a Map', () => {
    const filePath = join(tempDir, 'overrides.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        '8296231': { audience: 'skip' },
        abc1234d: { body: 'Replacement body' },
      }),
      'utf8',
    );

    const result = loadChangelogOverrides(filePath);
    expect('overrides' in result).toBe(true);
    if (!('overrides' in result)) return;
    expect(result.overrides.get('8296231')).toStrictEqual({ audience: 'skip' });
    expect(result.overrides.get('abc1234d')).toStrictEqual({ body: 'Replacement body' });
  });
});

describe(validateChangelogOverrides, () => {
  it('rejects a non-record top-level value', () => {
    const result = validateChangelogOverrides(42);
    expect(result.errors).toContain('Override file: top-level value must be an object keyed by commit hash');
  });

  it('rejects a non-record entry value', () => {
    const result = validateChangelogOverrides({ abc: 'not-an-object' });
    expect(result.errors).toContain("overrides['abc']: must be an object");
  });

  it('rejects unknown fields with the offending key in the error message', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip', unknown: true } });
    expect(result.errors).toContain("overrides['abc']: unknown field 'unknown'");
  });

  it('rejects an entry with no fields', () => {
    const result = validateChangelogOverrides({ abc: {} });
    expect(result.errors).toContain("overrides['abc']: at least one override field must be set");
  });

  it("accepts audience: 'skip' as the v1-supported value", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip' } });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ audience: 'skip' });
  });

  it("rejects audience: 'all' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'all' } });
    expect(result.errors[0]).toMatch(/audience 'all' is not yet supported/);
  });

  it("rejects audience: 'dev' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'dev' } });
    expect(result.errors[0]).toMatch(/audience 'dev' is not yet supported/);
  });

  it('rejects an unknown audience value with the union enumerated', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'maybe' } });
    expect(result.errors[0]).toMatch(/'audience' must be one of 'all' \| 'dev' \| 'skip'/);
  });

  it('rejects non-string description', () => {
    const result = validateChangelogOverrides({ abc: { description: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'description' must be a string");
  });

  it('rejects non-string body', () => {
    const result = validateChangelogOverrides({ abc: { body: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'body' must be a string");
  });

  it('rejects non-boolean breaking', () => {
    const result = validateChangelogOverrides({ abc: { breaking: 'yes' } });
    expect(result.errors).toContain("overrides['abc']: 'breaking' must be a boolean");
  });

  it('parses an entry with description, body, and breaking fields', () => {
    const result = validateChangelogOverrides({
      abc: { description: 'New', body: 'Detail', breaking: true },
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ description: 'New', body: 'Detail', breaking: true });
  });

  it('rejects an empty-string key', () => {
    const result = validateChangelogOverrides({ '': { audience: 'skip' } });
    expect(result.errors[0]).toMatch(/empty-string key/);
  });
});

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

  it('omits a zero-match key from matchedKeys (caller decides whether to warn)', () => {
    const entries = [makeEntry(['abc111'])];
    const overrides = new Map([['xyz999', { description: 'Stale' }]]);
    const result = applyChangelogOverrides(entries, overrides);
    // The applier no longer emits per-batch zero-match warnings; the orchestrator
    // aggregates `matchedKeys` across batches and warns on globally-stale keys exactly once.
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

  it('passes synthetic items (no hash) through untouched', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Dependency updates',
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

  it('reports each matched key in matchedKeys with no warnings or errors', () => {
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

  it('omits ambiguous-prefix keys from matchedKeys and surfaces an error instead', () => {
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
