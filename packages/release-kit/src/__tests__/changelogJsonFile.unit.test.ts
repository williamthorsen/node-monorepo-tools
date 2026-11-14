import { join } from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from '../changelogJsonFile.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import type { ChangelogEntry } from '../types.ts';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'test-merge-entries-' })),
);

const FIX = "Repair or delete the file, then rerun 'release-kit prepare'.";
const newEntry: ChangelogEntry = { version: '2.0.0', date: '2024-02-01', sections: [] };
const existingEntry: ChangelogEntry = { version: '1.0.0', date: '2024-01-01', sections: [] };

describe(mergeChangelogEntriesWithDisk, () => {
  it('merges the new entries with the entries on disk, newest-first', ({ tree }) => {
    const changelogPath = tree.writeJson('changelog.json', [existingEntry]);

    expect(mergeChangelogEntriesWithDisk(changelogPath, [newEntry])).toStrictEqual([newEntry, existingEntry]);
  });

  it('treats a missing file as empty', ({ tree }) => {
    expect(mergeChangelogEntriesWithDisk(join(tree.dir, 'changelog.json'), [newEntry])).toStrictEqual([newEntry]);
  });

  it('refuses an unparseable file, naming the file and the fix', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{bad json');

    const merge = () => mergeChangelogEntriesWithDisk(changelogPath, [newEntry]);

    expect(merge).toThrow(UserError);
    expect(merge).toThrow(`Cannot prepare the changelog from ${changelogPath}: `);
    expect(merge).toThrow(FIX);
  });

  it('refuses a file whose top-level value is not an array', ({ tree }) => {
    const changelogPath = tree.write('changelog.json', '{"not": "array"}');

    expect(() => mergeChangelogEntriesWithDisk(changelogPath, [newEntry])).toThrow(
      `Cannot prepare the changelog from ${changelogPath}: the top-level value is not an array. ${FIX}`,
    );
  });

  it('refuses a file that contains elements that are not entries, with their count', ({ tree }) => {
    const changelogPath = tree.writeJson('changelog.json', [existingEntry, { invalid: true }, 'not-an-object']);

    expect(() => mergeChangelogEntriesWithDisk(changelogPath, [newEntry])).toThrow(
      `Cannot prepare the changelog from ${changelogPath}: 2 elements are not changelog entries. ${FIX}`,
    );
  });
});

describe(renderChangelogJson, () => {
  it('orders entries newest-first regardless of input order', () => {
    const renderedJson = renderChangelogJson([
      { version: '1.0.0', date: '2024-01-01', sections: [] },
      { version: '2.0.0', date: '2024-02-01', sections: [] },
    ]);

    const parsedJson: unknown = JSON.parse(renderedJson);
    expect(parsedJson).toStrictEqual([
      { version: '2.0.0', date: '2024-02-01', sections: [] },
      { version: '1.0.0', date: '2024-01-01', sections: [] },
    ]);
  });

  it('ends with a trailing newline', () => {
    expect(renderChangelogJson([{ version: '1.0.0', date: '2024-01-01', sections: [] }])).toMatch(/\n$/);
  });

  it('renders an empty entry list as an empty array', () => {
    expect(renderChangelogJson([])).toBe('[]\n');
  });
});

describe(resolveChangelogJsonPath, () => {
  it('joins the changelog path with the config-supplied output path', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: '.meta/changelog.json' } };
    expect(resolveChangelogJsonPath(config, 'packages/arrays')).toBe('packages/arrays/.meta/changelog.json');
  });

  it('honours a custom outputPath', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: 'docs/changelog.json' } };
    expect(resolveChangelogJsonPath(config, '.')).toBe('docs/changelog.json');
  });
});
