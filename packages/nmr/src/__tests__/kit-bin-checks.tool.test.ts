import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { everyBinTargetIsACommittedWrapper } from '../../.readyup/kits/default.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { stageFixtureFiles } from '../test-utils/stageFixtureFiles.ts';

const WRAPPER = "await import('../dist/esm/cli.js');\n";

describe(everyBinTargetIsACommittedWrapper, () => {
  it('passes a tracked wrapper', async () => {
    useStagedMonorepo({
      'packages/tool/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ tool: 'bin/tool.js' }),
    });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });

  it('reports an untracked target that names no build directory', async () => {
    useStagedMonorepo({
      '.gitignore': 'build/\n',
      'packages/tool/build/cli.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ tool: 'build/cli.js' }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('@fixture/tool:tool -> build/cli.js (untracked)');
  });

  it('reports a target under dist/ under that reason rather than as untracked', async () => {
    useStagedMonorepo({
      '.gitignore': 'dist/\n',
      'packages/tool/dist/esm/cli.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ tool: 'dist/esm/cli.js' }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('(names a path under dist/)');
    expect(detail).not.toContain('untracked');
  });

  it('reports a target that is tracked in another package but not its own', async () => {
    useStagedMonorepo({
      'packages/other/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ tool: 'bin/tool.js' }),
    });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain(
      '@fixture/tool:tool -> bin/tool.js (untracked)',
    );
  });
});

// region | Helpers

/** Renders the workspace manifest each fixture package here declares, with only a name and its bins. */
function buildManifest(bin: Record<string, string>): string {
  return `${JSON.stringify({ name: '@fixture/tool', bin }, undefined, 2)}\n`;
}

/** Builds a fixture monorepo, stages it in a repository of its own, and points `process.cwd()` at it. */
function useStagedMonorepo(files: Record<string, string>): void {
  const dir = buildMonorepo(files);
  stageFixtureFiles(dir);
  disposeOnTestFinished(pointCwdAt(dir));
}

// endregion | Helpers
