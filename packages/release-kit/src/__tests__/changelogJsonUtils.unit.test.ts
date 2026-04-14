import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractVersion, isChangelogEntry, readChangelogEntries } from '../changelogJsonUtils.ts';
import type { ChangelogEntry } from '../types.ts';

describe(isChangelogEntry, () => {
  it('returns true for a valid entry', () => {
    expect(isChangelogEntry({ version: '1.0.0', date: '2024-01-01', sections: [] })).toBe(true);
  });

  it('returns false when version is missing', () => {
    expect(isChangelogEntry({ date: '2024-01-01', sections: [] })).toBe(false);
  });

  it('returns false when sections is not an array', () => {
    expect(isChangelogEntry({ version: '1.0.0', date: '2024-01-01', sections: 'not-array' })).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isChangelogEntry('string')).toBe(false);
    expect(isChangelogEntry(null)).toBe(false);
    expect(isChangelogEntry(42)).toBe(false);
  });
});

describe(extractVersion, () => {
  it('strips v prefix from a simple tag', () => {
    expect(extractVersion('v1.2.3')).toBe('1.2.3');
  });

  it('strips scoped prefix from a monorepo tag', () => {
    expect(extractVersion('release-kit-v1.0.0')).toBe('1.0.0');
  });

  it('returns the full tag when no version pattern is found', () => {
    expect(extractVersion('not-a-version')).toBe('not-a-version');
  });

  it('preserves pre-release suffix', () => {
    expect(extractVersion('v1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });
});

describe(readChangelogEntries, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-read-entries-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns undefined when file does not exist', () => {
    expect(readChangelogEntries(join(tempDir, 'missing.json'))).toBeUndefined();
  });

  it('returns entries from a valid changelog JSON file', () => {
    const entries: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-01-01', sections: [] }];
    writeFileSync(join(tempDir, 'changelog.json'), JSON.stringify(entries), 'utf8');

    const result = readChangelogEntries(join(tempDir, 'changelog.json'));
    expect(result).toHaveLength(1);
    expect(result?.[0]?.version).toBe('1.0.0');
  });

  it('returns undefined when file contains non-array JSON', () => {
    writeFileSync(join(tempDir, 'changelog.json'), '{"not": "array"}', 'utf8');

    expect(readChangelogEntries(join(tempDir, 'changelog.json'))).toBeUndefined();
  });

  it('returns undefined when file contains malformed JSON', () => {
    writeFileSync(join(tempDir, 'changelog.json'), '{bad json', 'utf8');

    expect(readChangelogEntries(join(tempDir, 'changelog.json'))).toBeUndefined();
  });

  it('filters out invalid entries from the array', () => {
    const mixed = [{ version: '1.0.0', date: '2024-01-01', sections: [] }, { invalid: true }, 'not-an-object'];
    writeFileSync(join(tempDir, 'changelog.json'), JSON.stringify(mixed), 'utf8');

    const result = readChangelogEntries(join(tempDir, 'changelog.json'));
    expect(result).toHaveLength(1);
    expect(result?.[0]?.version).toBe('1.0.0');
  });
});
