/**
 * Readyup kit for consumers of @williamthorsen/nmr.
 *
 * Verifies that the consuming repo's nmr setup is current and correctly configured.
 * The minimum version is read from the nmr package's package.json and inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:@williamthorsen/nmr
 *
 * A check asserting the absence of something declares `quiet`: A conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { execFile } from 'node:child_process';
import { existsSync, globSync, readdirSync } from 'node:fs';
import { basename, dirname, join, posix, sep } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import { type CheckOutcome, defineRdyKit, pickJson, type SkipResult } from 'readyup';
import {
  discoverWorkspaces,
  fileContains,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  isRecord,
  listTrackedFiles,
  readFile,
  readPackageJson,
  type Workspace,
} from 'readyup/check-utils';
import { parse } from 'yaml';

import { loadRootConfig } from '../../src/config.ts';
import { getDefaultRootScripts } from '../../src/resolve-scripts.ts';
import { findMisplacedTestFiles, findTestFiles, findUntieredTestFiles, TIER_NAMES } from '../../src/tiers.ts';

export default defineRdyKit({
  checklists: [
    {
      name: 'nmr',
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: '@williamthorsen/nmr in devDependencies',
          severity: 'error',
          check: () => hasDevDependency('@williamthorsen/nmr'),
          fix: 'pnpm add --save-dev @williamthorsen/nmr',
          checks: [
            {
              get name() {
                return `@williamthorsen/nmr >= ${getMinVersion()}`;
              },
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('@williamthorsen/nmr', getMinVersion(), {
                  exempt: resolvesVersionViaWorkspace,
                }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/nmr@^${getMinVersion()}`;
              },
            },
          ],
        },
        {
          name: 'pnpm-workspace.yaml exists',
          severity: 'error',
          check: () => fileExists('pnpm-workspace.yaml'),
          fix: 'Create pnpm-workspace.yaml with workspace package globs',
        },
        {
          name: 'catalogued dependencies use catalog:',
          severity: 'warn',
          quiet: true,
          check: cataloguedDependenciesUseCatalog,
          fix: 'Replace each listed specifier with `catalog:`, so that pnpm-workspace.yaml stays the one place that declares the version. A version that must differ belongs in a named catalog under `catalogs`, referenced as `catalog:<name>`',
        },
        {
          name: 'package.json has packageManager field',
          severity: 'warn',
          check: () => hasPackageJsonField('packageManager'),
          fix: 'Add "packageManager" field to package.json (e.g., "pnpm@10.33.0")',
        },
        {
          name: '.tool-versions does not list pnpm',
          severity: 'warn',
          quiet: true,
          check: toolVersionsHasNoPnpm,
          fix: 'Remove pnpm from .tool-versions, and manage it through the packageManager field',
        },
        {
          name: 'no package.json declares a pnpm field',
          severity: 'error',
          quiet: true,
          check: () => noPnpmFieldInPackageJson(),
          fix: 'Move these settings into pnpm-workspace.yaml, quoting each version under `overrides`, or run `pnpx codemod run pnpm-v10-to-v11`. pnpm 11 does not read any key from the `pnpm` field, so an override left there pins nothing while an upgrade run with `--write` goes on rewriting it',
        },
        {
          name: 'no package.json declares a workspaces field',
          severity: 'warn',
          quiet: true,
          check: () => noWorkspacesFieldInPackageJson(),
          fix: 'Delete the `workspaces` field. pnpm reads workspace globs only from pnpm-workspace.yaml, so the field can drift from them without any error',
        },
        {
          name: '.config/nmr.config.ts uses defineConfig',
          severity: 'recommend',
          skip: () => !fileExists('.config/nmr.config.ts') && 'no nmr config file',
          check: () => fileContains('.config/nmr.config.ts', /defineConfig/),
          fix: 'Wrap the config export with defineConfig() from @williamthorsen/nmr/config for type safety',
        },

        // `error` because falling short produces wrong results rather than a failure. Names and fixes are
        // getters because their version constants are declared below the kit.
        {
          get name() {
            return `eslint >= ${MIN_ESLINT_VERSION}`;
          },
          severity: 'error',
          skip: () => !hasDevDependency('eslint') && 'eslint not installed',
          check: hasSupportedEslintVersion,
          get fix() {
            return `pnpm add --save-dev eslint@^${MIN_ESLINT_VERSION}. Earlier releases resolve config from the working directory, so nmr's root lint and lint:check would apply the root config to every package`;
          },
        },
        {
          get name() {
            return `@williamthorsen/strict-lint >= ${MIN_STRICT_LINT_VERSION}`;
          },
          severity: 'error',
          skip: () => !hasDevDependency('@williamthorsen/strict-lint') && 'strict-lint not installed',
          check: hasSupportedStrictLintVersion,
          get fix() {
            return `pnpm add --save-dev @williamthorsen/strict-lint@^${MIN_STRICT_LINT_VERSION}. Earlier releases pin ESLint to one config and resolve ceilings from the working directory, so nmr's root lint:strict would report the wrong rules for every package`;
          },
        },

        // -- Root script cleanup -------------------------------------------------
        {
          name: 'root package.json has no nmr-provided scripts',
          severity: 'warn',
          quiet: true,
          check: noRedundantRootScripts,
          fix: 'Remove scripts from root package.json that nmr provides as built-in root scripts, and invoke them through nmr directly',
        },

        // -- Git hooks -----------------------------------------------------------
        {
          name: 'no root install script runs lefthook install unguarded',
          severity: 'warn',
          quiet: true,
          check: () => noUnguardedLefthookInstall(),
          fix: "Guard each listed script as `lefthook check-install || lefthook install`, which writes hooks only when they are missing or stale. A bare `lefthook install` rewrites `.git/hooks` on every install, so when that directory is not writable, as in an agent's sandbox, `pnpm install` fails and pnpm's `verifyDepsBeforeRun` then reinstalls before every `pnpm exec`",
        },

        // -- Workspace build readiness -------------------------------------------
        {
          name: 'all workspace packages can build',
          severity: 'warn',
          check: allWorkspacePackagesCanBuild,
          fix: 'Add "build": ":" to packages that don\'t need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory',
        },

        // -- Bin targets ---------------------------------------------------------
        {
          name: 'every bin target is a committed wrapper',
          severity: 'error',
          check: () => everyBinTargetIsACommittedWrapper(),
          fix: `Point each listed entry at a committed wrapper under bin/ that loads the build output at runtime. pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, so a target that is not committed does not exist when pnpm tries to link it. pnpm never retries, which leaves the link missing for the life of the node_modules tree`,
        },
        {
          name: "every bin wrapper's build-output target is covered by files",
          severity: 'warn',
          check: () => everyBinWrapperTargetIsCoveredByFiles(),
          fix: 'Add the build output directory to `files` in each listed package. npm and pnpm publish the bin target itself whatever `files` says, so the wrapper is published pointing at build output missing from the tarball',
        },

        // -- Vitest projects -----------------------------------------------------
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

        // -- Shared Prettier config ----------------------------------------------
        {
          name: 'Prettier config builds on @williamthorsen/nmr/prettier',
          severity: 'error',
          check: () => prettierConfigBuildsOnSharedConfig(),
          fix: "Replace the Prettier config with: import { definePrettierConfig } from '@williamthorsen/nmr/prettier'; export default definePrettierConfig();",
        },

        // -- Shared upgrade policy -----------------------------------------------
        {
          name: 'taze.config.ts builds on @williamthorsen/nmr/taze',
          severity: 'warn',
          check: () => tazeConfigBuildsOnSharedConfig(),
          fix: "Replace the taze config with: import { defineConfig } from '@williamthorsen/nmr/taze'; export default defineConfig(); -- nmr's upgrade policy applies to a repo only through this file, so without it `nmr upgrade` does not report a dependency pinned to an exact version",
        },
        {
          name: 'taze config declares no option taze discards',
          severity: 'warn',
          quiet: true,
          check: () => tazeConfigAvoidsClobberedOptions(),
          fix: "Set these through the upgrade script instead, as rootScripts: { upgrade: 'nmr-report-overrides && nmr-taze --recursive --request-timeout 90000' } in .config/nmr.config.ts, keeping the rest of the default script. taze's CLI writes a default for each of them over whatever the config file declares, so taze never uses the file's value (antfu-collective/taze#317). nmr already forwards a 30-second request timeout",
        },

        // -- Audit dependency --------------------------------------------------------
        {
          name: 'v11y-check in devDependencies',
          severity: 'warn',
          check: () => hasDevDependency('v11y-check'),
          fix: 'pnpm add --save-dev v11y-check',
        },

        // -- Legacy script runner ------------------------------------------------
        {
          name: 'scripts/run-workspace-script.ts does not exist',
          severity: 'error',
          quiet: true,
          check: () => !fileExists('scripts/run-workspace-script.ts'),
          fix: 'Delete scripts/run-workspace-script.ts, because nmr replaces this custom script runner',
        },
        {
          name: 'no workspace packages reference run-workspace-script or "pnpm run ws"',
          severity: 'error',
          quiet: true,
          check: noWorkspaceRunScriptReferences,
          fix: 'Remove "ws" script entries and replace any "pnpm run ws" invocations with nmr in each packages/*/package.json',
        },
      ],
    },
    {
      name: 'self-hosted runner',
      checks: [
        {
          name: "GitHub reports the repo's runner settings",
          severity: 'recommend',
          quiet: true,
          skip: () => describeSelfHostedRunnerSkip(),
          check: () => true,
          checks: [
            {
              name: 'CI_RUNS_ON selects the self-hosted runner',
              severity: 'recommend',
              skip: () => describeRecommendationSkip(),
              check: () => recommendSelfHostedRunner(),
            },
            {
              name: 'the self-hosted runner can run CI',
              severity: 'warn',
              skip: () => describeReadinessSkip(),
              check: () => selfHostedRunnerCanRunCi(),
            },
          ],
        },
      ],
    },
  ],
});

// region | Helpers

/** Directories whose contents are generated or vendored, and so are never the source of a finding. */
const SCAN_EXCLUDE_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);

/** The directory to which a build writes its output. A `bin` target names it only when it has skipped the wrapper. */
const BUILD_OUTPUT_DIR = 'dist';

/**
 * Matches the first relative specifier named by a bin wrapper, which is the build entry that it loads at runtime.
 *
 * One pattern reaches both shapes in use: `await import('../dist/esm/cli.js')`, and
 * `new URL('../dist/esm/cli.js', import.meta.url)` whose href the wrapper then imports.
 */
const WRAPPER_TARGET_PATTERN = /['"](\.\.?\/[^'"]+)['"]/;

/** Extensions that a Vite or Vitest config can take. */
const CONFIG_EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

/** Matches a Vite config, which Vitest loads as its one config in a directory without a Vitest config. */
const VITE_CONFIG_PATTERN = `vite.config.${CONFIG_EXTENSIONS}`;

const VITEST_CONFIG_PATTERN = `vitest.config.${CONFIG_EXTENSIONS}`;

const SHARED_VITEST_MODULE = '@williamthorsen/nmr/vitest';

const SHARED_PRETTIER_MODULE = '@williamthorsen/nmr/prettier';

/** Prettier config forms that contain data rather than code, so none of them can call a factory. */
const INERT_PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.{json,json5,yaml,yml,toml}'];

const SHARED_TAZE_MODULE = '@williamthorsen/nmr/taze';

const SHARED_TESTS_MODULE = '@williamthorsen/nmr/tests';

/** taze config forms that contain data rather than code. None of them can call a factory. */
const INERT_TAZE_CONFIGS = ['.tazerc', '.tazerc.json', 'taze.config.json'];

/**
 * taze options that a config file cannot set, each paired with the pattern that finds a declaration discarded by
 * taze. Its CLI writes a default for every one of them into the options that it merges over the config file.
 *
 * `concurrency` and `requestTimeout` lose whatever the file declares, so the key alone is the finding. The other
 * three have a CLI default equal to taze's own. Only a departure from it is lost, and matching the key alone would
 * report a setting that taze receives intact.
 */
const CLOBBERED_TAZE_OPTIONS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: 'concurrency', pattern: /\bconcurrency\s*:/ },
  { key: 'githubActions', pattern: /\bgithubActions\s*:\s*(?:false|\{)/ },
  { key: 'ignoreOtherWorkspaces', pattern: /\bignoreOtherWorkspaces\s*:\s*false/ },
  { key: 'nodeVersion', pattern: /\bnodeVersion\s*:\s*false/ },
  { key: 'requestTimeout', pattern: /\brequestTimeout\s*:/ },
];

/** Matches a line whose only content is a re-export from an ancestor directory. */
const RE_EXPORT_LINE_PATTERN = /^export\s*(?:\{\s*default\s*}|\*)\s*from\s*['"]\.\.\/[^'"]*['"];?$/;

/** Root scripts that `pnpm install` runs, in the order that it runs them. */
const INSTALL_LIFECYCLE_SCRIPTS = [
  'pnpm:devPreinstall',
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
];

const LEFTHOOK_CHECK_INSTALL_PATTERN = /\blefthook\s+check-install\b/;

const LEFTHOOK_INSTALL_PATTERN = /\blefthook\s+install\b/;

/** The first ESLint release that resolves config per linted file rather than from the working directory. */
const MIN_ESLINT_VERSION = '10.0.0';

/** The first strict-lint release that resolves both the ESLint config and its own ceilings per linted file. */
const MIN_STRICT_LINT_VERSION = '9.3.0';

/** Protocols that defer a dependency's version to pnpm-workspace.yaml or to a sibling package. */
const WORKSPACE_VERSION_MARKERS = ['catalog:', 'workspace:'];

/** Manifest fields whose catalogued entries must use `catalog:`. A peer range differs from the pin by design. */
const CATALOGUE_CHECKED_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** Matches a specifier that names a protocol, such as `catalog:`, `workspace:`, `npm:`, or `git+ssh:`. */
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** A literal specifier declared for a catalogued dependency. */
interface CatalogFinding {
  manifestPath: string;
  name: string;
  specifier: string;
}

type CatalogRead = { ok: true; names: ReadonlySet<string> } | { ok: false; detail: string };

/**
 * Checks that every workspace package can run `nmr build`: Its package.json overrides "build", or it has the
 * inputs that the default nmr-compile build needs, a tsconfig.json and a src/ directory.
 */
function allWorkspacePackagesCanBuild(): boolean | CheckOutcome {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) return true;

  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const failingPackages: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = `packages/${entry.name}/package.json`;
    const content = readFile(pkgPath);
    if (!content) continue;

    const hasBuildOverride = /"build"\s*:/.test(content);
    const hasDefaultBuildInputs =
      fileExists(`packages/${entry.name}/tsconfig.json`) && existsSync(join(packagesDir, entry.name, 'src'));

    if (!hasBuildOverride && !hasDefaultBuildInputs) {
      failingPackages.push(entry.name);
    }
  }

  if (failingPackages.length === 0) return true;
  return {
    ok: false,
    detail: `missing build override or tsconfig.json + src/: ${failingPackages.join(', ')}`,
  };
}

/**
 * Checks that every manifest, the root's included, declares a dependency named by a pnpm catalog as `catalog:`
 * rather than as a literal version.
 *
 * Reads the repo's workspaces from `process.cwd()`, because readyup's discovery offers no other anchor.
 *
 * @internal - Exported only to enable testing
 */
export function cataloguedDependenciesUseCatalog(): boolean | CheckOutcome {
  const catalogRead = readCataloguedNames(process.cwd());
  if (!catalogRead.ok) return catalogRead;
  if (catalogRead.names.size === 0) return true;

  const workspaceDiscovery = discoverWorkspacesOrFailure();
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const findings = workspaceDiscovery.workspaces
    .flatMap((workspace) => findLiteralCataloguedSpecifiers(workspace, catalogRead.names))
    .toSorted((a, b) => a.manifestPath.localeCompare(b.manifestPath) || a.name.localeCompare(b.name));
  if (findings.length === 0) return true;

  const lines = findings.map(({ manifestPath, name, specifier }) => `${manifestPath}: ${name} ${specifier}`);
  return { ok: false, detail: formatPaths([...new Set(lines)]) };
}

/** Reports every file matching the given patterns, passing when there are none. */
function checkNoMatchingFiles(patterns: string[], cwd: string): boolean | CheckOutcome {
  const foundFiles = findFiles(patterns, cwd);
  if (foundFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(foundFiles) };
}

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
 * Checks that the repo's Prettier config is built on the shared config from nmr.
 *
 * Both naming families count: Prettier reads `.prettierrc.js` and `prettier.config.js` alike, and matching
 * only the latter would report a conformant repo as stale. A config in one of the data-only forms fails
 * rather than being skipped: It cannot call a factory at all, so skipping would read as conformant when
 * the repo is in fact the furthest from it.
 *
 * @internal - Exported only to enable testing
 */
export function prettierConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles(
    [`.prettierrc.${CONFIG_EXTENSIONS}`, `prettier.config.${CONFIG_EXTENSIONS}`], //
    cwd,
  );

  if (configs.length === 0) {
    return { ok: false, detail: describeMissingPrettierConfig(cwd) };
  }

  const staleConfigs = configs.filter(
    (relativePath) =>
      !importsSharedExport(readFileIn(cwd, relativePath), 'definePrettierConfig', SHARED_PRETTIER_MODULE),
  );
  if (staleConfigs.length === 0) return true;
  return {
    ok: false,
    detail: `does not import definePrettierConfig from ${SHARED_PRETTIER_MODULE}: ${staleConfigs.join(', ')}`,
  };
}

/** Names the data-only config standing in for an executable one, so that the fix says what to convert. */
function describeMissingPrettierConfig(cwd: string): string {
  const inertConfigs = findFiles(INERT_PRETTIER_CONFIGS, cwd);
  if (inertConfigs.length > 0) return `does not contain code that calls the factory: ${inertConfigs.join(', ')}`;

  if (hasPrettierConfigKey(cwd)) {
    return 'does not contain code that calls the factory: the "prettier" key in package.json';
  }

  return '.prettierrc.js is missing';
}

/**
 * Reports whether `package.json` configures Prettier through its own top-level key.
 *
 * Parsed rather than pattern-matched, because `prettier` also appears as a dependency entry in every repo against
 * which this check runs (`nmr fmt` requires it as a peer), and a line-anchored pattern cannot tell the two depths
 * apart.
 */
function hasPrettierConfigKey(cwd: string): boolean {
  const manifest = readFileIn(cwd, 'package.json');
  if (manifest === undefined) return false;

  try {
    const parsedManifest: unknown = JSON.parse(manifest);
    return isRecord(parsedManifest) && parsedManifest['prettier'] !== undefined;
  } catch {
    return false;
  }
}

/** Either the repo's workspaces or the reason discovery could not enumerate them. */
type WorkspaceDiscovery = { ok: true; workspaces: Workspace[] } | { ok: false; detail: string };

/**
 * Returns the workspaces that pass the filter, every one when it is omitted, or the reason discovery could not
 * enumerate them.
 *
 * A failure is returned rather than thrown, because readyup catches a throw at kit level and one would abort
 * the rest of the checklist; it is returned rather than swallowed, because an empty list turns every check
 * built on this one into a pass over a repo about which it verified nothing. Discovery throws when the root
 * manifest is unreadable, and when the workspace globs use a YAML or glob feature that readyup's discovery
 * does not support, a negation pattern among them.
 *
 * A check built on this reads `process.cwd()` and cannot offer a directory of its own: readyup's public entry
 * exports `discoverWorkspaces` alone, not the `discoverWorkspacesAt(dir)` form declared in its source.
 */
function discoverWorkspacesOrFailure(filter?: (workspace: Workspace) => boolean): WorkspaceDiscovery {
  try {
    return { ok: true, workspaces: discoverWorkspaces(filter === undefined ? undefined : { filter }) };
  } catch (error) {
    return { ok: false, detail: `cannot enumerate workspaces: ${describeError(error)}` };
  }
}

/**
 * Checks that every workspace `bin` entry points at a committed wrapper rather than at build output.
 *
 * pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, and
 * never retries: A target that is not committed is missing for the life of the `node_modules` tree, and deleting
 * that tree is the only repair. Private packages are in scope, because pnpm links their bins too.
 *
 * The second reason reads tracking rather than presence. A target under `dist/` is on disk in any built
 * checkout, so its absence is evidence only in a fresh clone, while git's ignorance of it holds either way.
 *
 * @internal - Exported only to enable testing
 */
export async function everyBinTargetIsACommittedWrapper(): Promise<boolean | CheckOutcome> {
  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const trackedFiles = await listTrackedFiles();
  const trackedPaths = trackedFiles === undefined ? undefined : new Set(trackedFiles);

  const offenders = workspaceDiscovery.workspaces.flatMap((workspace) =>
    readBinEntries(workspace).flatMap((entry) => {
      const defect = describeBinTargetDefect(workspace, entry, trackedPaths);
      return defect === undefined ? [] : [`${describeBinEntry(workspace, entry)} (${defect})`];
    }),
  );

  if (offenders.length === 0) return true;
  return { ok: false, detail: formatPaths(offenders) };
}

/**
 * Checks that `files` covers the build output that each bin wrapper loads at runtime.
 *
 * npm and pnpm publish every `bin` target whatever `files` says, so the wrapper is always published; `files` can
 * drop the build entry that the wrapper loads, which publishes a bin resolving to nothing. The force-include of
 * `main` covers that entry only in a package whose `main` names it.
 *
 * A package that does not declare `files` skips, as does a target under `dist/`, which is build output rather than
 * a wrapper and belongs to `everyBinTargetIsACommittedWrapper`. An unreadable file and one that does not name a
 * relative specifier skip too: The wrapper's shape is a convention rather than a contract.
 *
 * @internal - Exported only to enable testing
 */
export function everyBinWrapperTargetIsCoveredByFiles(): boolean | CheckOutcome {
  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const cwd = process.cwd();
  const offenders = workspaceDiscovery.workspaces.flatMap((workspace) => {
    const files = workspace.packageJson['files'];
    if (!Array.isArray(files)) return [];

    const publishedSegments = new Set(
      files.flatMap((entry) => (typeof entry === 'string' ? [readFirstSegment(entry)] : [])),
    );

    return readBinEntries(workspace).flatMap((entry) => {
      const target = readWrapperTarget(cwd, workspace, entry);
      if (target === undefined || publishedSegments.has(readFirstSegment(target))) return [];
      return [`${describeBinEntry(workspace, entry)} -> ${target}`];
    });
  });

  if (offenders.length === 0) return true;
  return { ok: false, detail: formatPaths(offenders) };
}

/** One `bin` entry of a workspace package, with its target normalized to a package-relative path. */
interface BinEntry {
  readonly command: string;
  readonly target: string;
}

/** Renders one entry as `{package}:{command} -> {target}`, the form in which an offender is reported. */
function describeBinEntry(workspace: Workspace, entry: BinEntry): string {
  return `${workspace.name ?? workspace.dir}:${entry.command} -> ${entry.target}`;
}

/**
 * Names what is wrong with a `bin` target, or undefined when nothing is.
 *
 * A target under `dist/` reports under that reason alone, though it is untracked as well: The two share one fix,
 * and naming the directory points at the wrapper pattern. A tree outside a git repository does not yield a
 * listing, which skips the tracking reason rather than failing it.
 */
function describeBinTargetDefect(
  workspace: Workspace,
  entry: BinEntry,
  trackedPaths: ReadonlySet<string> | undefined,
): string | undefined {
  if (readFirstSegment(entry.target) === BUILD_OUTPUT_DIR) return `names a path under ${BUILD_OUTPUT_DIR}/`;
  if (trackedPaths === undefined) return undefined;
  return trackedPaths.has(`${workspace.dir}/${entry.target}`) ? undefined : 'untracked';
}

/** Strips a leading `./` from a `bin` target, so that the comparisons in this kit do not have to allow for it. */
function normalizeBinTarget(target: string): string {
  return target.replace(/^\.\//, '');
}

/**
 * Reads a workspace's `bin` field as entries, expanding npm's string form, which names the command after the
 * package. A leading `./` is stripped, so a target compares against `files` and the tracked listing alike.
 */
function readBinEntries(workspace: Workspace): BinEntry[] {
  const bin = workspace.packageJson['bin'];

  if (typeof bin === 'string') {
    const command = workspace.name?.split('/').at(-1) ?? basename(workspace.dir);
    return [{ command, target: normalizeBinTarget(bin) }];
  }

  if (!isRecord(bin)) return [];
  return Object.entries(bin).flatMap(([command, target]) =>
    typeof target === 'string' ? [{ command, target: normalizeBinTarget(target) }] : [],
  );
}

/**
 * Reads the leading path segment of a `bin` target or a `files` entry.
 *
 * Comparing at this granularity accepts a `files` entry naming a subdirectory of the target. For example,
 * `files: ["dist/esm"]` passes a wrapper loading `../dist/cjs/cli.js`. The coarsening under-reports rather than
 * misreports.
 */
function readFirstSegment(entry: string): string {
  return normalizeBinTarget(entry).split('/', 1).at(0) ?? '';
}

/**
 * Resolves the build entry that a wrapper loads, as a package-relative path, or undefined when it does not name one.
 *
 * A target under `dist/` resolves to undefined: It is build output rather than a wrapper, and in a built
 * checkout reading it would match the compiled entry's own first relative import. A build directory under any
 * other name is still read as a wrapper, which is a limitation of identifying one by `dist/` alone.
 */
function readWrapperTarget(cwd: string, workspace: Workspace, entry: BinEntry): string | undefined {
  if (readFirstSegment(entry.target) === BUILD_OUTPUT_DIR) return undefined;

  const content = readFileIn(cwd, `${workspace.dir}/${entry.target}`);
  if (content === undefined) return undefined;

  const specifier = WRAPPER_TARGET_PATTERN.exec(content)?.[1];
  if (specifier === undefined) return undefined;

  return posix.normalize(posix.join(posix.dirname(entry.target), specifier));
}

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
 * Globs for the given patterns, pruning generated and vendored directories.
 *
 * The comparison has to be against the path's basename, because the `exclude` callback receives a path relative
 * to `cwd` rather than a bare name. An identity check would prune only at depth 0 and miss the per-package
 * `node_modules` directories created by pnpm.
 *
 * Returns POSIX-separator paths, sorted, so that check details are stable across platforms and runs.
 */
function findFiles(patterns: string[], cwd: string): string[] {
  return globSync(patterns, { cwd, exclude: (path) => SCAN_EXCLUDE_DIRS.has(basename(path)) })
    .map((path) => path.split(sep).join('/'))
    .toSorted();
}

/**
 * Returns the catalogued dependencies that a workspace's manifest declares with a specifier naming no protocol.
 *
 * A specifier that is not a string is skipped: A malformed manifest is pnpm's to report.
 */
function findLiteralCataloguedSpecifiers(workspace: Workspace, names: ReadonlySet<string>): CatalogFinding[] {
  const manifestPath = posix.join(workspace.dir, 'package.json');

  return CATALOGUE_CHECKED_FIELDS.flatMap((field) => {
    const declared = workspace.packageJson[field];
    if (!isRecord(declared)) return [];

    return Object.entries(declared).flatMap(([name, specifier]) =>
      names.has(name) && typeof specifier === 'string' && !PROTOCOL_PATTERN.test(specifier)
        ? [{ manifestPath, name, specifier }]
        : [],
    );
  });
}

/** Returns a workspace's own configs matching the pattern, as paths relative to the repo root. */
function findWorkspaceConfigs(workspace: Workspace, pattern: string): string[] {
  return findFiles([pattern], workspace.absolutePath).map((name) => `${workspace.dir}/${name}`);
}

/**
 * Renders offending paths as a work list rather than a boolean, one per line under a count.
 *
 * The indent clears readyup's three-space nesting step so that a path does not read as a nested check.
 */
function formatPaths(paths: string[]): string {
  return `${paths.length} found:\n${paths.map((path) => `      ${path}`).join('\n')}`;
}

/** Returns nmr's own version, the minimum that the kit requires of a consuming repo. */
function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so that module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const pickedFields = pickJson('../../package.json', ['version']);
  if (typeof pickedFields['version'] !== 'string') {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return pickedFields['version'];
}

/**
 * Reports whether the eslint devDependency meets `MIN_ESLINT_VERSION`, exempting a range that defers to the
 * workspace.
 */
export function hasSupportedEslintVersion(): boolean {
  return hasMinDevDependencyVersion('eslint', MIN_ESLINT_VERSION, {
    exempt: resolvesVersionViaWorkspace,
  });
}

/**
 * Reports whether the strict-lint devDependency meets `MIN_STRICT_LINT_VERSION`, exempting a range that defers to
 * the workspace.
 */
export function hasSupportedStrictLintVersion(): boolean {
  return hasMinDevDependencyVersion('@williamthorsen/strict-lint', MIN_STRICT_LINT_VERSION, {
    exempt: resolvesVersionViaWorkspace,
  });
}

/** Reports whether a Vite config is in the same directory as the given file. */
function hasViteConfigBeside(cwd: string, relativePath: string): boolean {
  return findFiles([VITE_CONFIG_PATTERN], join(cwd, dirname(relativePath))).length > 0;
}

/**
 * Checks whether a config imports a named export from one of nmr's shared-config modules.
 *
 * `defineVitestConfig` does not match inside `defineRootVitestConfig`, so the `vitest.config` and
 * `vitest.root.config` checks cannot satisfy each other.
 */
function importsSharedExport(content: string | undefined, exportName: string, moduleSpecifier: string): boolean {
  if (content === undefined) return false;
  const pattern = new RegExp(String.raw`import\s*\{[^}]*\b${exportName}\b[^}]*\}\s*from\s*['"]${moduleSpecifier}['"]`);
  return pattern.test(content);
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

/**
 * Checks that the `package.json` files in the tree do not declare a `pnpm` field.
 *
 * pnpm 11 does not read any key from that field, so every setting left in one is inert while still reading as
 * maintained. Because taze keeps its own list of dependency fields, an upgrade run with `--write` goes on
 * rewriting the versions in `pnpm.overrides`, which makes a dead block look current.
 *
 * The whole tree rather than the workspace globs: The field is dead in every manifest, whether or not pnpm
 * loads that one.
 *
 * @internal - Exported only to enable testing
 */
export function noPnpmFieldInPackageJson(cwd: string = process.cwd()): boolean | CheckOutcome {
  const declaringFiles = findFiles(['**/package.json'], cwd).flatMap((relativePath) => {
    const keys = readPnpmFieldKeys(readFileIn(cwd, relativePath));
    if (keys === undefined) return [];
    return [keys.length > 0 ? `${relativePath} (${keys.join(', ')})` : relativePath];
  });

  if (declaringFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(declaringFiles) };
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

/** Checks that root package.json does not define any scripts that duplicate nmr built-in root scripts. */
function noRedundantRootScripts(): boolean | CheckOutcome {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg['scripts'];
  if (!isRecord(scripts)) return true;

  const builtInNames = Object.keys(getDefaultRootScripts(process.cwd()));
  const redundantNames = Object.keys(scripts).filter((name) => builtInNames.includes(name));

  if (redundantNames.length === 0) return true;
  return {
    ok: false,
    detail: `redundant: ${redundantNames.join(', ')}`,
  };
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
 * Checks that the root scripts that `pnpm install` runs do not invoke `lefthook install` without
 * `lefthook check-install`.
 *
 * Any `check-install` in the script counts as the guard, so an `if !` spelling passes and an unusual spelling
 * errs toward a false negative. A script run by hand is out of scope, because forcing a reinstall is its purpose.
 *
 * @internal - Exported only to enable testing
 */
export function noUnguardedLefthookInstall(cwd: string = process.cwd()): boolean | CheckOutcome {
  const scripts = readRootScripts(cwd);
  const unguardedScripts = INSTALL_LIFECYCLE_SCRIPTS.flatMap((name) => {
    const command = scripts[name];
    if (typeof command !== 'string') return [];
    const isUnguarded = LEFTHOOK_INSTALL_PATTERN.test(command) && !LEFTHOOK_CHECK_INSTALL_PATTERN.test(command);
    return isUnguarded ? [`${name}: ${command}`] : [];
  });

  if (unguardedScripts.length === 0) return true;
  return { ok: false, detail: formatPaths(unguardedScripts) };
}

/** Checks that workspace package.json files do not reference run-workspace-script or "pnpm run ws". */
function noWorkspaceRunScriptReferences(): boolean | CheckOutcome {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) return true;

  const legacyPattern = /run-workspace-script|"pnpm\s+run\s+ws\b/;
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const content = readFile(`packages/${entry.name}/package.json`);
    if (content && legacyPattern.test(content)) {
      matches.push(entry.name);
    }
  }

  if (matches.length === 0) return true;
  return {
    ok: false,
    detail: `found in: ${matches.join(', ')}`,
  };
}

/**
 * Checks that no `package.json` in the tree declares a `workspaces` field, which pnpm ignores in favor of
 * `pnpm-workspace.yaml`.
 *
 * @internal - Exported only to enable testing
 */
export function noWorkspacesFieldInPackageJson(cwd: string = process.cwd()): boolean | CheckOutcome {
  const declaringFiles = findFiles(['**/package.json'], cwd).filter((relativePath) =>
    declaresWorkspacesField(readFileIn(cwd, relativePath)),
  );

  if (declaringFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(declaringFiles) };
}

/**
 * Reports whether a manifest declares a `workspaces` field. A manifest that does not parse reads as declaring none:
 * This check does not own the file.
 */
function declaresWorkspacesField(content: string | undefined): boolean {
  if (content === undefined) return false;

  try {
    const parsedManifest: unknown = JSON.parse(content);
    return isRecord(parsedManifest) && 'workspaces' in parsedManifest;
  } catch {
    return false;
  }
}

/**
 * Returns every package name listed by the default `catalog` or by a named catalog under `catalogs` in
 * `pnpm-workspace.yaml`, which is empty when the file is absent or declares neither.
 *
 * A file that does not parse is a failure rather than an empty set, which would pass a repo that was never checked.
 * A catalog that is not a map is skipped.
 */
function readCataloguedNames(cwd: string): CatalogRead {
  const content = readFileIn(cwd, 'pnpm-workspace.yaml');
  if (content === undefined) return { ok: true, names: new Set() };

  let workspaceManifest: unknown;
  try {
    workspaceManifest = parse(content);
  } catch (error) {
    return { ok: false, detail: `cannot parse pnpm-workspace.yaml: ${describeError(error)}` };
  }
  if (!isRecord(workspaceManifest)) return { ok: true, names: new Set() };

  const namedCatalogs = workspaceManifest['catalogs'];
  const catalogs = [workspaceManifest['catalog'], ...(isRecord(namedCatalogs) ? Object.values(namedCatalogs) : [])];

  return { ok: true, names: new Set(catalogs.filter(isRecord).flatMap((catalog) => Object.keys(catalog))) };
}

/** Reads a file resolved against `cwd`, returning undefined when it is absent. */
function readFileIn(cwd: string, relativePath: string): string | undefined {
  return readFile(join(cwd, relativePath));
}

/**
 * Returns the keys in a manifest's `pnpm` field, sorted, or undefined when it does not declare that field.
 *
 * A manifest that does not parse reads as declaring none: This check does not own the file, and throwing over it
 * would abort the rest of the checklist.
 */
function readPnpmFieldKeys(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (!isRecord(parsedManifest)) return undefined;
  const pnpm = parsedManifest['pnpm'];

  return isRecord(pnpm) ? Object.keys(pnpm).toSorted() : undefined;
}

/**
 * Returns the root manifest's `scripts`, or an empty record when the manifest is absent, does not parse, or does
 * not declare a scripts object. A malformed manifest is not this check's to report.
 */
function readRootScripts(cwd: string): Record<string, unknown> {
  const content = readFileIn(cwd, 'package.json');
  if (content === undefined) return {};

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(content);
  } catch {
    return {};
  }

  if (!isRecord(parsedManifest)) return {};
  const scripts = parsedManifest['scripts'];
  return isRecord(scripts) ? scripts : {};
}

/** Reports whether a range defers to a workspace-level declaration instead of naming a version. */
function resolvesVersionViaWorkspace(range: string): boolean {
  return WORKSPACE_VERSION_MARKERS.some((marker) => range.startsWith(marker));
}

/**
 * Checks that the repo's taze config is present and built on the shared config from nmr.
 *
 * Absence fails rather than skipping: taze does not read any config at all without one, so the repo
 * silently loses both the release-maturity soak and the pair of settings that report a dependency pinned to a bare
 * version. A config in one of the data-only forms fails the same way, being unable to call a factory.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);

  if (configs.length === 0) {
    return { ok: false, detail: describeMissingTazeConfig(cwd) };
  }

  const staleConfigs = configs.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), 'defineConfig', SHARED_TAZE_MODULE),
  );
  if (staleConfigs.length === 0) return true;
  return { ok: false, detail: `does not import defineConfig from ${SHARED_TAZE_MODULE}: ${staleConfigs.join(', ')}` };
}

/**
 * Checks that the repo's taze config does not declare an option that taze's CLI discards.
 *
 * Reports the setting rather than the file, because the fix is per option: Each one moves onto the upgrade
 * script, which passes it to taze as a flag. A repo declaring none of them is already in the passing state.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigAvoidsClobberedOptions(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);
  const findings: string[] = [];

  for (const relativePath of configs) {
    const content = readFileIn(cwd, relativePath);
    if (content === undefined) continue;

    const discardedKeys = CLOBBERED_TAZE_OPTIONS.filter(({ pattern }) => pattern.test(content)).map(({ key }) => key);
    if (discardedKeys.length > 0) findings.push(`${relativePath}: ${discardedKeys.join(', ')}`);
  }

  if (findings.length === 0) return true;
  return { ok: false, detail: formatPaths(findings) };
}

/** Names the data-only config standing in for an executable one, so that the fix says what to convert. */
function describeMissingTazeConfig(cwd: string): string {
  const inertConfigs = findFiles(INERT_TAZE_CONFIGS, cwd);
  if (inertConfigs.length > 0) return `does not contain code that calls the factory: ${inertConfigs.join(', ')}`;

  return 'taze.config.ts is missing';
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

/** Checks that .tool-versions does not list pnpm. Passes if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
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

// -- Self-hosted runner --

/** A repo's runner-related state on GitHub, as `gh` reports it. */
export interface GitHubFacts {
  nameWithOwner: string;
  isPrivate: boolean;
  onlineSelfHostedRunners: number;
  /** The raw `CI_RUNS_ON` value: the repository's own, else the organization's, else undefined. */
  ciRunsOn: string | undefined;
}

/** The outcome of one `gh` invocation. */
export type GhResult = { ok: true; stdout: string } | { ok: false; isMissing: boolean; stderr: string };

export type RunGh = (args: string[], cwd: string) => Promise<GhResult>;

export type ReadGitHubFacts = (cwd: string) => Promise<GitHubFacts | { skip: string }>;

/** How a repo's `CI_RUNS_ON` value selects a runner. */
export type RunnerSelection = 'unset' | 'self-hosted' | 'other' | 'invalid';

/** Everything that the self-hosted runner checks report on, gathered once per repo. */
export interface SelfHostedRunnerStatus {
  facts: GitHubFacts;
  selection: RunnerSelection;
  /** One line per condition that fails, empty when the repo can run its CI on the runner. */
  failures: string[];
  exempt: string | undefined;
  toolTestFiles: string[];
}

/** The command that switches a repo to the self-hosted runner. The value is JSON, so its quotes are part of it. */
const SET_CI_RUNS_ON_COMMAND = `gh variable set CI_RUNS_ON --body '"self-hosted"'`;

const CODE_QUALITY_WORKFLOW = 'williamthorsen/.github/.github/workflows/code-quality-pnpm-workflow.yaml';

/** The first major release of the code-quality workflow that reads `CI_RUNS_ON`. */
const MIN_CODE_QUALITY_MAJOR = 8;

const GH_TIMEOUT_MS = 15_000;

/**
 * Matches an invocation of a program that the runner image lacks, at the start of a command or after a shell
 * separator. `npm` and `npx` arrive with Node.js.
 */
const IMAGE_ABSENT_PROGRAM_PATTERN = /(?:^|[\s;&|(])(corepack|gh|node|npm|npx|pnpm)(?=\s|$)/gm;

/**
 * Programs that no setup step makes usable on the runner image. `gh` is absent from the image until
 * williamthorsen/hq#31 adds it, and corepack downloads a package manager that `pnpm/setup` already provides.
 */
const NEVER_INSTALLED_PROGRAMS = new Set(['corepack', 'gh']);

/** The status gathered through the real `gh`, per working directory, so that the checklist's checks share one set of calls. */
const statusByCwd = new Map<string, Promise<SelfHostedRunnerStatus | { skip: string }>>();

/**
 * Reports why the self-hosted runner checklist cannot run, or `false` when GitHub reports the repo's state.
 *
 * @internal - Exported only to enable testing
 */
export async function describeSelfHostedRunnerSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  return 'skip' in status && status.skip;
}

/**
 * Lists the conditions under which a repo's CI fails on the self-hosted runner: GitHub's settings, the code-quality
 * caller, and each job that `CI_RUNS_ON` sends to the runner.
 *
 * @internal - Exported only to enable testing
 */
export function findSelfHostedRunnerFailures(facts: GitHubFacts, cwd: string): string[] {
  const failures: string[] = [];
  if (!facts.isPrivate) {
    failures.push(
      `${facts.nameWithOwner} is public: A self-hosted runner must never run code from a fork's pull request`,
    );
  }
  if (facts.onlineSelfHostedRunners === 0) {
    failures.push(
      `${facts.nameWithOwner} does not have an online runner labelled self-hosted. When williamthorsen/hq allocates the repo ` +
        'slots in apps/runners/config/repos.yaml, the runners have not registered yet',
    );
  }

  const workflows = readWorkflows(cwd);
  failures.push(...findCodeQualityCallerDefects(workflows), ...findImageIncompatibleSteps(workflows));
  return failures;
}

/**
 * Reads the repo's runner state through `gh`, returning a skip reason when `gh` cannot report it.
 *
 * @internal - Exported only to enable testing
 */
export async function readGitHubFacts(
  cwd: string,
  runGh: RunGh = runGhCommand,
): Promise<GitHubFacts | { skip: string }> {
  const repo = await runGh(['repo', 'view', '--json', 'nameWithOwner,visibility'], cwd);
  if (!repo.ok) return { skip: describeGhFailure(repo, 'cannot resolve this repo on GitHub') };

  const repoView: unknown = parseJson(repo.stdout);
  if (!isRecord(repoView) || typeof repoView['nameWithOwner'] !== 'string') {
    return { skip: 'gh repo view returned an unexpected shape' };
  }
  const nameWithOwner = repoView['nameWithOwner'];

  const runners = await runGh(['api', `repos/${nameWithOwner}/actions/runners?per_page=100`], cwd);
  if (!runners.ok) {
    return {
      skip: describeGhFailure(runners, `cannot list the runners of ${nameWithOwner}, which needs admin access`),
    };
  }

  const repoVariable = await runGh(['api', `repos/${nameWithOwner}/actions/variables/CI_RUNS_ON`], cwd);
  if (!repoVariable.ok && !isNotFound(repoVariable)) {
    return { skip: describeGhFailure(repoVariable, `cannot read the CI_RUNS_ON variable of ${nameWithOwner}`) };
  }
  const repoValue = repoVariable.ok ? readVariableValue(parseJson(repoVariable.stdout)) : undefined;

  return {
    nameWithOwner,
    isPrivate: repoView['visibility'] !== 'PUBLIC',
    onlineSelfHostedRunners: countOnlineSelfHostedRunners(parseJson(runners.stdout)),
    ciRunsOn: repoValue ?? (await readOrganizationValue(nameWithOwner, cwd, runGh)),
  };
}

/**
 * Classifies a `CI_RUNS_ON` value by the runner that it selects. The shared workflows read it with `fromJSON`, so
 * a value that is not JSON fails them.
 *
 * @internal - Exported only to enable testing
 */
export function readRunnerSelection(value: string | undefined): RunnerSelection {
  if (value === undefined || value.trim() === '') return 'unset';

  const parsed = parseJson(value);
  if (parsed === undefined) return 'invalid';
  const labels = Array.isArray(parsed) ? parsed : [parsed];
  return labels.includes('self-hosted') ? 'self-hosted' : 'other';
}

/**
 * Recommends switching a repo whose CI can run on the self-hosted runner and that has not switched.
 *
 * @internal - Exported only to enable testing
 */
export async function recommendSelfHostedRunner(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<boolean | CheckOutcome> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return true;

  const toolTests =
    status.toolTestFiles.length === 0
      ? 'The repo does not have any tool-tier tests.'
      : `Before switching, confirm that the image provides every program that these tool-tier tests spawn: ${formatPaths(status.toolTestFiles)}`;
  return {
    ok: false,
    detail: `${status.facts.nameWithOwner} can run its CI on the self-hosted runner. ${toolTests}`,
    fix: `${SET_CI_RUNS_ON_COMMAND} --repo ${status.facts.nameWithOwner}`,
  };
}

/**
 * Reports why the switch to the self-hosted runner is not recommended, or `false` when it is.
 *
 * @internal - Exported only to enable testing
 */
export async function describeRecommendationSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return status.skip;
  if (status.selection !== 'unset') return `CI_RUNS_ON is already set to ${status.facts.ciRunsOn ?? ''}`;
  if (status.exempt !== undefined) return `the repo is exempt: ${status.exempt}`;
  if (status.failures.length > 0) return `not ready: ${status.failures.join('; ')}`;
  return false;
}

/**
 * Reports why a set `CI_RUNS_ON` cannot break the repo's CI, or `false` when it can.
 *
 * @internal - Exported only to enable testing
 */
export async function describeReadinessSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return status.skip;
  if (status.selection === 'unset') return 'CI_RUNS_ON is unset';
  if (status.selection === 'other') return `CI_RUNS_ON selects ${status.facts.ciRunsOn ?? ''}`;
  return false;
}

/**
 * Checks that a repo whose `CI_RUNS_ON` selects the self-hosted runner can run its CI there.
 *
 * @internal - Exported only to enable testing
 */
export async function selfHostedRunnerCanRunCi(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<boolean | CheckOutcome> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return true;

  const { facts } = status;
  const conditions =
    status.exempt === undefined ? status.failures : [`the repo is exempt: ${status.exempt}`, ...status.failures];
  if (status.selection !== 'invalid' && conditions.length === 0) return true;

  const invalidValue = `CI_RUNS_ON is ${facts.ciRunsOn ?? ''}, which is not JSON, so every workflow that reads it with fromJSON fails`;
  // Offer the corrected value only to a repo that can run on the runner; any other repo returns to ubuntu-latest.
  if (conditions.length === 0) {
    return { ok: false, detail: invalidValue, fix: `${SET_CI_RUNS_ON_COMMAND} --repo ${facts.nameWithOwner}` };
  }

  const problems = status.selection === 'invalid' ? [invalidValue, ...conditions] : conditions;
  return {
    ok: false,
    detail: problems.map((problem) => `      ${problem}`).join('\n'),
    fix: `Fix each condition, or return the repo's CI to ubuntu-latest: gh variable delete CI_RUNS_ON --repo ${facts.nameWithOwner}`,
  };
}

/** Counts the runners that are online and labelled `self-hosted` in an `actions/runners` response. */
function countOnlineSelfHostedRunners(response: unknown): number {
  if (!isRecord(response) || !Array.isArray(response['runners'])) return 0;
  return response['runners'].filter(
    (runner: unknown) =>
      isRecord(runner) &&
      runner['status'] === 'online' &&
      Array.isArray(runner['labels']) &&
      runner['labels'].some((label: unknown) => isRecord(label) && label['name'] === 'self-hosted'),
  ).length;
}

/** Composes a skip reason from a failed `gh` invocation. */
function describeGhFailure(result: Extract<GhResult, { ok: false }>, context: string): string {
  if (result.isMissing) return 'gh is not installed';
  if (/gh auth login|not logged in/i.test(result.stderr)) return 'gh is not authenticated';
  const firstLine = result.stderr.trim().split('\n', 1)[0] ?? '';
  return firstLine === '' ? `gh ${context}` : `gh ${context}: ${firstLine}`;
}

/** Lists the code-quality callers that do not let `CI_RUNS_ON` choose their runner. */
function findCodeQualityCallerDefects(workflows: Workflow[]): string[] {
  const defects: string[] = [];
  for (const { file, jobs } of workflows) {
    for (const [jobName, job] of jobs) {
      const uses = job['uses'];
      if (typeof uses !== 'string' || !uses.startsWith(`${CODE_QUALITY_WORKFLOW}@`)) continue;

      const ref = uses.slice(CODE_QUALITY_WORKFLOW.length + 1);
      const major = /^v(\d+)(?:\.\d+){0,2}$/.exec(ref)?.[1];
      if (major === undefined) {
        defects.push(
          `${file} job ${jobName} pins the code-quality workflow at ${ref}, whose release cannot be determined`,
        );
      } else if (Number(major) < MIN_CODE_QUALITY_MAJOR) {
        defects.push(
          `${file} job ${jobName} pins the code-quality workflow at ${ref}, which predates CI_RUNS_ON; pin v${MIN_CODE_QUALITY_MAJOR} or later`,
        );
      }
      const inputs = job['with'];
      if (isRecord(inputs) && inputs['runs-on'] !== undefined) {
        defects.push(`${file} job ${jobName} passes runs-on, which overrides CI_RUNS_ON`);
      }
    }
  }
  return defects;
}

/**
 * Lists the steps that invoke a program before a step installs it, in each job whose runner `CI_RUNS_ON` selects.
 * The runner image provides git and jq, but not Node.js, pnpm, corepack, or gh.
 */
function findImageIncompatibleSteps(workflows: Workflow[]): string[] {
  const defects: string[] = [];
  for (const { file, jobs } of workflows) {
    for (const [jobName, job] of jobs) {
      if (!/\bvars\.CI_RUNS_ON\b/.test(JSON.stringify(job['runs-on'] ?? ''))) continue;
      const steps = job['steps'];
      if (!Array.isArray(steps)) continue;

      const installed = new Set<string>();
      for (const [index, step] of steps.entries()) {
        if (!isRecord(step)) continue;
        const stepLabel = typeof step['name'] === 'string' ? step['name'] : `step ${index + 1}`;
        const run = step['run'];
        if (typeof run === 'string') {
          const missing = findUninstalledPrograms(run, installed);
          if (missing.length > 0) {
            defects.push(
              `${file} job ${jobName}, ${stepLabel}: runs ${missing.join(', ')}, which the runner image lacks at that step`,
            );
          }
        }
        for (const program of readInstalledPrograms(step)) installed.add(program);
      }
    }
  }
  return defects;
}

/** Returns the programs that a `run` script invokes and that are not installed yet, sorted and without repeats. */
function findUninstalledPrograms(run: string, installed: ReadonlySet<string>): string[] {
  const programs = new Set<string>();
  for (const match of run.matchAll(IMAGE_ABSENT_PROGRAM_PATTERN)) {
    const program = match[1];
    if (program === undefined) continue;
    const provider = program === 'npm' || program === 'npx' ? 'node' : program;
    if (NEVER_INSTALLED_PROGRAMS.has(program) || !installed.has(provider)) programs.add(program);
  }
  return [...programs].toSorted();
}

/** Gathers the repo's runner status once per working directory, or for each call when `readFacts` is supplied. */
function getSelfHostedRunnerStatus(
  cwd: string,
  readFacts: ReadGitHubFacts | undefined,
): Promise<SelfHostedRunnerStatus | { skip: string }> {
  if (readFacts !== undefined) return gatherSelfHostedRunnerStatus(cwd, readFacts);

  let status = statusByCwd.get(cwd);
  if (status === undefined) {
    status = gatherSelfHostedRunnerStatus(cwd, (dir) => readGitHubFacts(dir));
    statusByCwd.set(cwd, status);
  }
  return status;
}

/** Gathers the facts, the failing conditions, the exemption, and the tool-tier tests. */
async function gatherSelfHostedRunnerStatus(
  cwd: string,
  readFacts: ReadGitHubFacts,
): Promise<SelfHostedRunnerStatus | { skip: string }> {
  const facts = await readFacts(cwd);
  if ('skip' in facts) return facts;

  const failures = findSelfHostedRunnerFailures(facts, cwd);
  let exempt: string | undefined;
  try {
    exempt = (await loadRootConfig(cwd)).selfHostedRunner?.exempt;
  } catch (error) {
    failures.push(`the nmr config cannot be loaded: ${describeError(error)}`);
  }

  return {
    facts,
    selection: readRunnerSelection(facts.ciRunsOn),
    failures,
    exempt,
    toolTestFiles: findTestFiles(cwd).filter(
      (file) => file.endsWith('.tool.test.ts') || file.endsWith('.tool.test.tsx'),
    ),
  };
}

/** Reports whether a failed `gh api` call received a 404. */
function isNotFound(result: Extract<GhResult, { ok: false }>): boolean {
  return /HTTP 404/.test(result.stderr);
}

/** Parses JSON, returning undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Returns the programs that a step installs on the runner image. */
function readInstalledPrograms(step: Record<string, unknown>): string[] {
  const uses = step['uses'];
  if (typeof uses !== 'string') return [];

  const action = uses.split('@', 1)[0];
  if (action === 'actions/setup-node') return ['node'];
  if (action === 'pnpm/action-setup') return ['pnpm'];
  if (action !== 'pnpm/setup') return [];

  // `pnpm/setup` installs Node.js unless `runtime` names another runtime or version-file detection is turned off.
  const inputs = isRecord(step['with']) ? step['with'] : {};
  const runtime = inputs['runtime'];
  const installsNode =
    typeof runtime === 'string' ? /^node\b/.test(runtime) : String(inputs['node-version-file']) !== 'false';
  return installsNode ? ['pnpm', 'node'] : ['pnpm'];
}

/** Returns the organization's `CI_RUNS_ON` value visible to the repo, or undefined when it has none. */
async function readOrganizationValue(nameWithOwner: string, cwd: string, runGh: RunGh): Promise<string | undefined> {
  const result = await runGh(['api', `repos/${nameWithOwner}/actions/organization-variables`], cwd);
  if (!result.ok) return undefined;

  const response = parseJson(result.stdout);
  if (!isRecord(response) || !Array.isArray(response['variables'])) return undefined;
  const variable: unknown = response['variables'].find(
    (entry: unknown) => isRecord(entry) && entry['name'] === 'CI_RUNS_ON',
  );
  return readVariableValue(variable);
}

/** Returns the `value` of a variable from the GitHub API. */
function readVariableValue(variable: unknown): string | undefined {
  return isRecord(variable) && typeof variable['value'] === 'string' ? variable['value'] : undefined;
}

/** A workflow file's name and its jobs. */
interface Workflow {
  file: string;
  jobs: Array<[string, Record<string, unknown>]>;
}

/** Reads every workflow under `.github/workflows`, skipping a file that does not parse. */
function readWorkflows(cwd: string): Workflow[] {
  const dir = join(cwd, '.github', 'workflows');
  if (!existsSync(dir)) return [];

  const workflows: Workflow[] = [];
  const files = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted();
  for (const file of files) {
    let document: unknown;
    try {
      document = parse(readFile(join(dir, file)) ?? '');
    } catch {
      continue;
    }
    if (!isRecord(document) || !isRecord(document['jobs'])) continue;
    const jobs = Object.entries(document['jobs']).filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    );
    workflows.push({ file: posix.join('.github/workflows', file), jobs });
  }
  return workflows;
}

/** Runs `gh` without a shell, capturing its output. */
function runGhCommand(args: string[], cwd: string): Promise<GhResult> {
  return new Promise((resolve) => {
    void execFile('gh', args, { cwd, timeout: GH_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout });
        return;
      }
      resolve({ ok: false, isMissing: 'code' in error && error.code === 'ENOENT', stderr: stderr || error.message });
    });
  });
}

// endregion | Helpers
