import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { stageFixtureFiles } from '../test-utils/stageFixtureFiles.ts';
import { findMisplacedTestFiles, findTestFiles, findUntieredTestFiles } from '../tiers.ts';

describe('the test-file sweeps in a git repository', () => {
  it('reports nothing from a directory git ignores', () => {
    const { dir } = buildStagedTree({
      '.gitignore': '.netlify/\n',
      '.netlify/edge-functions/utils.test.ts': '',
      '.netlify/__tests__/untiered.test.ts': '',
      'src/__tests__/kept.unit.test.ts': '',
    });

    expect(findTestFiles(dir)).toStrictEqual(['src/__tests__/kept.unit.test.ts']);
    expect(findMisplacedTestFiles(dir)).toStrictEqual([]);
    expect(findUntieredTestFiles(dir)).toStrictEqual([]);
  });

  it('reports nothing from an ignored file inside a directory holding tracked ones', () => {
    const { dir } = buildStagedTree({
      '.gitignore': 'src/__tests__/*.local.test.ts\n',
      'src/__tests__/scratch.local.test.ts': '',
      'src/__tests__/kept.unit.test.ts': '',
    });

    expect(findTestFiles(dir)).toStrictEqual(['src/__tests__/kept.unit.test.ts']);
  });

  it('still reports an untracked test file that git does not ignore', () => {
    const { dir } = buildStagedTree(
      { '.gitignore': 'out/\n' },
      { 'src/stray.unit.test.ts': '', 'src/__tests__/untiered.test.ts': '' },
    );

    expect(findMisplacedTestFiles(dir)).toStrictEqual(['src/stray.unit.test.ts']);
    expect(findUntieredTestFiles(dir)).toStrictEqual(['src/__tests__/untiered.test.ts']);
  });

  it('still reports a tracked test file that matches an ignore pattern', () => {
    const { dir } = buildStagedTree({
      '.gitignore': 'generated/\n',
      'generated/misplaced.unit.test.ts': '',
    });
    execFileSync('git', ['-C', dir, 'add', '--force', 'generated/misplaced.unit.test.ts'], { stdio: 'ignore' });

    expect(findMisplacedTestFiles(dir)).toStrictEqual(['generated/misplaced.unit.test.ts']);
  });

  it('prunes ignored paths relative to a root below the repository', () => {
    const { dir } = buildStagedTree({
      '.gitignore': 'build/\n',
      'packages/api/build/copy.test.ts': '',
      'packages/api/src/misplaced.unit.test.ts': '',
    });

    expect(findMisplacedTestFiles(path.join(dir, 'packages/api'))).toStrictEqual(['src/misplaced.unit.test.ts']);
  });
});

// region | Helpers

/**
 * Builds a fixture tree, removed when the test finishes, and stages `files`, so that its `.gitignore` decides what
 * git reports as ignored. `untrackedFiles` are written after staging and stay untracked.
 */
function buildStagedTree(files: Record<string, string>, untrackedFiles: Record<string, string> = {}): TempTree {
  const tree = disposeOnTestFinished(createTempTree(files, { prefix: 'nmr-tiers-' }));
  stageFixtureFiles(tree.dir);
  tree.writeAll(untrackedFiles);
  return tree;
}

// endregion | Helpers
