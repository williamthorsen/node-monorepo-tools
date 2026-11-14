import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  describeChangelogFileProblem,
  extractVersion,
  isChangelogEntry,
  loadChangelogEntries,
  readChangelogEntries,
} from '../changelogJsonUtils.ts';
import type { ChangelogEntry } from '../types.ts';

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

  it('returns the full tag when the tag does not contain a version pattern', () => {
    expect(extractVersion('not-a-version')).toBe('not-a-version');
  });

  it('preserves pre-release suffix', () => {
    expect(extractVersion('v1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });
});

describe(describeChangelogFileProblem, () => {
  it('names a missing file as not found', () => {
    expect(describeChangelogFileProblem('missing', '.meta/changelog.json')).toBe('.meta/changelog.json not found');
  });

  it('names an unreadable file as unparseable', () => {
    expect(describeChangelogFileProblem('unreadable', '.meta/changelog.json')).toBe(
      'could not parse .meta/changelog.json',
    );
  });
});

describe(loadChangelogEntries, () => {
  it('reports a missing file as missing', ({ tree }) => {
    expect(loadChangelogEntries(join(tree.dir, 'missing.json'))).toStrictEqual({ status: 'missing' });
  });

  it('returns the valid entries of a changelog JSON file and counts the rejected ones', ({ tree }) => {
    const entries: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-01-01', sections: [] }];
    const changelogPath = tree.writeJson('changelog.json', [...entries, { invalid: true }, 'not-an-object']);

    expect(loadChangelogEntries(changelogPath)).toStrictEqual({ status: 'loaded', entries, rejectedCount: 2 });
  });

  it('reports a rejected count of zero when every element is an entry', ({ tree }) => {
    const entries: ChangelogEntry[] = [{ version: '1.0.0', date: '2024-01-01', sections: [] }];
    const changelogPath = tree.writeJson('changelog.json', entries);

    expect(loadChangelogEntries(changelogPath)).toStrictEqual({ status: 'loaded', entries, rejectedCount: 0 });
  });

  it('reports malformed JSON as unreadable, with the parser message as the reason', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{bad json');

    expect(loadChangelogEntries(changelogPath)).toStrictEqual({
      status: 'unreadable',
      reason: expect.stringContaining('JSON'),
    });
  });

  it('reports non-array JSON as unreadable', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{"not": "array"}');

    expect(loadChangelogEntries(changelogPath)).toStrictEqual({
      status: 'unreadable',
      reason: 'the top-level value is not an array',
    });
  });

  it('reports a path that cannot be read as a file as unreadable, with the read error as the reason', ({ tree }) => {
    const directoryPath = tree.write('changelog.json/placeholder', '');

    expect(loadChangelogEntries(join(directoryPath, '..'))).toStrictEqual({
      status: 'unreadable',
      reason: expect.stringContaining('EISDIR'),
    });
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
    const mixedEntries = [{ version: '1.0.0', date: '2024-01-01', sections: [] }, { invalid: true }, 'not-an-object'];
    const changelogPath = tree.writeJson('changelog.json', mixedEntries);

    const result = readChangelogEntries(changelogPath);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.version).toBe('1.0.0');
  });
});
