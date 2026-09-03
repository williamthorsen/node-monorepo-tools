import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { extractVersion, isChangelogEntry, readChangelogEntries } from '../changelogJsonUtils.ts';
import type { ChangelogEntry } from '../types.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'test-read-entries-' })),
);

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
  it('returns undefined when file does not exist', ({ tree }) => {
    expect(readChangelogEntries(join(tree.dir, 'missing.json'))).toBeUndefined();
  });

  it('returns entries from a valid changelog JSON file', ({ tree }) => {
    const entries: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-01-01', sections: [] }];
    const changelogPath = tree.writeJson('changelog.json', entries);

    const result = readChangelogEntries(changelogPath);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.version).toBe('1.0.0');
  });

  it('returns undefined when file contains non-array JSON', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{"not": "array"}');

    expect(readChangelogEntries(changelogPath)).toBeUndefined();
  });

  it('returns undefined when file contains malformed JSON', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{bad json');

    expect(readChangelogEntries(changelogPath)).toBeUndefined();
  });

  it('filters out invalid entries from the array', ({ tree }) => {
    const mixed = [{ version: '1.0.0', date: '2024-01-01', sections: [] }, { invalid: true }, 'not-an-object'];
    const changelogPath = tree.writeJson('changelog.json', mixed);

    const result = readChangelogEntries(changelogPath);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.version).toBe('1.0.0');
  });
});
