import { describe, expect, it, vi } from 'vitest';
import type { ViteUserConfig } from 'vitest/config';

import {
  CLIENT_CONDITIONS,
  getProjects,
  GIT_ISOLATION_SETUP_FILE,
  PROJECT_NAMES,
  SERVER_CONDITIONS,
} from '../test-utils/vitest-config-fixtures.ts';
import { defineVitestConfig } from '../vitest.ts';

// Keep the config from spawning git, which would move this file out of the unit tier.
vi.mock(import('../git-ignored-paths.ts'), () => ({ listGitIgnoredPaths: vi.fn(() => []) }));

describe(defineVitestConfig, () => {
  // `shouldResolveFromSource` and `shouldIsolateGit` default on, so one case covers both directions for each.
  // `tsconfigPaths` defaults off, and each direction exercises a different branch: One adds the key, the other has
  // to leave the block without it.
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

    expect(config.resolve?.conditions).toStrictEqual([...CLIENT_CONDITIONS, 'development']);
  });

  // Because Vitest resolves a test's imports through the server environment, a condition meant for them has to be
  // set in this array; the top-level array applies to the client environment alone.
  it('concatenates a layer condition onto the server array', () => {
    const config = defineVitestConfig({ root: { ssr: { resolve: { conditions: ['development'] } } } });

    expect(config.ssr?.resolve?.conditions).toStrictEqual([...SERVER_CONDITIONS, 'development']);
    expect(config.resolve?.conditions).toStrictEqual(CLIENT_CONDITIONS);
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

  // Order decides which setup runs first. A shared layer's entry, which establishes the environment in which the
  // rest run, has to stay ahead of whatever a package adds after it.
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

    expect(config.resolve?.conditions).toStrictEqual([...CLIENT_CONDITIONS, 'development']);
    expect(config.test?.passWithNoTests).toBe(false);
  });

  // The point of the seam: Raising one tier's ceiling leaves `unit` on the tight budget that fails a hung test fast.
  it('targets one tier, leaving the others on their base budgets', () => {
    const budgets = getTestTimeouts(defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } }));

    expect(budgets.get('tool')).toBe(120_000);
    expect(budgets.get('unit')).toBeUndefined();
    expect(budgets.get('localhost')).toBe(30_000);
    expect(budgets.get('remote')).toBe(30_000);
  });

  // `unit` is the tier that a uniform `project` override flattens, so it is the likeliest target, and the one that a
  // tier list meaning "above unit" would leave unreachable.
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

  // Locality beats specificity across layers: The nearer config wins even when the further one was specific.
  // Pinned because folding every layer's uniform block before any tier target would invert it, and an assertion
  // about array order would not notice; that refactor keeps the entries contiguous.
  it('lets a later uniform block override an earlier layer of tier targets', () => {
    const budgets = getTestTimeouts(
      defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } }, { project: { testTimeout: 10_000 } }),
    );

    expect(budgets.get('tool')).toBe(10_000);
    expect(budgets.get('unit')).toBe(10_000);
  });

  // A conditional layer is the idiom that a variadic signature invites, and the ternary's empty branch is `undefined`.
  // Every position is covered because the fold, the tier check, and the root merge each walk the list separately.
  it('skips an empty layer wherever it falls, so a conditional layer does not need a spread', () => {
    const config = defineVitestConfig(undefined, { project: { testTimeout: 1_000 } }, undefined);

    expect(getTestTimeouts(config).get('unit')).toBe(1_000);
    expect(config.test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  it('builds the default config when every layer is empty', () => {
    expect(defineVitestConfig(undefined).test?.projects).toHaveLength(PROJECT_NAMES.length);
  });

  // The base sets both budgets from one field so that they cannot drift; a tier target sets whichever key it names
  // and leaves the other alone. Pinned because the config then reads 120s while a hook still fails at 30s.
  it('leaves the hook budget alone when a tier target names only the test budget', () => {
    const tool = getProjects(defineVitestConfig({ tiers: { tool: { testTimeout: 120_000 } } })).find(
      ({ test }) => test?.name === 'tool',
    );

    expect(tool?.test?.testTimeout).toBe(120_000);
    expect(tool?.test?.hookTimeout).toBe(30_000);
  });

  // Ignoring it would leave the suite green on the budget that the key failed to change, which nothing reports.
  it('rejects a tiers key that does not name a tier', () => {
    const build = () =>
      defineVitestConfig({
        // @ts-expect-error - the key does not name a tier; a JavaScript consumer can still write it
        tiers: { toool: { testTimeout: 1_000 } },
      });

    expect(build).toThrow('Unknown tier "toool" in `tiers`. Valid tiers: unit, tool, localhost, remote.');
  });

  it('checks every layer for an unknown tier, not only the last', () => {
    const build = () =>
      defineVitestConfig(
        {
          // @ts-expect-error - the key does not name a tier; a JavaScript consumer can still write it
          tiers: { toool: {} },
        },
        { project: {} },
      );

    expect(build).toThrow('Unknown tier "toool"');
  });

  // `resolveFlag` reads each layer by key, so an old spelling would otherwise leave the flag on its default with
  // nothing in the run reporting it.
  it('rejects the retired isolateGit, naming its replacement', () => {
    // @ts-expect-error - the option was renamed; a JavaScript consumer can still write the old spelling
    const build = () => defineVitestConfig({ isolateGit: false });

    expect(build).toThrow('Invalid Vitest config: `isolateGit` was renamed to `shouldIsolateGit`.');
  });

  it('rejects the retired resolveFromSource, naming its replacement', () => {
    // @ts-expect-error - the option was renamed; a JavaScript consumer can still write the old spelling
    const build = () => defineVitestConfig({ resolveFromSource: false });

    expect(build).toThrow('Invalid Vitest config: `resolveFromSource` was renamed to `shouldResolveFromSource`.');
  });

  // Asserted whole, because the recognized set is the remedy on which the consumer acts: A message naming the bad
  // key and nothing else leaves them to guess the spelling that it should have been.
  it('rejects an option key outside the recognized set, naming it and the recognized set', () => {
    // @ts-expect-error - the key is a typo; a JavaScript consumer can still write it
    const build = () => defineVitestConfig({ tsconfigPath: true });

    expect(build).toThrow(
      'Invalid Vitest config: unrecognized option `tsconfigPath`. Recognized: `project`, `root`, ' +
        '`shouldIsolateGit`, `shouldResolveFromSource`, `testCollectionExclude`, `tiers`, `tsconfigPaths`.',
    );
  });

  it('names every unrecognized key of one layer, sorted', () => {
    // @ts-expect-error - both keys are typos; a JavaScript consumer can still write them
    const build = () => defineVitestConfig({ tsconfigPath: true, isolateGitt: false });

    expect(build).toThrow('Invalid Vitest config: unrecognized options `isolateGitt`, `tsconfigPath`.');
  });

  it('checks every layer for an unrecognized key, not only the last', () => {
    // @ts-expect-error - the key is a typo; a JavaScript consumer can still write it
    const build = () => defineVitestConfig({ tsconfigPath: true }, { project: {} });

    expect(build).toThrow('unrecognized option `tsconfigPath`');
  });

  // Only `defineRootVitestConfig` reads this key, and only from its final layer. Recognizing it here would accept
  // a setting that nothing reads.
  it('rejects the root-only monorepoRoot', () => {
    // @ts-expect-error - the option belongs to `defineRootVitestConfig`; a JavaScript consumer can still write it
    const build = () => defineVitestConfig({ monorepoRoot: '/repo' });

    expect(build).toThrow('unrecognized option `monorepoRoot`');
  });
});

// region | Helpers

/** Maps each tier's name to its test budget, for assertions about which tiers an option applied to. */
function getTestTimeouts(config: ViteUserConfig): Map<string, number | undefined> {
  const projects = getProjects(config);

  return new Map(
    PROJECT_NAMES.map((name) => [name, projects.find(({ test }) => test?.name === name)?.test?.testTimeout]),
  );
}

// endregion | Helpers
