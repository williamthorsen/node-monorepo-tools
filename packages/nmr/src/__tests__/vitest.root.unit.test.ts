import os from 'node:os';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { globSync } from 'tinyglobby';
import { afterEach, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { listGitIgnoredPaths } from '../git-ignored-paths.ts';
import {
  CLIENT_CONDITIONS,
  getProjects,
  GIT_ISOLATION_SETUP_FILE,
  PROJECT_NAMES,
  TIERED_PATTERNS,
} from '../test-utils/vitest-config-fixtures.ts';
import { defineRootVitestConfig, defineVitestConfig, type VitestConfigOptions } from '../vitest.ts';

// Keep the config from spawning git, which would move this file out of the unit tier.
vi.mock(import('../git-ignored-paths.ts'), () => ({ listGitIgnoredPaths: vi.fn(() => []) }));

// Files in the fixture tree, each chosen for a tier boundary that the config has to get right.
const FIXTURE_FILES = [
  // A build that copies sources rather than compiling them. The `dist/src/` shape is the one that the coverage
  // include also matches, so the single fixture covers both test collection and coverage.
  'dist/src/__tests__/copied.test.ts',
  // Collected until the repo names the directory: Vitest's own defaults prune `node_modules` and `.git` alone.
  'generated/__tests__/scaffold.test.ts',
  'node_modules/pkg/__tests__/dep.test.ts', // excluded by Vitest's own defaults
  'src/__tests__/nested/deep.test.tsx', // nested, and the tsx branch of the brace expansion
  'src/__tests__/plain.test.ts',
  'src/__tests__/thing.app.test.ts', // the retired project's infix, which the residual must keep collecting
  'src/__tests__/thing.localhost.test.ts',
  'src/__tests__/thing.remote.test.ts',
  'src/__tests__/thing.smoke.test.ts', // an infix that does not match any tier
  'src/__tests__/thing.tool.test.ts',
  'src/__tests__/thing.unit.test.ts', // the optional, purely informative `unit` infix
  'src/outside.test.ts', // outside a `__tests__` directory
];

const it = baseIt
  .extend(
    'workspaceTree',
    { scope: 'file' },
    makeFixture(() =>
      createTempTree(
        {
          'packages/alpha/package.json': '{}',
          'packages/legacy/package.json': '{}',
          'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'tools/cli'\n  - '!packages/legacy'\n",
          'tools/cli/package.json': '{}',
        },
        { prefix: 'nmr-vitest-workspace-' },
      ),
    ),
  )
  .extend(
    'singlePackageTree',
    { scope: 'file' },
    // A pnpm-10 single-package repo: The manifest exists to contain settings and does not declare `packages`.
    makeFixture(() =>
      createTempTree(
        { 'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - esbuild\n' },
        { prefix: 'nmr-vitest-single-' },
      ),
    ),
  )
  .extend(
    'notARootTree',
    { scope: 'file' },
    makeFixture(() => createTempTree({}, { prefix: 'nmr-vitest-not-a-root-' })),
  )
  .extend(
    'selectionTree',
    { scope: 'file' },
    makeFixture(() =>
      createTempTree(Object.fromEntries(FIXTURE_FILES.map((file) => [file, ''])), { prefix: 'nmr-vitest-test-' }),
    ),
  );

describe(defineRootVitestConfig, () => {
  it('excludes each path ignored by git under the monorepo root', ({ workspaceTree }) => {
    vi.mocked(listGitIgnoredPaths).mockReturnValueOnce(['.netlify/']);

    const projects = getProjects(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }));

    expect(listGitIgnoredPaths).toHaveBeenLastCalledWith(workspaceTree.dir);
    for (const project of projects) {
      expect(project.test?.exclude).toContain('.netlify/**');
    }
  });

  it('derives one sorted, posix-separated glob per workspace package', ({ workspaceTree }) => {
    const projects = getProjects(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }));

    for (const project of projects) {
      expect(project.test?.exclude).toStrictEqual([
        '**/node_modules/**',
        '**/.git/**',
        '**/coverage/**',
        '**/dist/**',
        ...(project.test?.name === 'unit' ? TIERED_PATTERNS : []),
        'packages/alpha/**',
        'tools/cli/**',
      ]);
    }
  });

  it('takes the resolution flags that the package factory takes', ({ workspaceTree }) => {
    const config = defineRootVitestConfig({ monorepoRoot: workspaceTree.dir, tsconfigPaths: true });

    expect(config.resolve?.tsconfigPaths).toBe(true);
  });

  it('takes the collection exclusions that the package factory takes', ({ workspaceTree }) => {
    const config = defineRootVitestConfig({ monorepoRoot: workspaceTree.dir, testCollectionExclude: ['generated'] });

    for (const project of getProjects(config)) {
      expect(project.test?.exclude).toContain('**/generated/**');
    }
  });

  it('pins every project to the monorepo root, so the globs resolve from the same base', ({ workspaceTree }) => {
    const projects = getProjects(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }));

    for (const project of projects) {
      expect(project.root).toBe(workspaceTree.dir);
    }
  });

  it('throws a message naming the directory when it does not contain a workspace manifest', ({ notARootTree }) => {
    expect(() => defineRootVitestConfig({ monorepoRoot: notARootTree.dir })).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARootTree.dir}`,
    );
  });

  it('throws when called without any options, which types alone cannot prevent in a JavaScript config', () => {
    // @ts-expect-error -- the argument is required; this is the call that a JavaScript consumer can still make.
    expect(() => defineRootVitestConfig()).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  it('throws when given options without a monorepo root', () => {
    // @ts-expect-error -- the option is required; a JavaScript consumer can still omit it.
    expect(() => defineRootVitestConfig({})).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  // A relative root is passed to `path.join` and `projectRoot` unresolved, so the config would describe whichever
  // monorepo the run started in.
  it('throws when the monorepo root is not an absolute path', () => {
    for (const monorepoRoot of ['', '.', 'packages/..']) {
      expect(() => defineRootVitestConfig({ monorepoRoot })).toThrow('defineRootVitestConfig requires `monorepoRoot`');
    }
  });

  it('omits package exclusions when the manifest lists none, as in a single-package repo', ({ singlePackageTree }) => {
    const projects = getProjects(defineRootVitestConfig({ monorepoRoot: singlePackageTree.dir }));

    for (const project of projects) {
      expect(project.test?.exclude).toStrictEqual([
        '**/node_modules/**',
        '**/.git/**',
        '**/coverage/**',
        '**/dist/**',
        ...(project.test?.name === 'unit' ? TIERED_PATTERNS : []),
      ]);
    }
  });

  it('applies the workspace exclusion to the projects, not the root test block', ({ workspaceTree }) => {
    const rootTest = defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }).test ?? {};

    expect(rootTest).not.toHaveProperty('exclude');
    expect(rootTest).not.toHaveProperty('include');
  });

  it('does not report any coverage of its own', ({ workspaceTree }) => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }).test?.coverage?.include).toStrictEqual([]);
  });

  it('accepts a run that does not collect any test files', ({ workspaceTree }) => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }).test?.passWithNoTests).toBe(true);
  });

  it('skips an empty layer ahead of the layer declaring the monorepo root', ({ workspaceTree }) => {
    const config = defineRootVitestConfig(undefined, { monorepoRoot: workspaceTree.dir });

    expect(getProjects(config)).toHaveLength(4);
  });

  it('folds a shared layer ahead of the layer declaring the monorepo root', ({ workspaceTree }) => {
    const config = defineRootVitestConfig(
      { project: { setupFiles: ['./shared.ts'] }, root: { resolve: { conditions: ['development'] } } },
      { monorepoRoot: workspaceTree.dir },
    );

    expect(config.resolve?.conditions).toStrictEqual([...CLIENT_CONDITIONS, 'development']);
    for (const project of getProjects(config)) {
      expect(project.test?.setupFiles).toStrictEqual([GIT_ISOLATION_SETUP_FILE, './shared.ts']);
      expect(project.root).toBe(workspaceTree.dir);
    }
  });

  // A shared layer describes settings, not which repo they belong to, so the root has to be set on the config file's
  // own layer: the only one whose `import.meta.dirname` states this repo.
  it('throws when the last layer does not declare a monorepo root, however many precede it', ({ workspaceTree }) => {
    const build = () =>
      // @ts-expect-error - the last layer must declare `monorepoRoot`; a JavaScript consumer can still omit it
      defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }, { project: {} });

    expect(build).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  // The final layer recognizes one key more than the rest; the retired-key check runs on it all the same.
  it('rejects a retired option on the layer declaring the monorepo root', ({ workspaceTree }) => {
    // @ts-expect-error - the option was renamed; a JavaScript consumer can still write the old spelling
    const build = () => defineRootVitestConfig({ isolateGit: false, monorepoRoot: workspaceTree.dir });

    expect(build).toThrow('`isolateGit` was renamed to `shouldIsolateGit`.');
  });

  it('rejects the monorepo root on a layer other than the last', ({ workspaceTree }) => {
    const build = () =>
      // @ts-expect-error - only the final layer states the monorepo root; a JavaScript consumer can still write it
      defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }, { monorepoRoot: workspaceTree.dir });

    expect(build).toThrow('unrecognized option `monorepoRoot`');
  });
});

describe('worker count', () => {
  const GIB = 2 ** 30;
  const originalArgv = process.argv;

  // Hide any `--maxWorkers` that the run itself was given, which the factory would read.
  beforeEach(() => {
    process.argv = [...originalArgv.slice(0, 2), 'run'];
  });

  // Restore the machine spies; `restoreAllMocks` leaves the `git-ignored-paths.ts` module mock in place.
  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
  });

  it('gives every project the worker count derived from memory and cores', ({ workspaceTree }) => {
    vi.spyOn(os, 'availableParallelism').mockReturnValue(10);
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);

    const configs = [defineVitestConfig(), defineRootVitestConfig({ monorepoRoot: workspaceTree.dir })];

    for (const config of configs) {
      expect(getProjects(config).map((project) => project.test?.maxWorkers)).toStrictEqual(PROJECT_NAMES.map(() => 4));
    }
  });

  it('gives every project three workers on a machine with two or fewer cores', ({ workspaceTree }) => {
    vi.spyOn(os, 'totalmem').mockReturnValue(2 * GIB);

    for (const coreCount of [1, 2]) {
      vi.spyOn(os, 'availableParallelism').mockReturnValue(coreCount);

      const configs = [defineVitestConfig(), defineRootVitestConfig({ monorepoRoot: workspaceTree.dir })];

      for (const config of configs) {
        expect(getProjects(config).map((project) => project.test?.maxWorkers)).toStrictEqual(
          PROJECT_NAMES.map(() => 3),
        );
      }
    }
  });

  it('lets the project and tiers seams override the derived worker count', () => {
    vi.spyOn(os, 'availableParallelism').mockReturnValue(10);
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);

    const fromProject = getProjects(defineVitestConfig({ project: { maxWorkers: 1 } }));
    const fromTiers = getProjects(
      defineVitestConfig({ tiers: Object.fromEntries(PROJECT_NAMES.map((name) => [name, { maxWorkers: 2 }])) }),
    );

    expect(fromProject.map((project) => project.test?.maxWorkers)).toStrictEqual(PROJECT_NAMES.map(() => 1));
    expect(fromTiers.map((project) => project.test?.maxWorkers)).toStrictEqual(PROJECT_NAMES.map(() => 2));
  });

  it.each([
    ['--maxWorkers=2', 2],
    ['--maxWorkers=50%', '50%'],
  ])('lets %s override both the derived count and the seams', (flag, expected) => {
    vi.spyOn(os, 'availableParallelism').mockReturnValue(10);
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    process.argv = [...originalArgv.slice(0, 2), 'run', flag];

    const configs = [defineVitestConfig(), defineVitestConfig({ project: { maxWorkers: 1 } })];

    for (const config of configs) {
      expect(getProjects(config).map((project) => project.test?.maxWorkers)).toStrictEqual(
        PROJECT_NAMES.map(() => expected),
      );
    }
  });
});

describe('project file selection', () => {
  it.for(['tool', 'localhost', 'remote'])(
    'selects only its own infix for the %s project',
    (tier, { selectionTree }) => {
      expect(selectFiles(tier, selectionTree.dir)).toStrictEqual([`src/__tests__/thing.${tier}.test.ts`]);
    },
  );

  it('runs a file whose infix does not match any tier under the unit project', ({ selectionTree }) => {
    expect(selectFiles('unit', selectionTree.dir)).toContain('src/__tests__/thing.smoke.test.ts');
  });

  it('leaves tiered, unnested, and excluded files out of the unit project', ({ selectionTree }) => {
    expect(selectFiles('unit', selectionTree.dir)).toStrictEqual([
      'generated/__tests__/scaffold.test.ts',
      'src/__tests__/nested/deep.test.tsx',
      'src/__tests__/plain.test.ts',
      'src/__tests__/thing.app.test.ts',
      'src/__tests__/thing.smoke.test.ts',
      'src/__tests__/thing.unit.test.ts',
    ]);
  });

  // The residual subtracts the tiers, so an overlap would collect the same file twice and run it twice, green.
  it('claims each file exactly once across the projects', ({ selectionTree }) => {
    const collectedFiles = PROJECT_NAMES.flatMap((name) => selectFiles(name, selectionTree.dir));

    expect(collectedFiles).toStrictEqual([...new Set(collectedFiles)]);
  });

  // Because a copy of the suite under `dist/` runs green against stale code, every project has to leave it out.
  it('leaves a test file copied into build output out of every project', ({ selectionTree }) => {
    for (const name of PROJECT_NAMES) {
      expect(selectFiles(name, selectionTree.dir)).not.toContain('dist/src/__tests__/copied.test.ts');
    }
  });

  // The exclusion declared by the repo keeps the sweep and the collection glob describing one scope. Both halves are
  // asserted here, because the sweep must not skip a directory from which Vitest still collects.
  it('drops a generated directory from collection once the repo excludes it', ({ selectionTree }) => {
    const excludedConfig = { testCollectionExclude: ['generated'] };

    expect(selectFiles('unit', selectionTree.dir)).toContain('generated/__tests__/scaffold.test.ts');
    expect(selectFiles('unit', selectionTree.dir, excludedConfig)).not.toContain(
      'generated/__tests__/scaffold.test.ts',
    );
  });
});

// region | Helpers

/** Resolves a project's patterns against the fixture tree using the engine with which Vitest discovers files. */
function selectFiles(name: string, cwd: string, options?: VitestConfigOptions): string[] {
  const project = getProjects(defineVitestConfig(options)).find(({ test }) => test?.name === name);

  return globSync(project?.test?.include ?? [], { cwd, ignore: project?.test?.exclude ?? [] }).toSorted();
}

// endregion | Helpers
