import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { reportTestFileConventions } from '../tests.ts';

// Derived from this file's own location rather than from the function under test, so the assertion has a second
// opinion about where the root is.
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

// One violation of each half inside a directory only the caller's exclusions prune, and one of each outside it.
const FIXTURE_FILES = [
  'generated/__tests__/scaffold.test.ts',
  'generated/scaffold.unit.test.ts',
  'src/__tests__/plain.unit.test.ts',
  'src/__tests__/untiered.test.ts',
  'src/outside.unit.test.ts',
];

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  { scope: 'file' },
  makeFixture(() =>
    createTempTree(Object.fromEntries(FIXTURE_FILES.map((file) => [file, ''])), { prefix: 'nmr-conventions-' }),
  ),
);

describe(reportTestFileConventions, () => {
  // The silent failure the split exists to catch: Vitest starts the run in a package directory, and a sweep of that
  // directory alone reports clean over every violation elsewhere in the repo.
  it('sweeps the monorepo root when the caller names no directory', () => {
    expect(reportTestFileConventions().rootDir).toBe(REPO_ROOT);
  });

  it('sweeps the directory the caller names, reporting each half once', ({ tree }) => {
    expect(reportTestFileConventions({ rootDir: tree.dir })).toStrictEqual({
      misplaced: ['generated/scaffold.unit.test.ts', 'src/outside.unit.test.ts'],
      rootDir: tree.dir,
      untiered: ['generated/__tests__/scaffold.test.ts', 'src/__tests__/untiered.test.ts'],
    });
  });

  it('threads the exclusions to both halves', ({ tree }) => {
    expect(reportTestFileConventions({ exclude: ['generated'], rootDir: tree.dir })).toStrictEqual({
      misplaced: ['src/outside.unit.test.ts'],
      rootDir: tree.dir,
      untiered: ['src/__tests__/untiered.test.ts'],
    });
  });
});
