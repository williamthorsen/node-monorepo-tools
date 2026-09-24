import type { StreamStyles } from '@williamthorsen/nmr-core';
import { captureStdio, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { enterRepoRoot } from '../enterRepoRoot.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';
import { PNPM_WORKSPACE } from '../test-utils/scaffoldRepo.ts';

const PLAIN_STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };

describe('prepare run from a package directory', () => {
  it('reports the same release as a run from the monorepo root', async () => {
    const repo = seedMonorepo();

    const fromPackage = await runDryPrepareFrom(`${repo.dir}/packages/pkg-a`);
    const fromRoot = await runDryPrepareFrom(repo.dir);

    expect(fromPackage).toBe(fromRoot);
    expect(fromRoot).toContain('pkg-a-v1.1.0');
    expect(fromRoot).toContain('pkg-b-v1.0.1');
    expect(fromRoot).toContain('Found 1 commits since pkg-a-v1.0.0');
    expect(fromRoot).toContain('Found 1 commits since pkg-b-v1.0.0');
  });

  it('still releases a single-package repo as one package from its root', async () => {
    const repo = scaffoldGitRepo({ 'package.json': JSON.stringify({ name: 'solo', version: '1.0.0' }) + '\n' });
    repo.commit('chore: initial commit');
    repo.tag('v1.0.0');
    repo.commit('## feat: Add feature', { 'src/feature.ts': 'export const flag = true;\n' });

    const output = await runDryPrepareFrom(repo.dir);

    expect(output).toContain('v1.1.0');
    expect(output).toContain('Found 1 commits since v1.0.0');
  });
});

// region | Helpers
/** Runs `prepare --dry-run` as the bin does, entering the repo root from `dir`, and returns its stdout. */
async function runDryPrepareFrom(dir: string): Promise<string> {
  using _cwd = pointCwdAt(dir, { chdir: true });
  const { invocationDir } = enterRepoRoot();
  using stdio = captureStdio({ includeConsole: true });
  await prepareCommand(['--dry-run'], PLAIN_STYLES, invocationDir);
  return stdio.stdout;
}

/** Builds a two-workspace monorepo with baseline tags and one commit touching each workspace since. */
function seedMonorepo(): GitRepoFixture {
  const repo = scaffoldGitRepo({
    'package.json': JSON.stringify({ name: 'fixture-monorepo', private: true }) + '\n',
    'packages/pkg-a/package.json': JSON.stringify({ name: '@fixture/pkg-a', version: '1.0.0' }) + '\n',
    'packages/pkg-b/package.json': JSON.stringify({ name: '@fixture/pkg-b', version: '1.0.0' }) + '\n',
    'pnpm-workspace.yaml': PNPM_WORKSPACE,
  });
  repo.commit('chore: initial commit');
  repo.tag('pkg-a-v1.0.0');
  repo.tag('pkg-b-v1.0.0');
  // The `##` ticket prefix is required by `classifyChangelogCommit`, which admits no unticketed commit.
  repo.commit('## pkg-a|feat: Add feature flag', { 'packages/pkg-a/feature.ts': 'export const flag = true;\n' });
  repo.commit('## pkg-b|fix: Correct patch', { 'packages/pkg-b/patch.ts': 'export const patched = true;\n' });
  return repo;
}
// endregion | Helpers
