import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { globSync } from 'tinyglobby';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TEST_PATTERNS, findTestFiles, hasTierInfix, TEST_COLLECTION_EXCLUDE, TIER_NAMES } from '../tiers.ts';

// Each file stands for a boundary the walk has to get right.
const FIXTURE_FILES = [
  '.readyup/kits/__tests__/kit.unit.test.ts', // under a dot-directory, which Vitest collects
  'coverage/__tests__/report.unit.test.ts', // under a pruned directory
  'dist/src/__tests__/copied.unit.test.ts', // under a pruned directory
  'node_modules/pkg/__tests__/dep.unit.test.ts', // under a pruned directory
  'src/__tests__/fixtures/sample.txt', // inside a test directory, but not a test file
  'src/__tests__/nested/deep.unit.test.tsx', // nested below the test directory, and the tsx branch
  'src/__tests__/plain.unit.test.ts',
  'src/outside.unit.test.ts', // outside any test directory
];

const COLLECTED_FILES = [
  '.readyup/kits/__tests__/kit.unit.test.ts',
  'src/__tests__/nested/deep.unit.test.tsx',
  'src/__tests__/plain.unit.test.ts',
];

describe(findTestFiles, () => {
  let fixtureRoot: string;
  let emptyRoot: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'nmr-tiers-'));
    for (const file of FIXTURE_FILES) {
      const absolute = path.join(fixtureRoot, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, '');
    }

    emptyRoot = mkdtempSync(path.join(tmpdir(), 'nmr-tiers-empty-'));
  });

  afterAll(() => {
    for (const dir of [fixtureRoot, emptyRoot]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collects every test file the projects claim, and nothing else', () => {
    expect(findTestFiles(fixtureRoot)).toStrictEqual(COLLECTED_FILES);
  });

  // The divergence the walk exists to close: `node:fs` globSync skips this file, so a check built on the collection
  // pattern would report clean while the file runs untiered under the residual project.
  it('descends into a dot-directory', () => {
    expect(findTestFiles(fixtureRoot)).toContain('.readyup/kits/__tests__/kit.unit.test.ts');
  });

  // Pinned against the engine Vitest discovers with, because over-reporting is a failure a consumer cannot fix and
  // under-reporting is the silence a conformance check exists to end.
  it('agrees with the collection pattern about which files are in scope', () => {
    const globbed = globSync(ALL_TEST_PATTERNS, {
      cwd: fixtureRoot,
      dot: true,
      ignore: TEST_COLLECTION_EXCLUDE.map((dir) => `**/${dir}/**`),
    });

    expect(globbed.toSorted()).toStrictEqual(findTestFiles(fixtureRoot));
  });

  it('returns an empty list for a tree holding no test file', () => {
    expect(findTestFiles(emptyRoot)).toStrictEqual([]);
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
