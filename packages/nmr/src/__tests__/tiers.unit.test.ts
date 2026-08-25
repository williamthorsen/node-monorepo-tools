import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { globSync } from 'tinyglobby';
import { describe, expect, it as baseIt } from 'vitest';

import {
  ALL_TEST_PATTERNS,
  findMisplacedTestFiles,
  findTestFiles,
  findUntieredTestFiles,
  hasTierInfix,
  TEST_COLLECTION_EXCLUDE,
  TIER_NAMES,
} from '../tiers.ts';

// Each file stands for a boundary the walk has to get right.
const FIXTURE_FILES = [
  '.readyup/kits/__tests__/kit.unit.test.ts', // under a dot-directory, which Vitest collects
  'coverage/__tests__/report.unit.test.ts', // under a pruned directory
  'dist/src/__tests__/copied.unit.test.ts', // under a pruned directory
  'dist/src/copied.unit.test.ts', // outside a test directory, but under a pruned one
  'generated/__tests__/scaffold.test.ts', // collected and untiered, until the caller prunes the directory
  'generated/scaffold.unit.test.ts', // outside a test directory, in that same caller-pruned directory
  'node_modules/pkg/__tests__/dep.unit.test.ts', // under a pruned directory
  'src/__tests__/fixtures/sample.txt', // inside a test directory, but not a test file
  'src/__tests__/nested/deep.unit.test.tsx', // nested below the test directory, and the tsx branch
  'src/__tests__/plain.unit.test.ts',
  'src/nested/outside.test.tsx', // outside a test directory and untiered, and the tsx branch
  'src/outside.unit.test.ts', // outside any test directory
];

const COLLECTED_FILES = [
  '.readyup/kits/__tests__/kit.unit.test.ts',
  'generated/__tests__/scaffold.test.ts',
  'src/__tests__/nested/deep.unit.test.tsx',
  'src/__tests__/plain.unit.test.ts',
];

const MISPLACED_FILES = ['generated/scaffold.unit.test.ts', 'src/nested/outside.test.tsx', 'src/outside.unit.test.ts'];

/** The directory neither prune set holds, so only what the caller passes can keep the walk out of it. */
const CALLER_EXCLUDE = ['generated'];

const it = baseIt
  .extend(
    'fixtureTree',
    { scope: 'file' },
    makeFixture(() =>
      createTempTree(Object.fromEntries(FIXTURE_FILES.map((file) => [file, ''])), { prefix: 'nmr-tiers-' }),
    ),
  )
  .extend(
    'emptyTree',
    { scope: 'file' },
    makeFixture(() => createTempTree({}, { prefix: 'nmr-tiers-empty-' })),
  );

describe(findMisplacedTestFiles, () => {
  it('reports every test file sitting outside a test directory', ({ fixtureTree }) => {
    expect(findMisplacedTestFiles(fixtureTree.dir)).toStrictEqual(MISPLACED_FILES);
  });

  // The same prune set as the collection half, so a copy of a misplaced file under build output is not a second
  // report of the same defect.
  it('prunes the directories the collection half prunes', ({ fixtureTree }) => {
    expect(findMisplacedTestFiles(fixtureTree.dir)).not.toContain('dist/src/copied.unit.test.ts');
  });

  it('prunes a directory the caller excludes', ({ fixtureTree }) => {
    expect(findMisplacedTestFiles(fixtureTree.dir, { exclude: CALLER_EXCLUDE })).toStrictEqual([
      'src/nested/outside.test.tsx',
      'src/outside.unit.test.ts',
    ]);
  });

  it('returns an empty list for a tree holding no test file', ({ emptyTree }) => {
    expect(findMisplacedTestFiles(emptyTree.dir)).toStrictEqual([]);
  });
});

describe(findTestFiles, () => {
  it('collects every test file the projects claim, and nothing else', ({ fixtureTree }) => {
    expect(findTestFiles(fixtureTree.dir)).toStrictEqual(COLLECTED_FILES);
  });

  // The divergence the walk exists to close: `node:fs` globSync skips this file, so a check built on the collection
  // pattern would report clean while the file runs untiered under the residual project.
  it('descends into a dot-directory', ({ fixtureTree }) => {
    expect(findTestFiles(fixtureTree.dir)).toContain('.readyup/kits/__tests__/kit.unit.test.ts');
  });

  // Pinned against the engine Vitest discovers with, because over-reporting is a failure a consumer cannot fix and
  // under-reporting is the silence a conformance check exists to end.
  it('agrees with the collection pattern about which files are in scope', ({ fixtureTree }) => {
    const globbed = globSync(ALL_TEST_PATTERNS, {
      cwd: fixtureTree.dir,
      dot: true,
      ignore: TEST_COLLECTION_EXCLUDE.map((dir) => `**/${dir}/**`),
    });

    expect(globbed.toSorted()).toStrictEqual(findTestFiles(fixtureTree.dir));
  });

  it('returns an empty list for a tree holding no test file', ({ emptyTree }) => {
    expect(findTestFiles(emptyTree.dir)).toStrictEqual([]);
  });

  it('prunes a directory the caller excludes, at any depth', ({ fixtureTree }) => {
    expect(findTestFiles(fixtureTree.dir, { exclude: CALLER_EXCLUDE })).toStrictEqual([
      '.readyup/kits/__tests__/kit.unit.test.ts',
      'src/__tests__/nested/deep.unit.test.tsx',
      'src/__tests__/plain.unit.test.ts',
    ]);
  });
});

describe(findUntieredTestFiles, () => {
  it('reports a collected file whose name selects no tier', ({ fixtureTree }) => {
    expect(findUntieredTestFiles(fixtureTree.dir)).toStrictEqual(['generated/__tests__/scaffold.test.ts']);
  });

  // A file that is both untiered and misplaced belongs to the placement half, which names the remedy that fixes it.
  it('leaves a misplaced file to the placement half', ({ fixtureTree }) => {
    expect(findUntieredTestFiles(fixtureTree.dir)).not.toContain('src/nested/outside.test.tsx');
  });

  it('prunes a directory the caller excludes', ({ fixtureTree }) => {
    expect(findUntieredTestFiles(fixtureTree.dir, { exclude: CALLER_EXCLUDE })).toStrictEqual([]);
  });

  it('returns an empty list for a tree holding no test file', ({ emptyTree }) => {
    expect(findUntieredTestFiles(emptyTree.dir)).toStrictEqual([]);
  });
});

describe(hasTierInfix, () => {
  it.each(TIER_NAMES)('accepts the %s tier', (tier) => {
    expect(hasTierInfix(`thing.${tier}.test.ts`)).toBe(true);
  });

  it('accepts a tsx file', () => {
    expect(hasTierInfix('thing.unit.test.tsx')).toBe(true);
  });

  // The aspect segment is free-form documentation, so a name carrying one still names its tier.
  it('accepts a name carrying an aspect segment ahead of the tier', () => {
    expect(hasTierInfix('scaffold.packaged.unit.test.ts')).toBe(true);
  });

  it('reads the tier from the basename of a path', () => {
    expect(hasTierInfix('packages/nmr/src/__tests__/thing.tool.test.ts')).toBe(true);
  });

  it('rejects a name carrying no infix at all', () => {
    expect(hasTierInfix('thing.test.ts')).toBe(false);
  });

  it('rejects a misspelt tier', () => {
    expect(hasTierInfix('thing.uint.test.ts')).toBe(false);
  });

  // Only the segment immediately before `.test.` selects a project, so a tier name sitting further left is an aspect.
  it('rejects a tier name displaced from the selecting segment', () => {
    expect(hasTierInfix('thing.tool.smoke.test.ts')).toBe(false);
  });
});
