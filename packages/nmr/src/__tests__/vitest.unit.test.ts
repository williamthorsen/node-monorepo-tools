import { fileURLToPath } from 'node:url';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { globSync } from 'tinyglobby';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { describe, expect, it as baseIt } from 'vitest';
import type { TestProjectConfiguration, TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';

import { defineRootVitestConfig, defineVitestConfig, type VitestConfigOptions } from '../vitest.ts';

/** Every project the shared config declares, in the order it emits them: the residual, then the ladder. */
const PROJECT_NAMES = ['unit', 'tool', 'localhost', 'remote'];

// Composed from Vite's own exports rather than spelled out, so a release that changes either default list fails
// every assertion reading one, rather than leaving the config to narrow resolution silently.
const SOURCE_CLIENT_CONDITIONS = ['source', ...defaultClientConditions];
const SOURCE_SERVER_CONDITIONS = ['source', ...defaultServerConditions];

const GIT_ISOLATION_SETUP_FILE = fileURLToPath(new URL('../vitest-git-isolation.ts', import.meta.url));

// Spelled out rather than derived from the config, so the assertion fails if the derivation itself drifts.
const TIERED_PATTERNS = [
  '**/__tests__/**/*.tool.test.{ts,tsx}',
  '**/__tests__/**/*.localhost.test.{ts,tsx}',
  '**/__tests__/**/*.remote.test.{ts,tsx}',
];

// Files the fixture tree holds, each chosen for a tier boundary the config has to get right.
const FIXTURE_FILES = [
  // A build that copies sources rather than compiling them. The `dist/src/` shape is the one that also survives the
  // coverage include, so the single fixture stands for both surfaces.
  'dist/src/__tests__/copied.test.ts',
  // Collected until the repo names the directory: Vitest's own defaults prune `node_modules` and `.git` alone.
  'generated/__tests__/scaffold.test.ts',
  'node_modules/pkg/__tests__/dep.test.ts', // excluded by Vitest's own defaults
  'src/__tests__/nested/deep.test.tsx', // nested, and the tsx branch of the brace expansion
  'src/__tests__/plain.test.ts',
  'src/__tests__/thing.app.test.ts', // the retired project's infix, which must keep landing in the residual
  'src/__tests__/thing.localhost.test.ts',
  'src/__tests__/thing.remote.test.ts',
  'src/__tests__/thing.smoke.test.ts', // an infix matching no tier
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
    // A pnpm-10 single-package repo: the manifest exists to carry settings and declares no `packages`.
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

describe(defineVitestConfig, () => {
  it('declares every tier, each inheriting the root config', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.name)).toStrictEqual(PROJECT_NAMES);
    expect(projects.map((project) => project.extends)).toStrictEqual(PROJECT_NAMES.map(() => true));
  });

  // Vitest's defaults are unit-test budgets: 5s for a test, 10s for a hook. A tier test waits on something it
  // doesn't control, and coverage instrumentation multiplies that wait, so the defaults make a green suite flaky
  // once `test:coverage` collects it. Hooks carry the same budget as tests because a tier that scaffolds in
  // `beforeAll` moves the wait out from under `testTimeout`, where raising the test budget alone never reaches it.
  it('gives every tier above unit budgets that survive coverage instrumentation', () => {
    const budgets = new Map(
      getProjects(defineVitestConfig()).map((project) => [
        project.test?.name,
        { hookTimeout: project.test?.hookTimeout, testTimeout: project.test?.testTimeout },
      ]),
    );

    expect(budgets.get('unit')).toStrictEqual({ hookTimeout: undefined, testTimeout: undefined });
    for (const tier of ['tool', 'localhost', 'remote']) {
      expect(budgets.get(tier)).toStrictEqual({ hookTimeout: 30_000, testTimeout: 30_000 });
    }
  });

  // Distinct values rather than one, so the assertion would catch a seam that set both budgets from either key.
  it('lets the project seam override both tier budgets', () => {
    const projects = getProjects(defineVitestConfig({ project: { hookTimeout: 2_000, testTimeout: 1_000 } }));

    expect(projects.map((project) => project.test?.hookTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 2_000));
    expect(projects.map((project) => project.test?.testTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 1_000));
  });

  // Neither has a script, so nothing would surface their absence at run time. An undeclared tier's files fall into
  // the residual and run in the default gate, which is the silent failure declaring them prevents.
  it('declares the scriptless tiers, so their files cannot fall into the residual', () => {
    const names = getProjects(defineVitestConfig()).map((project) => project.test?.name);

    expect(names).toContain('localhost');
    expect(names).toContain('remote');
  });

  it('keeps per-project options out of the root test block', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(Object.keys(rootTest).toSorted()).toStrictEqual([
      'coverage',
      'passWithNoTests',
      'projects',
      'silent',
      'watch',
    ]);
  });

  it('carries over the settings the shared config has always applied', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.silent).toBe('passed-only');
    expect(rootTest.watch).toBe(false);
    expect(rootTest.coverage?.provider).toBe('v8');
    expect(rootTest.coverage?.enabled).toBe(false);
    expect(rootTest.coverage?.include).toStrictEqual(['**/src/**/*.{ts,tsx}']);
  });

  // Pinned rather than sampled: the risk is an addition, not a removal.
  it('excludes from coverage only what cannot hold runtime code', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.coverage?.exclude).toStrictEqual(['**/__{fixtures,mocks,tests}__/**', '**/index.ts', '**/*.d.ts']);
  });

  it('accepts a run that collects no test files', () => {
    expect(defineVitestConfig().test?.passWithNoTests).toBe(true);
  });

  it('lets the root seam turn the empty-run allowance back off', () => {
    const config = defineVitestConfig({ root: { test: { passWithNoTests: false } } });

    expect(config.test?.passWithNoTests).toBe(false);
  });

  it('extends the default exclusions from Vitest rather than replacing them', () => {
    for (const project of getProjects(defineVitestConfig())) {
      expect(project.test?.exclude).toStrictEqual(expect.arrayContaining(['**/node_modules/**', '**/.git/**']));
    }
  });

  it('keeps a directory the caller excludes out of every project, after the ones always pruned', () => {
    const projects = getProjects(defineVitestConfig({ testCollectionExclude: ['generated'] }));

    for (const project of projects) {
      expect(project.test?.exclude).toStrictEqual([
        '**/node_modules/**',
        '**/.git/**',
        '**/coverage/**',
        '**/dist/**',
        '**/generated/**',
        ...(project.test?.name === 'unit' ? TIERED_PATTERNS : []),
      ]);
    }
  });

  // Arrays compose across layers everywhere else in this config, and a shared layer's exclusions and a package's
  // own are both meant to hold.
  it('concatenates the exclusions every layer declares', () => {
    const config = defineVitestConfig({ testCollectionExclude: ['shared'] }, { testCollectionExclude: ['local'] });

    for (const project of getProjects(config)) {
      expect(project.test?.exclude).toStrictEqual(expect.arrayContaining(['**/shared/**', '**/local/**']));
    }
  });

  it('emits a directory once when a layer names one the shared config already prunes', () => {
    const projects = getProjects(defineVitestConfig({ testCollectionExclude: ['dist'] }));

    for (const project of projects) {
      expect(project.test?.exclude?.filter((pattern) => pattern === '**/dist/**')).toHaveLength(1);
    }
  });

  // Vite lets a supplied `conditions` array replace its defaults rather than extend them, so emitting `source`
  // alone would drop `node` and `module` -- and a dependency branching on `browser` would then resolve its browser
  // entry inside a node test. Composed from Vite's exports, so a release changing either list fails here.
  it("adds the source condition to Vite's defaults for each environment, rather than replacing them", () => {
    const config = defineVitestConfig();

    expect(config.resolve?.conditions).toStrictEqual(SOURCE_CLIENT_CONDITIONS);
    expect(config.ssr?.resolve?.conditions).toStrictEqual(SOURCE_SERVER_CONDITIONS);
  });

  it('drops the source condition, and no other setting, when resolveFromSource is off', () => {
    const config = defineVitestConfig({ resolveFromSource: false });

    expect(config.resolve).toBeUndefined();
    expect(config.ssr).toBeUndefined();
    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  it("keeps a layer's own conditions when resolveFromSource is off", () => {
    const config = defineVitestConfig({ resolveFromSource: false, root: { resolve: { conditions: ['development'] } } });

    expect(config.resolve?.conditions).toStrictEqual(['development']);
  });

  // Vite holds `tsconfigPaths` outside its per-environment resolve options, so the top-level key is the whole
  // emission. That it reaches the environment a test's own imports resolve through is held by the tool-tier suite,
  // which no assertion on the config object can stand in for.
  it('emits tsconfig paths resolution, and no server twin, when the flag is on', () => {
    const config = defineVitestConfig({ tsconfigPaths: true });

    expect(config.resolve?.tsconfigPaths).toBe(true);
    expect(config.ssr?.resolve).toStrictEqual({ conditions: SOURCE_SERVER_CONDITIONS });
  });

  it('leaves tsconfig paths resolution off by default, as Vite does', () => {
    expect(defineVitestConfig().resolve?.tsconfigPaths).toBeUndefined();
  });

  // Both flags contribute to the same `resolve` block. One written over the other would drop the conditions, and
  // every cross-package import would resolve to `dist` with the suite still green.
  it('carries the source conditions and tsconfig paths together when both are on', () => {
    const config = defineVitestConfig({ resolveFromSource: true, tsconfigPaths: true });

    expect(config.resolve).toStrictEqual({ conditions: SOURCE_CLIENT_CONDITIONS, tsconfigPaths: true });
  });

  it('emits tsconfig paths resolution alone when resolveFromSource is off', () => {
    const config = defineVitestConfig({ resolveFromSource: false, tsconfigPaths: true });

    expect(config.resolve).toStrictEqual({ tsconfigPaths: true });
    expect(config.ssr).toBeUndefined();
  });

  // Without it, a suite that spawns git reads the developer's identity and can block on a signing passphrase,
  // and nothing in the run says so.
  it('isolates git subprocesses in every project', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(
      PROJECT_NAMES.map(() => [GIT_ISOLATION_SETUP_FILE]),
    );
  });

  it('declares no setup files at all when isolateGit is off', () => {
    const projects = getProjects(defineVitestConfig({ isolateGit: false }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(PROJECT_NAMES.map(() => undefined));
  });

  it("keeps a layer's own setup files when isolateGit is off", () => {
    const projects = getProjects(defineVitestConfig({ isolateGit: false, project: { setupFiles: ['./setup.ts'] } }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(PROJECT_NAMES.map(() => ['./setup.ts']));
  });

  it.for(['isolateGit', 'resolveFromSource'] as const)('lets a later layer turn %s back on', (flag) => {
    const config = defineVitestConfig({ [flag]: false }, { [flag]: true });

    expect(config.resolve?.conditions).toStrictEqual(SOURCE_CLIENT_CONDITIONS);
    expect(getProjects(config)[0]?.test?.setupFiles).toStrictEqual([GIT_ISOLATION_SETUP_FILE]);
  });

  // The two flags above default on, so one case covers both directions for them. This one defaults off, and each
  // direction crosses a different branch: one adds the key, the other has to leave the block without it.
  it('lets a later layer turn tsconfigPaths on', () => {
    const config = defineVitestConfig({ tsconfigPaths: false }, { tsconfigPaths: true });

    expect(config.resolve?.tsconfigPaths).toBe(true);
  });

  it('lets a later layer turn tsconfigPaths back off', () => {
    const config = defineVitestConfig({ tsconfigPaths: true }, { tsconfigPaths: false });

    expect(config.resolve?.tsconfigPaths).toBeUndefined();
  });

  it('applies a project override to every project', () => {
    const projects = getProjects(defineVitestConfig({ project: { setupFiles: ['./setup.ts'] } }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(
      PROJECT_NAMES.map(() => [GIT_ISOLATION_SETUP_FILE, './setup.ts']),
    );
  });

  it('applies a root override to the root config', () => {
    const config = defineVitestConfig({ root: { resolve: { conditions: ['development'] } } });

    expect(config.resolve?.conditions).toStrictEqual([...SOURCE_CLIENT_CONDITIONS, 'development']);
  });

  // Vitest resolves a test's imports through the server environment, so this is the seam a condition meant for
  // them travels through; the top-level array reaches the client environment alone.
  it('concatenates a layer condition onto the server array', () => {
    const config = defineVitestConfig({ root: { ssr: { resolve: { conditions: ['development'] } } } });

    expect(config.ssr?.resolve?.conditions).toStrictEqual([...SOURCE_SERVER_CONDITIONS, 'development']);
    expect(config.resolve?.conditions).toStrictEqual(SOURCE_CLIENT_CONDITIONS);
  });

  it('merges a root override into the existing block rather than replacing it', () => {
    const config = defineVitestConfig({ root: { test: { coverage: { reportsDirectory: './cov' } } } });

    expect(config.test?.coverage?.reportsDirectory).toBe('./cov');
    expect(config.test?.coverage?.provider).toBe('v8');
  });

  it('rejects a per-project option in the root seam', () => {
    const config = defineVitestConfig({
      root: {
        test: {
          // @ts-expect-error - a per-project option belongs in the `project` seam, not in `root`
          setupFiles: ['./setup.ts'],
        },
      },
    });

    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  it('folds layers left to right, so a later layer wins on a scalar', () => {
    const projects = getProjects(
      defineVitestConfig({ project: { testTimeout: 1_000 } }, { project: { testTimeout: 2_000 } }),
    );

    expect(projects.map((project) => project.test?.testTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 2_000));
  });

  // Order decides which setup runs first, so a shared layer's entry — which establishes the environment the rest
  // run in — has to stay ahead of whatever a package adds after it.
  it('keeps an earlier layer of array entries ahead of a later one', () => {
    const projects = getProjects(
      defineVitestConfig({ project: { setupFiles: ['./shared.ts'] } }, { project: { setupFiles: ['./package.ts'] } }),
    );

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(
      PROJECT_NAMES.map(() => [GIT_ISOLATION_SETUP_FILE, './shared.ts', './package.ts']),
    );
  });

  // Merging two built configs instead concatenates their `projects` arrays, which Vitest rejects at startup
  // because the four names then repeat.
  it('declares one project per tier however many layers fold', () => {
    const config = defineVitestConfig({ project: {} }, { root: {} }, { tiers: { tool: {} } });

    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  it('folds a root layer from any position, not only the first', () => {
    const config = defineVitestConfig(
      { root: { resolve: { conditions: ['development'] } } },
      { root: { test: { passWithNoTests: false } } },
    );

    expect(config.resolve?.conditions).toStrictEqual([...SOURCE_CLIENT_CONDITIONS, 'development']);
    expect(config.test?.passWithNoTests).toBe(false);
  });

  // The point of the seam: raising one tier's ceiling leaves `unit` on the tight budget that fails a hung test fast.
  it('targets one tier, leaving the others on their base budgets', () => {
    const budgets = getTestTimeouts(defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } }));

    expect(budgets.get('tool')).toBe(120_000);
    expect(budgets.get('unit')).toBeUndefined();
    expect(budgets.get('localhost')).toBe(30_000);
    expect(budgets.get('remote')).toBe(30_000);
  });

  // `unit` is the tier a uniform `project` override flattens, so it is the likeliest target — and the one a tier
  // list meaning "above unit" would leave unreachable.
  it('targets the unit tier, which the list of tiers above unit does not name', () => {
    const budgets = getTestTimeouts(defineVitestConfig({ tiers: { unit: { testTimeout: 500 } } }));

    expect(budgets.get('unit')).toBe(500);
    expect(budgets.get('tool')).toBe(30_000);
  });

  it('applies a tier target after the same layer of uniform options', () => {
    const budgets = getTestTimeouts(
      defineVitestConfig({ project: { testTimeout: 1_000 }, tiers: { tool: { testTimeout: 2_000 } } }),
    );

    expect(budgets.get('tool')).toBe(2_000);
    expect(budgets.get('unit')).toBe(1_000);
  });

  // Locality beats specificity across layers: the nearer config wins even where the further one was specific.
  // Pinned because folding every layer's uniform block before any tier target would invert it, and no assertion
  // about array order would notice -- that refactor keeps the entries contiguous.
  it('lets a later uniform block override an earlier layer of tier targets', () => {
    const budgets = getTestTimeouts(
      defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } }, { project: { testTimeout: 10_000 } }),
    );

    expect(budgets.get('tool')).toBe(10_000);
    expect(budgets.get('unit')).toBe(10_000);
  });

  // A conditional layer is the idiom a variadic signature invites, and the ternary's empty branch is `undefined`.
  // Every position is covered because the fold, the tier check, and the root merge each walk the list separately.
  it('skips an empty layer wherever it falls, so a conditional layer needs no spread', () => {
    const config = defineVitestConfig(undefined, { project: { testTimeout: 1_000 } }, undefined);

    expect(getTestTimeouts(config).get('unit')).toBe(1_000);
    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  it('builds the default config when every layer is empty', () => {
    expect(defineVitestConfig(undefined).test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  // The base sets both budgets from one field so they cannot drift; a tier target sets whichever key it names and
  // leaves the other alone. Pinned because the config then reads 120s while a hook still fails at 30s.
  it('leaves the hook budget alone when a tier target names only the test budget', () => {
    const tool = getProjects(defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } })).find(
      ({ test }) => test?.name === 'tool',
    );

    expect(tool?.test?.testTimeout).toBe(120_000);
    expect(tool?.test?.hookTimeout).toBe(30_000);
  });

  // Ignoring it would leave the suite green on the budget the key failed to change, which nothing reports.
  it('rejects a tiers key naming no tier', () => {
    const build = () =>
      defineVitestConfig({
        // @ts-expect-error - the key names no tier; a JavaScript consumer can still write it
        tiers: { toool: { testTimeout: 1_000 } },
      });

    expect(build).toThrow('Unknown tier "toool" in `tiers`. Valid tiers: unit, tool, localhost, remote.');
  });

  it('checks every layer for an unknown tier, not only the last', () => {
    const build = () =>
      defineVitestConfig(
        {
          // @ts-expect-error - the key names no tier; a JavaScript consumer can still write it
          tiers: { toool: {} },
        },
        { project: {} },
      );

    expect(build).toThrow('Unknown tier "toool"');
  });
});

describe(defineRootVitestConfig, () => {
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

  it('takes the resolution flags the package factory takes', ({ workspaceTree }) => {
    const config = defineRootVitestConfig({ monorepoRoot: workspaceTree.dir, tsconfigPaths: true });

    expect(config.resolve?.tsconfigPaths).toBe(true);
  });

  it('takes the collection exclusions the package factory takes', ({ workspaceTree }) => {
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

  it('throws a message naming the directory when it holds no workspace manifest', ({ notARootTree }) => {
    expect(() => defineRootVitestConfig({ monorepoRoot: notARootTree.dir })).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARootTree.dir}`,
    );
  });

  it('throws when given no options at all, which types alone cannot prevent in a JavaScript config', () => {
    // @ts-expect-error -- the argument is required; this is the call a JavaScript consumer can still make.
    expect(() => defineRootVitestConfig()).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  it('throws when given options carrying no monorepo root', () => {
    // @ts-expect-error -- the option is required; a JavaScript consumer can still omit it.
    expect(() => defineRootVitestConfig({})).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });

  // A relative root reaches `path.join` and `projectRoot` unresolved, so the config would describe whichever
  // monorepo the run started in — the resolution this option replaces.
  it('throws when the monorepo root is not an absolute path', () => {
    for (const monorepoRoot of ['', '.', 'packages/..']) {
      expect(() => defineRootVitestConfig({ monorepoRoot })).toThrow('defineRootVitestConfig requires `monorepoRoot`');
    }
  });

  it('excludes no packages when the manifest declares none, as in a single-package repo', ({ singlePackageTree }) => {
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

  it('reports no coverage of its own', ({ workspaceTree }) => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }).test?.coverage?.include).toStrictEqual([]);
  });

  it('accepts a run that collects no test files', ({ workspaceTree }) => {
    expect(defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }).test?.passWithNoTests).toBe(true);
  });

  it('skips an empty layer ahead of the layer carrying the monorepo root', ({ workspaceTree }) => {
    const config = defineRootVitestConfig(undefined, { monorepoRoot: workspaceTree.dir });

    expect(getProjects(config)).toHaveLength(4);
  });

  it('folds a shared layer ahead of the layer carrying the monorepo root', ({ workspaceTree }) => {
    const config = defineRootVitestConfig(
      { project: { setupFiles: ['./shared.ts'] }, root: { resolve: { conditions: ['development'] } } },
      { monorepoRoot: workspaceTree.dir },
    );

    expect(config.resolve?.conditions).toStrictEqual([...SOURCE_CLIENT_CONDITIONS, 'development']);
    for (const project of getProjects(config)) {
      expect(project.test?.setupFiles).toStrictEqual([GIT_ISOLATION_SETUP_FILE, './shared.ts']);
      expect(project.root).toBe(workspaceTree.dir);
    }
  });

  // A shared layer describes settings, not which repo they belong to, so the root has to ride on the config file's
  // own layer — the only one whose `import.meta.dirname` states this repo.
  it('throws when the last layer carries no monorepo root, however many precede it', ({ workspaceTree }) => {
    const build = () =>
      // @ts-expect-error - the last layer must carry `monorepoRoot`; a JavaScript consumer can still omit it
      defineRootVitestConfig({ monorepoRoot: workspaceTree.dir }, { project: {} });

    expect(build).toThrow('defineRootVitestConfig requires `monorepoRoot`');
  });
});

describe('project file selection', () => {
  // `for` rather than `each`: only `for` hands the fixture context to the case body.
  it.for(['tool', 'localhost', 'remote'])(
    'selects only its own infix for the %s project',
    (tier, { selectionTree }) => {
      expect(selectFiles(tier, selectionTree.dir)).toStrictEqual([`src/__tests__/thing.${tier}.test.ts`]);
    },
  );

  it('runs a file whose infix matches no tier under the unit project', ({ selectionTree }) => {
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
    const collected = PROJECT_NAMES.flatMap((name) => selectFiles(name, selectionTree.dir));

    expect(collected).toStrictEqual([...new Set(collected)]);
  });

  // A copy of the suite under `dist/` runs green against stale code, so no project may collect it.
  it('leaves a test file copied into build output out of every project', ({ selectionTree }) => {
    for (const name of PROJECT_NAMES) {
      expect(selectFiles(name, selectionTree.dir)).not.toContain('dist/src/__tests__/copied.test.ts');
    }
  });

  // The exclusion the repo declares is what keeps the sweep and the collection glob describing one scope. Both
  // halves are asserted here, because a directory Vitest still collects from is one the sweep must not skip.
  it('drops a generated directory from collection once the repo excludes it', ({ selectionTree }) => {
    const excluded = { testCollectionExclude: ['generated'] };

    expect(selectFiles('unit', selectionTree.dir)).toContain('generated/__tests__/scaffold.test.ts');
    expect(selectFiles('unit', selectionTree.dir, excluded)).not.toContain('generated/__tests__/scaffold.test.ts');
  });
});

/** Narrows the declared projects to the inline form, which is the only form the factories emit. */
function getProjects(config: ViteUserConfig): TestProjectInlineConfiguration[] {
  return (config.test?.projects ?? []).filter(isInlineProject);
}

function isInlineProject(project: TestProjectConfiguration): project is TestProjectInlineConfiguration {
  return typeof project === 'object' && !(project instanceof Promise);
}

/** Maps each tier's name to its test budget, for assertions about which tiers an option reached. */
function getTestTimeouts(config: ViteUserConfig): Map<string, number | undefined> {
  const projects = getProjects(config);

  return new Map(
    PROJECT_NAMES.map((name) => [name, projects.find(({ test }) => test?.name === name)?.test?.testTimeout]),
  );
}

/** Resolves a project's patterns against the fixture tree using the engine Vitest discovers with. */
function selectFiles(name: string, cwd: string, options?: VitestConfigOptions): string[] {
  const project = getProjects(defineVitestConfig(options)).find(({ test }) => test?.name === name);

  return globSync(project?.test?.include ?? [], { cwd, ignore: project?.test?.exclude ?? [] }).toSorted();
}
