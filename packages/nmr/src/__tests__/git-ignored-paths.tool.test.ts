import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listGitIgnoredPaths } from '../git-ignored-paths.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { stageFixtureFiles } from '../test-utils/stageFixtureFiles.ts';

describe(listGitIgnoredPaths, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists an ignored directory as one entry, and an ignored file beside tracked ones by its own path', () => {
    const dir = buildRepo({
      '.gitignore': '.netlify/\nsrc/*.log\n',
      '.netlify/edge-functions/utils.test.ts': '',
      'src/debug.log': '',
      'src/index.ts': '',
    });
    stageFixtureFiles(dir);

    expect(listGitIgnoredPaths(dir)).toStrictEqual(['.netlify/', 'src/debug.log']);
  });

  it('omits a tracked file that matches an ignore pattern', () => {
    const dir = buildRepo({
      '.gitignore': 'generated/\n',
      'generated/__tests__/kept.unit.test.ts': '',
    });
    stageFixtureFiles(dir);
    execFileSync('git', ['-C', dir, 'add', '--force', 'generated/__tests__/kept.unit.test.ts'], { stdio: 'ignore' });

    expect(listGitIgnoredPaths(dir)).toStrictEqual([]);
  });

  it('omits an untracked file that no pattern ignores', () => {
    const tree = disposeOnTestFinished(
      createTempTree({ '.gitignore': 'out/\n', 'out/a.ts': '' }, { prefix: 'nmr-git-ignored-' }),
    );
    stageFixtureFiles(tree.dir);
    tree.write('src/__tests__/stray.unit.test.ts', '');

    expect(listGitIgnoredPaths(tree.dir)).toStrictEqual(['out/']);
  });

  it('lists paths relative to a subdirectory it is given', () => {
    const dir = buildRepo({
      '.gitignore': 'dist/\n',
      'packages/api/dist/__tests__/copy.test.ts': '',
      'packages/api/src/index.ts': '',
    });
    stageFixtureFiles(dir);

    expect(listGitIgnoredPaths(path.join(dir, 'packages/api'))).toStrictEqual(['dist/']);
  });

  it('returns an empty list outside a repository', () => {
    const dir = buildRepo({ 'dist/index.js': '' });
    // Stops git's upward search at the fixture, so a temp root that sits inside some repository cannot answer.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(dir));

    expect(listGitIgnoredPaths(dir)).toStrictEqual([]);
  });

  it('returns an empty list when git cannot be spawned', () => {
    const dir = buildRepo({ '.gitignore': 'dist/\n', 'dist/index.js': '' });
    stageFixtureFiles(dir);
    vi.stubEnv('PATH', path.join(dir, 'no-such-bin'));

    expect(listGitIgnoredPaths(dir)).toStrictEqual([]);
  });
});
