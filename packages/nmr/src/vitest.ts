import path from 'node:path';

import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';
import { defaultExclude, mergeConfig } from 'vitest/config';
import type { InlineConfig, ProjectConfig } from 'vitest/node';

import { isObject } from './helpers/type-guards.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/**
 * Test options Vitest honours only at the root of a `projects` config. Derived from Vitest's own types rather than
 * hand-listed, so an option that changes scope in a later release changes scope here too.
 */
export type RootTestOptions = Omit<InlineConfig, keyof ProjectConfig>;

/** Root-scoped overrides: Vite-level options plus the test options that survive at the root. */
export type RootOverrides = Omit<ViteUserConfig, 'test'> & { test?: RootTestOptions };

export interface VitestConfigOptions {
  /**
   * Merged into the root config.
   * Vite-level options such as `resolve.conditions` reach every project, because each project declares `extends: true`.
   */
  root?: RootOverrides;

  /** Merged into every declared project. This is where per-project options such as `setupFiles` go. */
  project?: ProjectConfig;

  /**
   * Merged into one tier's project alone, after this layer's `project` block. Raising a budget for `tool` here
   * leaves `unit` on the tight default that makes a hung unit test fail fast, which a uniform `project` override
   * would flatten.
   */
  tiers?: Partial<Record<TierName, ProjectConfig>>;
}

export interface RootVitestConfigOptions extends VitestConfigOptions {
  /**
   * An absolute path to the monorepo root, which must hold `pnpm-workspace.yaml`. A root config sits at that
   * directory by construction, so this is `import.meta.dirname`. Stated rather than searched for: resolving it
   * from the working directory would make the config describe whichever monorepo the run happened to start in.
   */
  monorepoRoot: string;
}

/**
 * The tiers above `unit`, ordered by the furthest thing a test reaches. A tier names what a test reaches, never how
 * it invokes it: a test driving a compiler through its JavaScript API is `tool`, exactly as one spawning `tsc` would
 * be. Each tier's name is also its filename infix, so `parse.tool.test.ts` lands in `tool`.
 */
const TIERS = ['tool', 'localhost', 'remote'] as const;

/**
 * The full ladder, `unit` included. `TIERS` deliberately means the tiers *above* `unit`, because `TIERED_PATTERNS`
 * subtracts them to form the residual. This is the list a consumer targets, and `unit` is the likeliest target,
 * being the tier a uniform `project` override otherwise flattens.
 */
const TIER_NAMES = ['unit', ...TIERS] as const;

/** One of the four isolation tiers. */
export type TierName = (typeof TIER_NAMES)[number];

// `unit` includes every test file and subtracts the tiered ones, so a file whose infix matches no tier still runs
// rather than being dropped by an allow-list. Derived from `TIERS` rather than hand-listed: a tier added there and
// forgotten here would have its files collected twice, by its own project and by the residual, with the suite green.
const TIERED_PATTERNS = TIERS.flatMap(buildTierPatterns);

/**
 * Timeout for every tier above `unit`, whose tests wait on something they don't control. Vitest's defaults are
 * unit-test budgets -- 5s for a test, 10s for a hook -- and a test that drives a compiler already approaches the
 * first, while coverage instrumentation roughly quadruples the wall time.
 *
 * One value covers both budgets. A tier that scaffolds in `beforeAll` for speed moves that wait out from under
 * `testTimeout` entirely, so raising the test budget alone leaves the slowest operation on the unit-test default.
 *
 * A per-project value rather than a root one, so the fast tier keeps the tight budget that makes a hung unit test
 * fail quickly. The `project` seam merges over this and reaches every project at once; the `tiers` seam targets one.
 */
const TIER_TIMEOUT = 30_000;

const ALL_TEST_PATTERNS = ['**/__tests__/**/*.test.{ts,tsx}'];

// Fixtures are excluded from coverage but never from collection: a coverage exclude cannot hide a real test, while a
// collection exclude could swallow one legitimately placed under `fixtures/`. `__snapshots__` needs no entry because
// `.snap` files never match the include.
const COVERAGE_EXCLUDE = [
  '**/__{fixtures,mocks,tests}__/**',
  '**/index.ts',
  '**/mock*.{ts,tsx}',
  '**/*.d.ts',
  '**/*.types.ts',
];

// Excluded from collection but deliberately not from coverage: a stale test copy under `dist/` passes green, which a
// consumer cannot self-diagnose, whereas a `dist/` entry in the coverage report is a visible 0% they can.
const BUILD_OUTPUT_EXCLUDE = ['**/dist/**'];

const PACKAGE_COVERAGE_INCLUDE = ['**/src/**/*.{ts,tsx}'];

const MISSING_MONOREPO_ROOT =
  'defineRootVitestConfig requires `monorepoRoot`, an absolute path to the directory holding pnpm-workspace.yaml. Pass `import.meta.dirname` in the last options layer, from the root config.';

/**
 * Builds the shared Vitest config for a workspace package, declaring the `unit`, `tool`, `localhost`, and `remote`
 * projects. Select them at run time with `--project`, which unions when repeated and accepts negation.
 *
 * Layers fold left to right, later winning and arrays composing, so a config file shares settings by passing a
 * layer ahead of its own. Merging this function's *output* instead is unsupported and silent in two ways: the two
 * `projects` arrays concatenate into eight, and a per-project option lands at a root that ignores it.
 */
export function defineVitestConfig(...layers: VitestConfigOptions[]): ViteUserConfig {
  return buildConfig(layers, { coverageInclude: PACKAGE_COVERAGE_INCLUDE });
}

/**
 * Builds the shared Vitest config for repo-root tests. Excludes every workspace package from all projects, and
 * reports no coverage of its own — packages cover their own sources.
 *
 * `monorepoRoot` rides on the last layer, which is the config file's own: a shared layer describes settings, not
 * which repo they belong to, and only the root config's `import.meta.dirname` states this one. The type requires
 * that layer, while the guard below still catches the JavaScript config that types never reach.
 */
export function defineRootVitestConfig(...layers: [...VitestConfigOptions[], RootVitestConfigOptions]): ViteUserConfig {
  // Reading through `unknown` is what keeps the check live: the declared type alone would make it statically
  // dead. A relative path would resolve against the working directory, which is the resolution this option
  // exists to replace.
  const lastLayer: unknown = layers.at(-1);
  const monorepoRoot: unknown = isObject(lastLayer) ? lastLayer.monorepoRoot : undefined;

  if (typeof monorepoRoot !== 'string' || !path.isAbsolute(monorepoRoot)) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  return buildConfig(layers, {
    coverageInclude: [],
    projectExclude: getWorkspaceExcludePatterns(monorepoRoot),
    projectRoot: monorepoRoot,
  });
}

interface BuildOptions {
  coverageInclude: string[];
  projectExclude?: string[];
  projectRoot?: string;
}

function buildConfig(
  layers: readonly VitestConfigOptions[],
  { coverageInclude, projectExclude = [], projectRoot }: BuildOptions,
): ViteUserConfig {
  assertKnownTiers(layers);

  const config: ViteUserConfig = {
    test: {
      coverage: {
        enabled: false, // don't check coverage unless the `--coverage` flag is passed
        exclude: COVERAGE_EXCLUDE,
        include: coverageInclude,
        provider: 'v8',
      },
      passWithNoTests: true, // `nmr test:tool` fans out over packages holding no tool-tier tests
      projects: buildProjects(layers, projectExclude, projectRoot),
      silent: 'passed-only', // see logs from failing tests only
      watch: false, // don't enter watch mode unless the `--watch` flag is passed
    },
  };

  return layers.reduce<ViteUserConfig>((merged, { root }) => (root ? mergeConfig(merged, root) : merged), config);
}

/** One project's definition before it becomes a Vitest project config: the residual `unit`, then every tier in `TIERS`. */
interface ProjectTier {
  exclude: string[];
  include: string[];
  name: TierName;
  /** Budget for `hookTimeout` and `testTimeout` alike, held as one field so the two cannot drift apart. */
  timeout?: number;
}

/** Builds one project per tier, in ladder order, each inheriting the root config. */
function buildProjects(
  layers: readonly VitestConfigOptions[],
  extraExclude: string[],
  projectRoot: string | undefined,
): TestProjectInlineConfiguration[] {
  const projectTiers: ProjectTier[] = [
    { exclude: TIERED_PATTERNS, include: ALL_TEST_PATTERNS, name: 'unit' },
    ...TIERS.map((tier) => ({
      exclude: [],
      include: buildTierPatterns(tier),
      name: tier,
      timeout: TIER_TIMEOUT,
    })),
  ];

  return projectTiers.map(({ exclude, include, name, timeout }) => {
    const project: TestProjectInlineConfiguration = {
      // Without this, Vitest gives the project no Vite config file at all, so root-level options such as
      // `resolve.conditions` never reach it.
      extends: true,
      // Patterns resolve against the project root, which otherwise defaults to the working directory.
      ...(projectRoot !== undefined && { root: projectRoot }),
      test: {
        exclude: [...defaultExclude, ...BUILD_OUTPUT_EXCLUDE, ...exclude, ...extraExclude],
        include,
        name,
        ...(timeout !== undefined && { hookTimeout: timeout, testTimeout: timeout }),
      },
    };

    return layers.reduce((merged, layer) => applyLayer(merged, layer, name), project);
  });
}

/**
 * Applies one layer to one project: its uniform `project` block, then whatever it targets at this tier.
 *
 * Layers apply in sequence rather than being merged with each other first, which is what keeps each layer's array
 * entries contiguous. A shared `setupFiles` entry therefore precedes every entry a later layer adds — load-bearing
 * where the shared entry establishes the environment the later ones run in.
 */
function applyLayer(
  project: TestProjectInlineConfiguration,
  layer: VitestConfigOptions,
  tier: TierName,
): TestProjectInlineConfiguration {
  const withProject = layer.project ? mergeConfig(project, { test: layer.project }) : project;
  const targeted = layer.tiers?.[tier];

  return targeted ? mergeConfig(withProject, { test: targeted }) : withProject;
}

/**
 * Rejects a `tiers` key naming no tier. Ignoring it would leave the suite green on whichever budget the key failed
 * to change, which a consumer cannot self-diagnose. A tier renamed in a later nmr release is a breaking change that
 * ships with a migration note, so the throw is that migration's signal rather than a surprise.
 */
function assertKnownTiers(layers: readonly VitestConfigOptions[]): void {
  const known: readonly string[] = TIER_NAMES;

  for (const { tiers } of layers) {
    for (const name of Object.keys(tiers ?? {})) {
      if (!known.includes(name)) {
        throw new TypeError(`Unknown tier "${name}" in \`tiers\`. Valid tiers: ${TIER_NAMES.join(', ')}.`);
      }
    }
  }
}

/** Builds the collection patterns for one tier. Every project collects from `__tests__` directories alone. */
function buildTierPatterns(tier: string): string[] {
  return [`**/__tests__/**/*.${tier}.test.{ts,tsx}`];
}

/** Resolves each workspace package directory to a glob relative to the monorepo root. */
function getWorkspaceExcludePatterns(monorepoRoot: string): string[] {
  return getWorkspacePackageDirs(monorepoRoot)
    .map((dir) => `${path.relative(monorepoRoot, dir).split(path.sep).join('/')}/**`)
    .toSorted();
}
