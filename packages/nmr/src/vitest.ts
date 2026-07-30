import path from 'node:path';

import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';
import { defaultExclude, mergeConfig } from 'vitest/config';
import type { InlineConfig, ProjectConfig } from 'vitest/node';

import { findMonorepoRoot, getWorkspacePackageDirs } from './workspace.ts';

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
  /** Directory the monorepo root is located from, defaulting to the process working directory. */
  startDir?: string;
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
 */
export function defineRootVitestConfig(options: RootVitestConfigOptions = {}): ViteUserConfig {
  const monorepoRoot = findMonorepoRoot(options.startDir);

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
      // Vitest counts the run's total collected files, not each project's, so an empty project never fails a run
      // that collected files elsewhere. What this covers is the run collecting nothing at all, which is the normal
      // case for `nmr test:integration` under the recursive fan-out: most packages have no integration tests.
      passWithNoTests: true,
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
      // Without this, Vitest gives the project no Vite config file at all, so root-level options
      // such as `resolve.conditions` never reach it.
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
