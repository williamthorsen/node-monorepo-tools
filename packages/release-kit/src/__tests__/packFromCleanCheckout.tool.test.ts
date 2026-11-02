import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { packFromCleanCheckout } from '../packFromCleanCheckout.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';

/** Writes `built/out.js`, standing in for a build that the package runs in its publish lifecycle. */
const BUILD_SCRIPT = [
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "mkdirSync('built', { recursive: true });",
  "writeFileSync('built/out.js', 'export {};');",
  '',
].join('\n');

describe(packFromCleanCheckout, () => {
  it('packs what a clean checkout builds, not the build output left in the working tree', () => {
    scaffoldNpmPackageRepo({ prepack: 'node build.mjs' }, { hasLeftoverBuild: true });

    const filesByWorkspace = packFromCleanCheckout(['.'], 'npm');

    const files = filesByWorkspace.get('.');
    expect(files).toContain('built/out.js');
    expect(files).toContain('package.json');
    expect(files).not.toContain('dist/index.js');
  });

  it('leaves the working tree and the worktree list unchanged', () => {
    const repo = scaffoldNpmPackageRepo({ prepack: 'node build.mjs' }, { hasLeftoverBuild: true });
    const statusBefore = repo.runGit('status', '--porcelain', '--ignored');
    const worktreesBefore = repo.runGit('worktree', 'list');

    packFromCleanCheckout(['.'], 'npm');

    expect(repo.runGit('status', '--porcelain', '--ignored')).toBe(statusBefore);
    expect(repo.runGit('worktree', 'list')).toBe(worktreesBefore);
  });

  it('throws an error naming the step when prepublishOnly fails', () => {
    scaffoldNpmPackageRepo({ prepublishOnly: 'node -e "process.exit(3)"' });

    expect(() => packFromCleanCheckout(['.'], 'npm')).toThrow(/Could not run prepublishOnly in \./);
  });

  it('packs from a shallow clone', () => {
    const source = scaffoldNpmPackageRepo({ prepack: 'node build.mjs' });
    source.commit('Second commit', { 'README.md': '# fixture\n' });
    const shallowTree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-shallow-' }));
    const shallowDir = join(shallowTree.dir, 'repo');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${source.dir}`, shallowDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    disposeOnTestFinished(pointCwdAt(shallowDir, { chdir: true }));

    expect(packFromCleanCheckout(['.'], 'npm').get('.')).toContain('built/out.js');
  });
});

// region | Helpers

/**
 * Commits a dependency-free npm package whose `dist/` and `built/` are gitignored, with the given scripts, optionally
 * leaving an uncommitted `dist/index.js` as an earlier local build would.
 */
function scaffoldNpmPackageRepo(
  scripts: Record<string, string>,
  { hasLeftoverBuild = false }: { hasLeftoverBuild?: boolean } = {},
): GitRepoFixture {
  const manifest = {
    name: 'fixture',
    version: '1.0.0',
    type: 'module',
    main: './dist/index.js',
    files: ['built', 'dist'],
    scripts,
  };
  const lockfile = {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'fixture', version: '1.0.0' } },
  };
  const repo = scaffoldGitRepo(hasLeftoverBuild ? { 'dist/index.js': 'export {};\n' } : {});
  repo.commit('Initial commit', {
    '.gitignore': 'built/\ndist/\n',
    'build.mjs': BUILD_SCRIPT,
    'package-lock.json': `${JSON.stringify(lockfile, null, 2)}\n`,
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
  });
  return repo;
}

// endregion | Helpers
