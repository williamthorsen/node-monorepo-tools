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
   * The monorepo root, which must hold `pnpm-workspace.yaml`. A root config sits at that directory by
   * construction, so this is `import.meta.dirname`. Stated rather than searched for: resolving it from the
   * working directory would make the config describe whichever monorepo the run happened to start in.
   */
  monorepoRoot: string;
}

const APP_PATTERNS = ['**/__tests__/**/*.app.test.{ts,tsx}'];
const INTEGRATION_PATTERNS = ['**/__tests__/**/*.int.test.{ts,tsx}'];

// `unit` includes every test file and subtracts the categorised ones, so a file whose suffix matches no category still
// runs rather than being dropped by an allow-list.
const ALL_TEST_PATTERNS = ['**/__tests__/**/*.test.{ts,tsx}'];

const COVERAGE_EXCLUDE = [
  '**/__{mocks,tests}__/*', //
  '**/index.ts',
  '**/mock*.{ts,tsx}',
  '**/*.d.ts',
  '**/*.types.ts',
];

const PACKAGE_COVERAGE_INCLUDE = ['**/src/**/*.{ts,tsx}'];

const MISSING_MONOREPO_ROOT =
  'defineRootVitestConfig requires `monorepoRoot`, the directory holding pnpm-workspace.yaml. Pass `import.meta.dirname` from the root config.';

/**
 * Builds the shared Vitest config for a workspace package, declaring the `unit`, `integration`, and `app` projects.
 * Select them at run time with `--project`, which accepts negation.
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
  // A JavaScript config can omit the options object entirely — typically by copying the argument-less form
  // this option replaced — or pass one without the root. Name the fix in both cases, rather than letting the
  // omission surface as a `path.join` TypeError. Reading through `unknown` is what keeps the check live: the
  // declared type alone would make it statically dead.
  if (options === undefined) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  const monorepoRoot: unknown = options.monorepoRoot;

  if (typeof monorepoRoot !== 'string' || monorepoRoot === '') {
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
      passWithNoTests: true, // `nmr test:integration` fans out over packages with no integration tests
      projects: buildProjects(options.project, projectExclude, projectRoot),
      silent: 'passed-only', // see logs from failing tests only
      watch: false, // don't enter watch mode unless the `--watch` flag is passed
    },
  };

  return options.root ? mergeConfig(config, options.root) : config;
}

/** Builds one project per test category, each inheriting the root config. */
function buildProjects(
  overrides: ProjectConfig | undefined,
  extraExclude: string[],
  projectRoot: string | undefined,
): TestProjectInlineConfiguration[] {
  const categories = [
    { exclude: [], include: APP_PATTERNS, name: 'app' },
    { exclude: [], include: INTEGRATION_PATTERNS, name: 'integration' },
    { exclude: [...APP_PATTERNS, ...INTEGRATION_PATTERNS], include: ALL_TEST_PATTERNS, name: 'unit' },
  ];

  return categories.map(({ exclude, include, name }) => {
    const project: TestProjectInlineConfiguration = {
      // Without this, Vitest gives the project no Vite config file at all, so root-level options such as
      // `resolve.conditions` never reach it.
      extends: true,
      // Patterns resolve against the project root, which otherwise defaults to the working directory.
      ...(projectRoot !== undefined && { root: projectRoot }),
      test: { exclude: [...defaultExclude, ...exclude, ...extraExclude], include, name },
    };

    return overrides ? mergeConfig(project, { test: overrides }) : project;
  });
}

/** Resolves each workspace package directory to a glob relative to the monorepo root. */
function getWorkspaceExcludePatterns(monorepoRoot: string): string[] {
  return getWorkspacePackageDirs(monorepoRoot)
    .map((dir) => `${path.relative(monorepoRoot, dir).split(path.sep).join('/')}/**`)
    .toSorted();
}
