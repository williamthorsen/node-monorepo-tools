import { dirname, join } from 'node:path';

import type { CheckOutcome, RdyCheck, SkipResult } from 'readyup';
import type { Workspace } from 'readyup/check-utils';

import { findMisplacedTestFiles, findTestFiles, findUntieredTestFiles, TIER_NAMES } from '../../src/tiers.ts';
import {
  checkNoMatchingFiles,
  CONFIG_EXTENSIONS,
  discoverWorkspacesOrFailure,
  findFiles,
  formatPaths,
  importsSharedExport,
  readFileIn,
} from './repo-files.ts';

/** Matches a Vite config, which Vitest loads as its one config in a directory without a Vitest config. */
const VITE_CONFIG_PATTERN = `vite.config.${CONFIG_EXTENSIONS}`;

const VITEST_CONFIG_PATTERN = `vitest.config.${CONFIG_EXTENSIONS}`;

const SHARED_VITEST_MODULE = '@williamthorsen/nmr/vitest';

const SHARED_TESTS_MODULE = '@williamthorsen/nmr/tests';

/** Matches a line whose only content is a re-export from an ancestor directory. */
const RE_EXPORT_LINE_PATTERN = /^export\s*(?:\{\s*default\s*}|\*)\s*from\s*['"]\.\.\/[^'"]*['"];?$/;

export const vitestChecks: RdyCheck[] = [
  {
    name: 'no retired Vitest config variants',
    severity: 'error',
    quiet: true,
    check: () => noRetiredVitestConfigs(),
    fix: "Delete every vitest.standalone.config.* and vitest.integration.config.*. nmr's test scripts select Vitest projects instead of naming config files",
  },
  {
    name: 'every vitest.config builds on @williamthorsen/nmr/vitest',
    severity: 'error',
    check: () => vitestConfigBuildsOnSharedConfig(),
    fix: "Replace each listed config with: import { defineVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineVitestConfig(); -- a config that does not call the factory does not declare any projects, so every tier-selecting test command fails against it. Pass the repo's own settings to the factory as layers to keep them",
  },
  {
    name: 'vitest.root.config.ts builds on @williamthorsen/nmr/vitest',
    severity: 'error',
    check: () => vitestRootConfigBuildsOnSharedConfig(),
    fix: "Replace vitest.root.config.ts with: import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });",
  },
  {
    name: 'every workspace with a Vite config has a Vitest config',
    severity: 'error',
    check: () => everyViteConfigHasVitestConfig(),
    fix: 'Add a vitest.config.ts calling defineVitestConfig() from @williamthorsen/nmr/vitest beside each listed vite.config -- Vitest stops its config search at the first directory containing either name, so the Vite config otherwise wins and the projects model is never reached',
  },
  {
    name: 'the test suite gates the test-file conventions',
    severity: 'warn',
    check: () => testSuiteGatesTestFileConventions(),
    fix: "Add a test of the repo's own under a __tests__ directory that declares the check: import { checkTestFileConventions } from '@williamthorsen/nmr/tests'; checkTestFileConventions(); -- passing `excludedBasenames` the directory names that the repo passes to `testCollectionExclude`. Without it, the repo's test run does not report an untiered or misplaced test file, and this kit reports them in its place against only nmr's built-in exclusions and the paths that git ignores",
  },
  {
    name: 'every test file names its isolation tier',
    severity: 'error',
    skip: () => describeConventionsGuardSkip(),
    check: () => everyTestFileNamesItsTier(),
    fix: `Rename each to <subject>[.<aspect>].<tier>.test.ts, naming one of ${TIER_NAMES.join(', ')}. Use tool for a test that reaches a program supplied by the environment, which is the tier for a retired .int. or .integration. file. Only the segment before .test. selects a project, so an untiered file runs under the residual unit project and reports success`,
  },
  {
    name: 'every test file is under a __tests__ directory',
    severity: 'error',
    skip: () => describeConventionsGuardSkip(),
    check: () => everyTestFileSitsUnderTestsDir(),
    fix: 'Move each into a __tests__ directory, the only place from which the shared Vitest config collects. Vitest does not collect a file outside one, so it runs nowhere and reports nothing. For a file that is not a test, declare checkTestFileConventions with its directory in `excludedBasenames` instead, which this check then defers to',
  },
  {
    name: 'no package re-exports the ancestor Vitest config',
    severity: 'recommend',
    quiet: true,
    check: () => noReExportOnlyVitestConfigs(),
    fix: 'Delete these files. Vitest resolves config by walking up from the run root, so a per-package re-export is redundant',
  },
];

/**
 * Checks that every test file collected by the shared config's projects names one of nmr's isolation tiers.
 *
 * `unit` is the residual project and the shared config sets `passWithNoTests`, so a file whose tier segment is
 * missing or misspelt runs under `unit` and reports success: The test run does not distinguish it from a conformant
 * file. A retired `.int.` or `.integration.` infix fails here too, and is reported once as the untiered file that it
 * is.
 *
 * @internal - Exported only to enable testing
 */
export function everyTestFileNamesItsTier(cwd: string = process.cwd()): boolean | CheckOutcome {
  const untieredFiles = findUntieredTestFiles(cwd);

  if (untieredFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(untieredFiles) };
}

/**
 * Checks that every test file is under a `__tests__` directory.
 *
 * The shared config's projects collect only from `__tests__`, so a file outside one runs nowhere and reports nothing.
 * Such a file is reported here whether or not it names a tier, and never by `everyTestFileNamesItsTier`.
 *
 * @internal - Exported only to enable testing
 */
export function everyTestFileSitsUnderTestsDir(cwd: string = process.cwd()): boolean | CheckOutcome {
  const misplacedFiles = findMisplacedTestFiles(cwd);

  if (misplacedFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(misplacedFiles) };
}

/**
 * Checks that every workspace containing a Vite config also contains a Vitest config beside it.
 *
 * Vitest resolves one config per run by ascending from the run root and stopping at the first directory
 * containing any of its candidate filenames, `vite.config.*` among them. A workspace containing only a Vite
 * config ends that search on a config that does not declare any projects, and every tier-selecting test command
 * then fails with `No projects matched the filter`. Within one directory `vitest.config.*` is tried first, which
 * is why a Vitest config beside the Vite config restores the projects model.
 *
 * Declared workspaces rather than a tree-wide glob: The search only ascends, so a Vite config nested below
 * a workspace root is never reached and reporting it would be a false positive.
 *
 * @internal - Exported only to enable testing
 */
export function everyViteConfigHasVitestConfig(): boolean | CheckOutcome {
  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const unpairedConfigs = workspaceDiscovery.workspaces.flatMap((workspace) => {
    const viteConfigs = findWorkspaceConfigs(workspace, VITE_CONFIG_PATTERN);
    if (viteConfigs.length === 0) return [];
    return findWorkspaceConfigs(workspace, VITEST_CONFIG_PATTERN).length > 0 ? [] : viteConfigs;
  });

  if (unpairedConfigs.length === 0) return true;
  return { ok: false, detail: formatPaths(unpairedConfigs) };
}

/**
 * Checks that packages do not have a `vitest.config.*` that only re-exports an ancestor config.
 *
 * Only non-root configs qualify, identified by their path containing a separator. One beside a Vite config is
 * needed rather than redundant, so it is left to `vitestConfigBuildsOnSharedConfig`: Deleting it would hand
 * resolution to the Vite config, producing the failure which that check exists to prevent.
 *
 * @internal - Exported only to enable testing
 */
export function noReExportOnlyVitestConfigs(cwd: string = process.cwd()): boolean | CheckOutcome {
  const nonRootConfigs = findFiles([`**/${VITEST_CONFIG_PATTERN}`], cwd).filter((path) => path.includes('/'));
  const reExports = nonRootConfigs.filter((path) => isOwnedByReExportCheck(cwd, path));

  if (reExports.length === 0) return true;
  return { ok: false, detail: formatPaths(reExports) };
}

/**
 * Checks that the repo does not contain any retired Vitest config variant.
 *
 * @internal - Exported only to enable testing
 */
export function noRetiredVitestConfigs(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkNoMatchingFiles(
    [`**/vitest.standalone.config.${CONFIG_EXTENSIONS}`, `**/vitest.integration.config.${CONFIG_EXTENSIONS}`],
    cwd,
  );
}

/**
 * Checks that a test file under `__tests__` declares `checkTestFileConventions`, which gates both halves of the
 * test-file convention in the repo's own test run.
 *
 * Without it, an untiered file runs under `unit` and a misplaced one runs nowhere, and the test run does not report
 * either. Only the import is matched; an import that nothing calls is lint's to report.
 *
 * @internal - Exported only to enable testing
 */
export function testSuiteGatesTestFileConventions(cwd: string = process.cwd()): boolean | CheckOutcome {
  if (findConventionsGuard(cwd) !== undefined) return true;
  return {
    ok: false,
    detail: `the test files under __tests__ do not import checkTestFileConventions from ${SHARED_TESTS_MODULE}`,
  };
}

/**
 * Checks that the root `vitest.config.*` is present, and that it and every workspace's own build on
 * `defineVitestConfig`.
 *
 * The root config is the ancestor that a workspace resolves by walking up from its own directory, and a repo
 * without it leaves packages walking up past the repo root.
 *
 * A workspace config that does not call the factory does not declare any projects, so it fails a tier-selecting
 * run exactly as a missing root config does; presence alone does not show that the projects model is reached.
 *
 * A re-export-only config without a Vite config beside it is left to `noReExportOnlyVitestConfigs`, whose fix
 * deletes it rather than rewriting it.
 *
 * @internal - Exported only to enable testing
 */
export function vitestConfigBuildsOnSharedConfig(): boolean | CheckOutcome {
  const cwd = process.cwd();
  const rootConfigs = findFiles([VITEST_CONFIG_PATTERN], cwd);
  if (rootConfigs.length === 0) return { ok: false, detail: 'vitest.config.ts is missing' };

  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const workspaceConfigs = workspaceDiscovery.workspaces
    .flatMap((workspace) => findWorkspaceConfigs(workspace, VITEST_CONFIG_PATTERN))
    .filter((relativePath) => !isOwnedByReExportCheck(cwd, relativePath));

  const stale = [...rootConfigs, ...workspaceConfigs].filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), 'defineVitestConfig', SHARED_VITEST_MODULE),
  );
  if (stale.length === 0) return true;
  return { ok: false, detail: formatPaths(stale) };
}

/**
 * Checks that the root `vitest.root.config.*` is present and built on `defineRootVitestConfig`.
 *
 * nmr's root test scripts name this file by path, and a config that does not declare any projects makes
 * `nmr root:test:tool` exit 1.
 *
 * @internal - Exported only to enable testing
 */
export function vitestRootConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkRootVitestConfig('vitest.root.config', 'defineRootVitestConfig', cwd);
}

// region | Helpers

/** Checks that a root-level Vitest config is present and built on the shared config from nmr. */
function checkRootVitestConfig(baseName: string, exportName: string, cwd: string): boolean | CheckOutcome {
  const matches = findFiles([`${baseName}.${CONFIG_EXTENSIONS}`], cwd);
  if (matches.length === 0) {
    return { ok: false, detail: `${baseName}.ts is missing` };
  }

  const staleConfigs = matches.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), exportName, SHARED_VITEST_MODULE),
  );
  if (staleConfigs.length === 0) return true;
  return {
    ok: false,
    detail: `does not import ${exportName} from ${SHARED_VITEST_MODULE}: ${staleConfigs.join(', ')}`,
  };
}

/**
 * Returns the reason the test-file sweeps skip when the repo's suite declares `checkTestFileConventions`, or `false`
 * when it does not.
 *
 * The guard reports the same files under the repo's own `excludedBasenames`, which a kit check cannot read, so a
 * sweep beside it can only repeat its findings or report a directory that the repo has excluded.
 */
function describeConventionsGuardSkip(): SkipResult {
  const guard = findConventionsGuard(process.cwd());
  return guard !== undefined && `reported by checkTestFileConventions in ${guard}`;
}

/**
 * Returns the first test file under `__tests__` that imports `checkTestFileConventions`, or undefined when none does.
 *
 * A guard outside `__tests__` does not count, because the shared config's projects do not collect it.
 */
function findConventionsGuard(cwd: string): string | undefined {
  return findTestFiles(cwd).find((relativePath) =>
    importsSharedExport(readFileIn(cwd, relativePath), 'checkTestFileConventions', SHARED_TESTS_MODULE),
  );
}

/** Returns a workspace's own configs matching the pattern, as paths relative to the repo root. */
function findWorkspaceConfigs(workspace: Workspace, pattern: string): string[] {
  return findFiles([pattern], workspace.absolutePath).map((name) => `${workspace.dir}/${name}`);
}

/** Reports whether a Vite config is in the same directory as the given file. */
function hasViteConfigBeside(cwd: string, relativePath: string): boolean {
  return findFiles([VITE_CONFIG_PATTERN], join(cwd, dirname(relativePath))).length > 0;
}

/**
 * Reports whether `noReExportOnlyVitestConfigs` owns a config, which is the case when deleting it is the right fix.
 *
 * Deleting is right only when nothing else in the directory would take over resolution. A config beside a
 * Vite config belongs to `vitestConfigBuildsOnSharedConfig` instead, which tells it to call the factory.
 * Both checks read ownership from here, so within a member workspace exactly one of them reports a config.
 * Outside one, only the re-export check looks, and a config beside a Vite config falls to neither.
 */
function isOwnedByReExportCheck(cwd: string, relativePath: string): boolean {
  return isReExportOnly(readFileIn(cwd, relativePath)) && !hasViteConfigBeside(cwd, relativePath);
}

/**
 * Checks whether a config's entire content is a re-export of an ancestor config.
 *
 * A file containing any substantive statement is a real config and is left alone, as is one whose target is
 * package-local, which the check's delete fix would break. Missing an exotic re-export spelling is a
 * recommend-severity false negative, which is the cheap direction to err.
 */
function isReExportOnly(content: string | undefined): boolean {
  if (content === undefined) return false;
  const statements = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return statements.length > 0 && statements.every((line) => RE_EXPORT_LINE_PATTERN.test(line));
}

// endregion | Helpers
