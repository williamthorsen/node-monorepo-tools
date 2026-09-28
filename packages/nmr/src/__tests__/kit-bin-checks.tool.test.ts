import path from 'node:path';

import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { everyBinTargetIsACommittedWrapper } from '../../.readyup/kits/default.ts';
import { buildManifest } from '../test-utils/buildManifest.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { stageFixtureFiles } from '../test-utils/stageFixtureFiles.ts';
import { useMonorepo } from '../test-utils/useMonorepo.ts';

const WRAPPER = "await import('../dist/esm/cli.js');\n";

describe(everyBinTargetIsACommittedWrapper, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes a tracked wrapper', async () => {
    useStagedMonorepo({
      'packages/tool/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });

  it('reports an untracked target that does not name a build directory', async () => {
    useStagedMonorepo({
      '.gitignore': 'build/\n',
      'packages/tool/build/cli.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'build/cli.js' } }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('@fixture/tool:tool -> build/cli.js (untracked)');
  });

  it('reports a target under dist/ under that reason rather than as untracked', async () => {
    useStagedMonorepo({
      '.gitignore': 'dist/\n',
      'packages/tool/dist/esm/cli.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/esm/cli.js' } }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('(names a path under dist/)');
    expect(detail).not.toContain('untracked');
  });

  it('reports a target that is tracked in another package but not its own', async () => {
    useStagedMonorepo({
      'packages/other/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain(
      '@fixture/tool:tool -> bin/tool.js (untracked)',
    );
  });

  it('reports a target under dist/', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/esm/cli.js' } }) });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('1 found');
    expect(detail).toContain('@fixture/tool:tool -> dist/esm/cli.js (names a path under dist/)');
  });

  it('reports a target under dist/ written with a leading ./', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: { tool: './dist/esm/cli.js' } }) });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain('-> dist/esm/cli.js');
  });

  it("names the command after the package whose bin is npm's string form", async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ bin: './dist/esm/cli.js' }) });

    expect(getDetail(await everyBinTargetIsACommittedWrapper())).toContain('@fixture/tool:tool ->');
  });

  it('reports every offending entry of a package declaring several bins', async () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({ bin: { tool: 'dist/cli.js', 'tool-fmt': 'dist/cli-fmt.js' } }),
    });

    const detail = getDetail(await everyBinTargetIsACommittedWrapper());
    expect(detail).toContain('2 found');
    expect(detail).toContain('@fixture/tool:tool-fmt ->');
  });

  it('passes a committed wrapper outside a git repository, where the check cannot read a tracked listing', async () => {
    const dir = useMonorepo({
      'packages/tool/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });
    // Stop git's upward search at the fixture so that git does not find a repository that encloses the temp root.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(dir));

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });

  it('passes a package that does not declare a bin', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({}) });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });
});

// region | Helpers

/** Builds a fixture monorepo, stages it in a repository of its own, and points `process.cwd()` at it. */
function useStagedMonorepo(files: Record<string, string>): void {
  const dir = buildMonorepo(files);
  stageFixtureFiles(dir);
  disposeOnTestFinished(pointCwdAt(dir));
}

// endregion | Helpers
