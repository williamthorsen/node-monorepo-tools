import { describe, expect, it, vi } from 'vitest';
import type { ViteUserConfig } from 'vitest/config';

import { listGitIgnoredPaths } from '../git-ignored-paths.ts';
import { isObject } from '../helpers/type-guards.ts';
import {
  CLIENT_CONDITIONS,
  getProjects,
  GIT_ISOLATION_SETUP_FILE,
  PROJECT_NAMES,
  SERVER_CONDITIONS,
  TIERED_PATTERNS,
} from '../test-utils/vitest-config-fixtures.ts';
import { defineVitestConfig } from '../vitest.ts';

// Keep the config from spawning git, which would move this file out of the unit tier.
vi.mock(import('../git-ignored-paths.ts'), () => ({ listGitIgnoredPaths: vi.fn(() => []) }));

/** The plugin that the config emits to resolve the `source` condition, named as the config names it. */
const SOURCE_RESOLUTION_PLUGIN = 'nmr:resolve-from-source';

describe(defineVitestConfig, () => {
  it('declares every tier, each inheriting the root config', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.name)).toStrictEqual(PROJECT_NAMES);
    expect(projects.map((project) => project.extends)).toStrictEqual(PROJECT_NAMES.map(() => true));
  });

  // Vitest's defaults are unit-test budgets: 5s for a test, 10s for a hook. A tier test waits on something it
  // doesn't control, and coverage instrumentation multiplies that wait, so the defaults make a green suite flaky
  // once `test:coverage` collects it. Hooks have the same budget as tests because a tier that scaffolds in
  // `beforeAll` moves the wait out of the scope of `testTimeout`, and raising the test budget alone never covers it.
  it('gives every tier above unit budgets large enough for coverage instrumentation', () => {
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

  // Distinct values rather than one, so that the assertion would catch a seam that set both budgets from either key.
  it('lets the project seam override both tier budgets', () => {
    const projects = getProjects(defineVitestConfig({ project: { hookTimeout: 2_000, testTimeout: 1_000 } }));

    expect(projects.map((project) => project.test?.hookTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 2_000));
    expect(projects.map((project) => project.test?.testTimeout)).toStrictEqual(PROJECT_NAMES.map(() => 1_000));
  });

  // Because neither has a script, nothing would report their absence at run time. An undeclared tier's files fall
  // into the residual and run in the default gate, which is the silent failure that declaring them prevents.
  it('declares the scriptless tiers, so that their files cannot fall into the residual', () => {
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

  it('keeps the settings that the shared config has always applied', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.silent).toBe('passed-only');
    expect(rootTest.watch).toBe(false);
    expect(rootTest.coverage?.provider).toBe('v8');
    expect(rootTest.coverage?.enabled).toBe(false);
    expect(rootTest.coverage?.include).toStrictEqual(['**/src/**/*.{ts,tsx}']);
  });

  // Pinned rather than sampled: The risk is an addition, not a removal.
  it('excludes from coverage only what cannot contain runtime code', () => {
    const rootTest = defineVitestConfig().test ?? {};

    expect(rootTest.coverage?.exclude).toStrictEqual(['**/__{fixtures,mocks,tests}__/**', '**/index.ts', '**/*.d.ts']);
  });

  it('accepts a run that does not collect any test files', () => {
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

  it('keeps a directory excluded by the caller out of every project, after the ones always pruned', () => {
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
  // own are both meant to apply.
  it('concatenates the exclusions declared by every layer', () => {
    const config = defineVitestConfig({ testCollectionExclude: ['shared'] }, { testCollectionExclude: ['local'] });

    for (const project of getProjects(config)) {
      expect(project.test?.exclude).toStrictEqual(expect.arrayContaining(['**/shared/**', '**/local/**']));
    }
  });

  it('excludes each path ignored by git under the working directory, anchored to it', () => {
    vi.mocked(listGitIgnoredPaths).mockReturnValueOnce(['.netlify/', 'src/__tests__/scratch.local.test.ts']);

    const projects = getProjects(defineVitestConfig());

    expect(listGitIgnoredPaths).toHaveBeenLastCalledWith(process.cwd());
    for (const project of projects) {
      expect(project.test?.exclude).toStrictEqual(
        expect.arrayContaining(['.netlify/**', 'src/__tests__/scratch.local.test.ts']),
      );
    }
  });

  it('escapes pattern syntax in an ignored path, so the glob matches that path alone', () => {
    vi.mocked(listGitIgnoredPaths).mockReturnValueOnce(['out[1]/', '(draft) *.test.ts']);

    const projects = getProjects(defineVitestConfig());

    for (const project of projects) {
      expect(project.test?.exclude).toStrictEqual(
        expect.arrayContaining([String.raw`out\[1\]/**`, String.raw`\(draft\) \*.test.ts`]),
      );
    }
  });

  it('emits a directory once when a layer names one that the shared config already prunes', () => {
    const projects = getProjects(defineVitestConfig({ testCollectionExclude: ['dist'] }));

    for (const project of projects) {
      expect(project.test?.exclude?.filter((pattern) => pattern === '**/dist/**')).toHaveLength(1);
    }
  });

  // Because Vitest turns the server list into `--conditions` flags on the worker process, an entry here applies to
  // every package that Node resolves natively. `source` is therefore resolved by a plugin rather than named here, and
  // what remains is Vite's own defaults, composed from its exports so that a release changing either list fails here.
  it("emits Vite's default conditions for each environment, and does not add any condition of its own", () => {
    const config = defineVitestConfig();

    expect(config.resolve?.conditions).toStrictEqual(CLIENT_CONDITIONS);
    expect(config.ssr?.resolve?.conditions).toStrictEqual(SERVER_CONDITIONS);
    expect(config.resolve?.conditions).not.toContain('source');
    expect(config.ssr?.resolve?.conditions).not.toContain('source');
  });

  it('resolves the source condition through a plugin by default', () => {
    expect(getPluginNames(defineVitestConfig())).toContain(SOURCE_RESOLUTION_PLUGIN);
  });

  it('drops only the plugin when shouldResolveFromSource is off', () => {
    const config = defineVitestConfig({ shouldResolveFromSource: false });

    expect(getPluginNames(config)).not.toContain(SOURCE_RESOLUTION_PLUGIN);
    expect(config.resolve?.conditions).toStrictEqual(CLIENT_CONDITIONS);
    expect(config.ssr?.resolve?.conditions).toStrictEqual(SERVER_CONDITIONS);
    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  // The defaults are emitted whichever way the flag is set, because a supplied array replaces Vite's rather than
  // extending it: A repo turning source resolution off would otherwise resolve a `module` entry differently.
  it("concatenates a layer's own conditions onto the defaults when shouldResolveFromSource is off", () => {
    const config = defineVitestConfig({
      shouldResolveFromSource: false,
      root: { resolve: { conditions: ['development'] } },
    });

    expect(config.resolve?.conditions).toStrictEqual([...CLIENT_CONDITIONS, 'development']);
  });

  // Vite keeps `tsconfigPaths` outside its per-environment resolve options, so the config emits only the top-level
  // key. The tool-tier suite verifies that it applies to the environment through which a test's own imports resolve;
  // an assertion on the config object cannot stand in for that suite.
  it('emits tsconfig paths resolution without a server-environment copy when the flag is on', () => {
    const config = defineVitestConfig({ tsconfigPaths: true });

    expect(config.resolve?.tsconfigPaths).toBe(true);
    expect(config.ssr?.resolve).toStrictEqual({ conditions: SERVER_CONDITIONS });
  });

  it('leaves tsconfig paths resolution off by default, as Vite does', () => {
    expect(defineVitestConfig().resolve?.tsconfigPaths).toBeUndefined();
  });

  // Both settings contribute to the same `resolve` block. One written over the other would drop the conditions,
  // and a dependency exposing a `module` entry would resolve elsewhere with the suite still green.
  it('emits the conditions and tsconfig paths together', () => {
    const config = defineVitestConfig({ shouldResolveFromSource: true, tsconfigPaths: true });

    expect(config.resolve).toStrictEqual({ conditions: CLIENT_CONDITIONS, tsconfigPaths: true });
  });

  it('keeps the conditions alongside tsconfig paths when shouldResolveFromSource is off', () => {
    const config = defineVitestConfig({ shouldResolveFromSource: false, tsconfigPaths: true });

    expect(config.resolve).toStrictEqual({ conditions: CLIENT_CONDITIONS, tsconfigPaths: true });
    expect(config.ssr?.resolve?.conditions).toStrictEqual(SERVER_CONDITIONS);
  });

  // Without it, a suite that spawns git reads the developer's identity and can block on a signing passphrase,
  // and nothing in the run says so.
  it('isolates git subprocesses in every project', () => {
    const projects = getProjects(defineVitestConfig());

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(
      PROJECT_NAMES.map(() => [GIT_ISOLATION_SETUP_FILE]),
    );
  });

  it('does not declare any setup files when shouldIsolateGit is off', () => {
    const projects = getProjects(defineVitestConfig({ shouldIsolateGit: false }));

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(PROJECT_NAMES.map(() => undefined));
  });

  it("keeps a layer's own setup files when shouldIsolateGit is off", () => {
    const projects = getProjects(
      defineVitestConfig({ shouldIsolateGit: false, project: { setupFiles: ['./setup.ts'] } }),
    );

    expect(projects.map((project) => project.test?.setupFiles)).toStrictEqual(PROJECT_NAMES.map(() => ['./setup.ts']));
  });

  it.for(['shouldIsolateGit', 'shouldResolveFromSource'] as const)('lets a later layer turn %s back on', (flag) => {
    const config = defineVitestConfig({ [flag]: false }, { [flag]: true });

    expect(getPluginNames(config)).toContain(SOURCE_RESOLUTION_PLUGIN);
    expect(getProjects(config)[0]?.test?.setupFiles).toStrictEqual([GIT_ISOLATION_SETUP_FILE]);
  });
});

// region | Helpers

/** Names every plugin declared by a config, so that an assertion can check one without running Vite. */
function getPluginNames(config: ViteUserConfig): string[] {
  return (config.plugins ?? []).flatMap((plugin) =>
    isObject(plugin) && typeof plugin.name === 'string' ? plugin.name : [],
  );
}

// endregion | Helpers
