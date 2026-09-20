import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  findMonorepoRoot,
  isMonorepoRoot,
  readWorkspaceOverrides,
  readWorkspacePackageNames,
  resolveWorkspace,
} from '../workspace.ts';

// The monorepo root is two levels up from packages/nmr-core
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_CORE_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr-core');

const PREFIX = 'nmr-core-workspace-test-';

const it = baseIt
  .extend(
    'toolsTree',
    makeFixture(() => createTempTree({ 'tools/cli/package.json': '{}' }, { prefix: PREFIX })),
  )
  .extend(
    'packagesTree',
    makeFixture(() =>
      createTempTree({ 'packages/alpha/package.json': '{}', 'packages/legacy/package.json': '{}' }, { prefix: PREFIX }),
    ),
  );

describe(findMonorepoRoot, () => {
  it('finds root from the monorepo root', () => {
    expect(findMonorepoRoot(MONOREPO_ROOT)).toBe(MONOREPO_ROOT);
  });

  it('finds root from a nested directory within a package', () => {
    expect(findMonorepoRoot(path.join(NMR_CORE_PACKAGE_DIR, 'src'))).toBe(MONOREPO_ROOT);
  });

  it('returns nothing when the walk runs out of parent directories', () => {
    expect(findMonorepoRoot('/')).toBeUndefined();
  });
});

describe(isMonorepoRoot, () => {
  it('reports a directory holding the workspace manifest', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");

    expect(isMonorepoRoot(packagesTree.dir)).toBe(true);
  });

  it('reports a directory holding no workspace manifest', ({ packagesTree }) => {
    expect(isMonorepoRoot(packagesTree.dir)).toBe(false);
  });
});

describe(resolveWorkspace, () => {
  describe("kind 'not-a-workspace'", () => {
    it('reports a directory holding no workspace manifest rather than throwing', () => {
      using notARoot = createTempTree({}, { prefix: PREFIX });

      expect(resolveWorkspace(notARoot.dir)).toStrictEqual({ kind: 'not-a-workspace' });
    });
  });

  describe("kind 'packages'", () => {
    it('carries the resolved directories and the declared patterns', ({ toolsTree }) => {
      toolsTree.write('pnpm-workspace.yaml', 'packages:\n  - tools/cli\n');

      expect(resolveWorkspace(toolsTree.dir)).toStrictEqual({
        kind: 'packages',
        packageDirs: [path.join(toolsTree.dir, 'tools', 'cli')],
        patterns: ['tools/cli'],
      });
    });

    it('honors an exclusion declared in the manifest', ({ packagesTree }) => {
      packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n");

      const resolution = resolveWorkspace(packagesTree.dir);

      expect(resolution).toMatchObject({
        kind: 'packages',
        packageDirs: [path.join(packagesTree.dir, 'packages', 'alpha')],
      });
    });

    it('resolves this repository, whose manifest reaches its own package', () => {
      expect(resolveWorkspace(MONOREPO_ROOT)).toMatchObject({
        kind: 'packages',
        packageDirs: expect.arrayContaining([NMR_CORE_PACKAGE_DIR]),
      });
    });
  });

  describe("kind 'empty'", () => {
    it.for([
      { patterns: undefined, scenario: 'no `packages` key' },
      { patterns: '[]', scenario: 'an empty list' },
      { patterns: "'packages/*'", scenario: 'a `packages` key that is not a list' },
      { patterns: '\n  - 42', scenario: 'a list holding something other than strings' },
      { patterns: "\n  - '!packages/legacy'", scenario: 'exclusions alone' },
      { patterns: '\n  - !packages/legacy', scenario: 'an unquoted `!` entry, which YAML leaves empty' },
    ])('reports no-pattern given $scenario', ({ patterns }, { packagesTree }) => {
      packagesTree.write(
        'pnpm-workspace.yaml',
        patterns === undefined ? 'shamefully-hoist: true\n' : `packages: ${patterns}\n`,
      );

      expect(resolveWorkspace(packagesTree.dir)).toMatchObject({ cause: 'no-pattern', kind: 'empty' });
    });

    // The manifest below declares `packages/*`, which `no-pattern` would tell the reader to go and declare.
    // The fault is the syntax error above it, and the cause has to name that one to be worth reading.
    it('reports unreadable-manifest given a manifest holding no valid YAML, rather than throwing', ({
      packagesTree,
    }) => {
      packagesTree.write('pnpm-workspace.yaml', 'packages:\n  - "unterminated\n  - packages/*\n');

      expect(resolveWorkspace(packagesTree.dir)).toStrictEqual({
        cause: 'unreadable-manifest',
        kind: 'empty',
        patterns: [],
      });
    });

    it('reports no-package where the pattern matches no directory holding one', ({ toolsTree }) => {
      toolsTree.mkdir('tools/empty');
      toolsTree.write('pnpm-workspace.yaml', "packages:\n  - 'tools/empty'\n");

      expect(resolveWorkspace(toolsTree.dir)).toStrictEqual({
        cause: 'no-package',
        kind: 'empty',
        patterns: ['tools/empty'],
      });
    });

    it('reports all-excluded where the exclusions remove every match', ({ packagesTree }) => {
      packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/*'\n");

      expect(resolveWorkspace(packagesTree.dir)).toStrictEqual({
        cause: 'all-excluded',
        kind: 'empty',
        patterns: ['packages/*', '!packages/*'],
      });
    });

    // An exclusion that removes some but not all of the matches leaves the workspace non-empty, so the only
    // exclusion-bearing manifest reaching the diagnosis with no positive match is one whose patterns matched none.
    it('reports no-package where exclusions are declared but the positive patterns matched nothing', ({
      toolsTree,
    }) => {
      toolsTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n");

      expect(resolveWorkspace(toolsTree.dir)).toMatchObject({ cause: 'no-package', kind: 'empty' });
    });

    it('carries the declared patterns, which a message quotes back', ({ packagesTree }) => {
      packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");

      expect(resolveWorkspace(packagesTree.dir)).toMatchObject({ patterns: ['apps/*'] });
    });
  });
});

describe(readWorkspaceOverrides, () => {
  it('reads the overrides block the manifest declares', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\noverrides:\n  semver: '7.8.5'\n");

    expect(readWorkspaceOverrides(packagesTree.dir)).toStrictEqual({ semver: '7.8.5' });
  });

  it('drops an entry whose value YAML read as something other than a string', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', 'overrides:\n  semver: 7\n  zod: "4.6.4"\n');

    expect(readWorkspaceOverrides(packagesTree.dir)).toStrictEqual({ zod: '4.6.4' });
  });

  it('returns nothing where the manifest declares no overrides', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");

    expect(readWorkspaceOverrides(packagesTree.dir)).toBeUndefined();
  });

  it('returns nothing where the directory holds no manifest', ({ packagesTree }) => {
    expect(readWorkspaceOverrides(packagesTree.dir)).toBeUndefined();
  });

  it('returns nothing where the manifest holds no valid YAML, rather than throwing', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', 'overrides:\n  semver: "unterminated\n');

    expect(readWorkspaceOverrides(packagesTree.dir)).toBeUndefined();
  });
});

describe(readWorkspacePackageNames, () => {
  it('reads the name each manifest declares', ({ packagesTree }) => {
    packagesTree.write('packages/alpha/package.json', '{"name":"@scope/alpha"}');
    packagesTree.write('packages/legacy/package.json', '{"name":"legacy"}');

    const names = readWorkspacePackageNames([
      path.join(packagesTree.dir, 'packages', 'alpha'),
      path.join(packagesTree.dir, 'packages', 'legacy'),
    ]);

    expect(names).toStrictEqual(['@scope/alpha', 'legacy']);
  });

  // The names serve a diagnostic, so a manifest that cannot be read costs its own name and no more.
  it('passes over a manifest that is missing, unparseable, or nameless', ({ packagesTree }) => {
    packagesTree.write('packages/alpha/package.json', '{"name":"@scope/alpha"}');
    packagesTree.write('packages/legacy/package.json', '{ oops');

    const names = readWorkspacePackageNames([
      path.join(packagesTree.dir, 'packages', 'alpha'),
      path.join(packagesTree.dir, 'packages', 'legacy'),
      path.join(packagesTree.dir, 'packages', 'nameless'),
    ]);

    expect(names).toStrictEqual(['@scope/alpha']);
  });
});
