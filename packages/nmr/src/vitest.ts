import path from 'node:path';

import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';
import { defaultExclude, mergeConfig } from 'vitest/config';
import type { InlineConfig, ProjectConfig } from 'vitest/node';

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

// `unit` includes every test file and subtracts the tiered ones, so a file whose infix matches no tier still runs
// rather than being dropped by an allow-list. Derived from `TIERS` rather than hand-listed: a tier added there and
// forgotten here would have its files collected twice, by its own project and by the residual, with the suite green.
const TIERED_PATTERNS = TIERS.flatMap(buildTierPatterns);

/**
 * Timeout for every tier above `unit`, whose tests wait on something they don't control. Vitest's 5s default is a
 * unit-test budget: a test that drives a compiler already approaches it, and coverage instrumentation roughly
 * quadruples the wall time, so the default turns green suites flaky the moment `nmr test:coverage` collects them.
 *
 * A per-project value rather than a root one, so the fast tier keeps the tight budget that makes a hung unit test
 * fail quickly. The `project` seam merges over this, so a consumer can still set their own.
 */
const TIER_TEST_TIMEOUT = 30_000;

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
  'defineRootVitestConfig requires `monorepoRoot`, an absolute path to the directory holding pnpm-workspace.yaml. Pass `import.meta.dirname` from the root config.';

/**
 * Builds the shared Vitest config for a workspace package, declaring the `unit`, `tool`, `localhost`, and `remote`
 * projects. Select them at run time with `--project`, which unions when repeated and accepts negation.
 */
export function defineVitestConfig(options: VitestConfigOptions = {}): ViteUserConfig {
  return buildConfig(options, { coverageInclude: PACKAGE_COVERAGE_INCLUDE });
}

/**
 * Builds the shared Vitest config for repo-root tests. Excludes every workspace package from all projects, and
 * reports no coverage of its own — packages cover their own sources.
 *
 * The parameter admits `undefined` in its type but is not optional, so omitting it stays a type error while
 * the guard below can still catch the JavaScript config that types never reach.
 */
export function defineRootVitestConfig(options: RootVitestConfigOptions | undefined): ViteUserConfig {
  if (options === undefined) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  // Reading through `unknown` is what keeps the check live: the declared type alone would make it statically
  // dead. A relative path would resolve against the working directory, which is the resolution this option
  // exists to replace.
  const monorepoRoot: unknown = options.monorepoRoot;

  if (typeof monorepoRoot !== 'string' || !path.isAbsolute(monorepoRoot)) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  return buildConfig(options, {
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
  options: VitestConfigOptions,
  { coverageInclude, projectExclude = [], projectRoot }: BuildOptions,
): ViteUserConfig {
  const config: ViteUserConfig = {
    test: {
      coverage: {
        enabled: false, // don't check coverage unless the `--coverage` flag is passed
        exclude: COVERAGE_EXCLUDE,
        include: coverageInclude,
        provider: 'v8',
      },
      passWithNoTests: true, // `nmr test:tool` fans out over packages holding no tool-tier tests
      projects: buildProjects(options.project, projectExclude, projectRoot),
      silent: 'passed-only', // see logs from failing tests only
      watch: false, // don't enter watch mode unless the `--watch` flag is passed
    },
  };

  return options.root ? mergeConfig(config, options.root) : config;
}

interface ProjectCategory {
  exclude: string[];
  include: string[];
  name: string;
  testTimeout?: number;
}

/** Builds one project per tier, in ladder order, each inheriting the root config. */
function buildProjects(
  overrides: ProjectConfig | undefined,
  extraExclude: string[],
  projectRoot: string | undefined,
): TestProjectInlineConfiguration[] {
  const categories: ProjectCategory[] = [
    { exclude: TIERED_PATTERNS, include: ALL_TEST_PATTERNS, name: 'unit' },
    ...TIERS.map((tier) => ({
      exclude: [],
      include: buildTierPatterns(tier),
      name: tier,
      testTimeout: TIER_TEST_TIMEOUT,
    })),
  ];

  return categories.map(({ exclude, include, name, testTimeout }) => {
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
        ...(testTimeout !== undefined && { testTimeout }),
      },
    };

    return overrides ? mergeConfig(project, { test: overrides }) : project;
  });
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
