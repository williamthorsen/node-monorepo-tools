import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { enterRepoRoot } from '../enterRepoRoot.ts';
import { PNPM_WORKSPACE } from '../test-utils/scaffoldRepo.ts';

const MONOREPO_ENTRIES = {
  'package.json': '{ "name": "root" }\n',
  'packages/a/package.json': '{ "name": "a" }\n',
  'packages/a/src/nested/': '',
  'pnpm-workspace.yaml': PNPM_WORKSPACE,
};

describe(enterRepoRoot, () => {
  it('stays at a monorepo root', () => {
    const { dir } = enterFrom(MONOREPO_ENTRIES, '.');

    expect(enterRepoRoot()).toStrictEqual({ invocationDir: dir, root: dir });
    expect(process.cwd()).toBe(dir);
  });

  it('moves from a package directory to the monorepo root', () => {
    const { dir, treeDir } = enterFrom(MONOREPO_ENTRIES, 'packages/a');

    expect(enterRepoRoot()).toStrictEqual({ invocationDir: dir, root: treeDir });
    expect(process.cwd()).toBe(treeDir);
  });

  it('moves from a directory nested inside a package to the monorepo root', () => {
    const { dir, treeDir } = enterFrom(MONOREPO_ENTRIES, 'packages/a/src/nested');

    expect(enterRepoRoot()).toStrictEqual({ invocationDir: dir, root: treeDir });
    expect(process.cwd()).toBe(treeDir);
  });

  it('stays at the root of a single-package repo', () => {
    const { dir } = enterFrom({ 'package.json': '{ "name": "solo" }\n' }, '.');

    expect(enterRepoRoot()).toStrictEqual({ invocationDir: dir, root: dir });
    expect(process.cwd()).toBe(dir);
  });

  it('throws, naming what it looked for and where, when no root is found', () => {
    const { dir } = enterFrom({ 'notes.txt': '' }, '.');

    expect(() => enterRepoRoot()).toThrow(
      `No repo root found from ${dir}: expected a pnpm-workspace.yaml in it or any parent directory, or a package.json in it.`,
    );
    expect(process.cwd()).toBe(dir);
  });
});

// region | Helpers
/** Writes the entries to a temp tree, moves the process into `relativeDir`, and returns both realpaths. */
function enterFrom(entries: Record<string, string>, relativeDir: string): { dir: string; treeDir: string } {
  const tree = disposeOnTestFinished(createTempTree(entries, { prefix: 'release-kit-root-' }));
  const { dir } = disposeOnTestFinished(pointCwdAt(tree.resolve(relativeDir), { chdir: true }));
  return { dir, treeDir: tree.dir };
}
// endregion | Helpers
