import path from 'node:path';

import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { everyBinTargetIsACommittedWrapper } from '../../.readyup/kits/default.ts';
import { buildMonorepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { stageFixtureFiles } from '../test-utils/stageFixtureFiles.ts';

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

  it('reports an untracked target that names no build directory', async () => {
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

  it("names the command after the package where bin is npm's string form", async () => {
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

  it('passes a committed wrapper outside a git repository, where no tracked listing can be read', async () => {
    const dir = useMonorepo({
      'packages/tool/bin/tool.js': WRAPPER,
      'packages/tool/package.json': buildManifest({ bin: { tool: 'bin/tool.js' } }),
    });
    // Stops git's upward search at the fixture, so a temp root that sits inside some repository cannot answer.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(dir));

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });

  it('passes a package declaring no bin', async () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({}) });

    await expect(everyBinTargetIsACommittedWrapper()).resolves.toBe(true);
  });
});

// region | Helpers

/** Renders a workspace manifest with the given fields, which every fixture package here needs a name beside. */
function buildManifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ name: '@fixture/tool', ...fields }, undefined, 2)}\n`;
}

/** Builds a fixture monorepo, stages it in a repository of its own, and points `process.cwd()` at it. */
function useStagedMonorepo(files: Record<string, string>): void {
  const dir = buildMonorepo(files);
  stageFixtureFiles(dir);
  disposeOnTestFinished(pointCwdAt(dir));
}

/** Builds a fixture monorepo and points `process.cwd()` at it, which is what workspace discovery reads. */
function useMonorepo(files: Record<string, string>): string {
  const dir = buildMonorepo(files);
  disposeOnTestFinished(pointCwdAt(dir));
  return dir;
}

// endregion | Helpers
