/**
 * Readyup kit for consumers of @williamthorsen/nmr.
 *
 * Verifies that the consuming repo's nmr setup is current and correctly configured.
 * The minimum version is read from the nmr package's package.json and inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:@williamthorsen/nmr
 *
 * A check asserting the absence of something declares `quiet`: a conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

import { type CheckOutcome, defineRdyKit, pickJson } from 'readyup';
import {
  fileContains,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  isRecord,
  readFile,
  readPackageJson,
} from 'readyup/check-utils';

import { getDefaultRootScripts } from '../../src/resolve-scripts.ts';
import { findTestFiles, hasTierInfix, TIER_NAMES } from '../../src/tiers.ts';

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
          fix: 'Remove pnpm from .tool-versions — manage via packageManager field and corepack',
        },
        {
          name: '.config/nmr.config.ts uses defineConfig',
          severity: 'recommend',
          skip: () => (!fileExists('.config/nmr.config.ts') ? 'no nmr config file' : false),
          check: () => fileContains('.config/nmr.config.ts', /defineConfig/),
          fix: 'Wrap your config export with defineConfig() from @williamthorsen/nmr/config for type safety',
        },

        // `error` because falling short produces wrong results rather than a failure. Names and fixes are
        // getters because their version constants are declared below the kit.
        {
          get name() {
            return `eslint >= ${MIN_ESLINT_VERSION}`;
          },
          severity: 'error',
          skip: () => (!hasDevDependency('eslint') ? 'eslint not installed' : false),
          check: hasSupportedEslintVersion,
          get fix() {
            return `pnpm add --save-dev eslint@^${MIN_ESLINT_VERSION} — earlier releases resolve config from the working directory, so nmr's root lint and lint:check would apply the root config to every package`;
          },
        },
        {
          get name() {
            return `@williamthorsen/strict-lint >= ${MIN_STRICT_LINT_VERSION}`;
          },
          severity: 'error',
          skip: () => (!hasDevDependency('@williamthorsen/strict-lint') ? 'strict-lint not installed' : false),
          check: hasSupportedStrictLintVersion,
          get fix() {
            return `pnpm add --save-dev @williamthorsen/strict-lint@^${MIN_STRICT_LINT_VERSION} — earlier releases pin ESLint to one config and resolve ceilings from the working directory, so nmr's root lint:strict would report the wrong rules for every package`;
          },
        },

        // -- Root script cleanup -------------------------------------------------
        {
          name: 'root package.json has no nmr-provided scripts',
          severity: 'warn',
          quiet: true,
          check: noRedundantRootScripts,
          fix: 'Remove scripts from root package.json that nmr provides as built-in root scripts — invoke via nmr directly',
        },

        // -- Workspace build readiness -------------------------------------------
        {
          name: 'all workspace packages can build',
          severity: 'warn',
          check: allWorkspacePackagesCanBuild,
          fix: 'Add "build": ":" to packages that don\'t need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory',
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
          name: 'vitest.config.ts builds on @williamthorsen/nmr/vitest',
          severity: 'error',
          check: () => vitestConfigBuildsOnSharedConfig(),
          fix: "Replace vitest.config.ts with: import { defineVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineVitestConfig();",
        },
        {
          name: 'vitest.root.config.ts builds on @williamthorsen/nmr/vitest',
          severity: 'error',
          check: () => vitestRootConfigBuildsOnSharedConfig(),
          fix: "Replace vitest.root.config.ts with: import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });",
        },
        {
          name: 'every test file names its isolation tier',
          severity: 'error',
          check: () => everyTestFileNamesItsTier(),
          fix: `Rename each to <subject>[.<aspect>].<tier>.test.ts, naming one of ${TIER_NAMES.join(', ')}. Use tool for a test that reaches a program the environment supplies, which is where a retired .int. or .integration. file belongs. Only the segment before .test. selects a project, so an untiered file runs under the residual unit project and reports success`,
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
          fix: 'Delete scripts/run-workspace-script.ts — nmr replaces this custom script runner',
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
  ],
});

// region | Helpers

/** Directories whose contents are generated or vendored, and so are never the source of a finding. */
const SCAN_EXCLUDE_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);

/** Extensions a Vitest config can carry. Globbing `.ts` alone would miss a repo on any other one. */
const CONFIG_EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

const SHARED_VITEST_MODULE = '@williamthorsen/nmr/vitest';

const SHARED_PRETTIER_MODULE = '@williamthorsen/nmr/prettier';

/** Prettier config forms that hold data rather than code, so none of them can call a factory. */
const INERT_PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.{json,json5,yaml,yml,toml}'];

/** Matches a line whose only content is a re-export from an ancestor directory. */
const RE_EXPORT_LINE_PATTERN = /^export\s*(?:\{\s*default\s*}|\*)\s*from\s*['"]\.\.\/[^'"]*['"];?$/;

/** The first ESLint release that resolves config per linted file rather than from the working directory. */
const MIN_ESLINT_VERSION = '10.0.0';

/** The first strict-lint release that resolves both the ESLint config and its own ceilings per linted file. */
const MIN_STRICT_LINT_VERSION = '9.3.0';

/** Protocols that defer a dependency's version to pnpm-workspace.yaml or to a sibling package. */
const WORKSPACE_VERSION_MARKERS = ['catalog:', 'workspace:'];

/**
 * Check that every workspace package can run `nmr build` successfully.
 * A package can build if it has a "build" override in package.json or has the inputs the default
 * single-pass nmr-compile build needs: a tsconfig.json and a src/ directory.
 */
function allWorkspacePackagesCanBuild(): boolean | CheckOutcome {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) return true;

  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const failing: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = `packages/${entry.name}/package.json`;
    const content = readFile(pkgPath);
    if (!content) continue;

    const hasBuildOverride = /"build"\s*:/.test(content);
    const hasDefaultBuildInputs =
      fileExists(`packages/${entry.name}/tsconfig.json`) && existsSync(join(packagesDir, entry.name, 'src'));

    if (!hasBuildOverride && !hasDefaultBuildInputs) {
      failing.push(entry.name);
    }
  }

  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing build override or tsconfig.json + src/: ${failing.join(', ')}`,
  };
}

/** Reports every file matching the given patterns, passing when there are none. */
function checkNoMatchingFiles(patterns: string[], cwd: string): boolean | CheckOutcome {
  const found = findFiles(patterns, cwd);
  if (found.length === 0) return true;
  return { ok: false, detail: formatPaths(found) };
}

/**
 * Checks that a root Vitest config is present and built on the shared config from nmr.
 *
 * An absent file is folded in here rather than split into its own check: a repo with no root config leaves
 * packages walking up past the repo root, which is a worse failure than a wrong config, not a lesser one.
 */
function checkRootVitestConfig(baseName: string, exportName: string, cwd: string): boolean | CheckOutcome {
  const matches = findFiles([`${baseName}.${CONFIG_EXTENSIONS}`], cwd);
  if (matches.length === 0) {
    return { ok: false, detail: `${baseName}.ts is missing` };
  }

  const stale = matches.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), exportName, SHARED_VITEST_MODULE),
  );
  if (stale.length === 0) return true;
  return { ok: false, detail: `does not import ${exportName} from ${SHARED_VITEST_MODULE}: ${stale.join(', ')}` };
}

/**
 * Checks that the repo's Prettier config is built on the shared config from nmr.
 *
 * Both naming families count: Prettier reads `.prettierrc.js` and `prettier.config.js` alike, and matching
 * only the latter would report a conformant repo as stale. A config in one of the data-only forms fails
 * rather than being skipped — it cannot call a factory at all, so skipping would read as conformant when
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

  const stale = configs.filter(
    (relativePath) =>
      !importsSharedExport(readFileIn(cwd, relativePath), 'definePrettierConfig', SHARED_PRETTIER_MODULE),
  );
  if (stale.length === 0) return true;
  return {
    ok: false,
    detail: `does not import definePrettierConfig from ${SHARED_PRETTIER_MODULE}: ${stale.join(', ')}`,
  };
}

/** Names the data-only config standing in for an executable one, so the fix says what to convert. */
function describeMissingPrettierConfig(cwd: string): string {
  const inert = findFiles(INERT_PRETTIER_CONFIGS, cwd);
  if (inert.length > 0) return `holds no code to call the factory: ${inert.join(', ')}`;

  if (hasPrettierConfigKey(cwd)) {
    return 'holds no code to call the factory: the "prettier" key in package.json';
  }

  return '.prettierrc.js is missing';
}

/**
 * Reports whether `package.json` configures Prettier through its own top-level key.
 *
 * Parsed rather than pattern-matched, because `prettier` also appears as a dependency entry in every repo this check
 * runs against — `nmr fmt` requires it as a peer — and a line-anchored pattern cannot tell the two depths apart.
 */
function hasPrettierConfigKey(cwd: string): boolean {
  const manifest = readFileIn(cwd, 'package.json');
  if (manifest === undefined) return false;

  try {
    const parsed: unknown = JSON.parse(manifest);
    return isRecord(parsed) && parsed['prettier'] !== undefined;
  } catch {
    return false;
  }
}

/**
 * Checks that every test file the shared config's projects collect names one of nmr's isolation tiers.
 *
 * `unit` is the residual project and the shared config sets `passWithNoTests`, so a file whose tier segment is
 * missing or misspelt runs under `unit` and reports success: no test run distinguishes it from a conformant file.
 * A retired `.int.` or `.integration.` infix fails here too, and is reported once as the untiered file it is.
 *
 * @internal - Exported only to enable testing
 */
export function everyTestFileNamesItsTier(cwd: string = process.cwd()): boolean | CheckOutcome {
  const untiered = findTestFiles(cwd).filter((path) => !hasTierInfix(path));

  if (untiered.length === 0) return true;
  return { ok: false, detail: formatPaths(untiered) };
}

/**
 * Globs for the given patterns, pruning generated and vendored directories.
 *
 * The `exclude` callback receives a path relative to `cwd`, not a bare name, so the comparison has to be
 * against its basename: an identity check would prune only at depth 0 and miss the per-package
 * `node_modules` directories pnpm creates.
 *
 * Returns POSIX-separator paths, sorted, so check details are stable across platforms and runs.
 */
function findFiles(patterns: string[], cwd: string): string[] {
  return globSync(patterns, { cwd, exclude: (path) => SCAN_EXCLUDE_DIRS.has(basename(path)) })
    .map((path) => path.split(sep).join('/'))
    .toSorted();
}

/**
 * Renders offending paths as a work list rather than a boolean, one per line under a count.
 *
 * The indent clears readyup's three-space nesting step so a path does not read as a nested check.
 */
function formatPaths(paths: string[]): string {
  return `${paths.length} found:\n${paths.map((path) => `      ${path}`).join('\n')}`;
}

function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const picked = pickJson('../../package.json', ['version']);
  if (typeof picked['version'] !== 'string') {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return picked['version'];
}

export function hasSupportedEslintVersion(): boolean {
  return hasMinDevDependencyVersion('eslint', MIN_ESLINT_VERSION, {
    exempt: resolvesVersionViaWorkspace,
  });
}

export function hasSupportedStrictLintVersion(): boolean {
  return hasMinDevDependencyVersion('@williamthorsen/strict-lint', MIN_STRICT_LINT_VERSION, {
    exempt: resolvesVersionViaWorkspace,
  });
}

/**
 * Checks whether a config imports a named export from one of nmr's shared-config modules.
 *
 * `defineVitestConfig` does not match inside `defineRootVitestConfig`,
 * so the root-config and root-tests-config checks cannot satisfy each other.
 */
function importsSharedExport(content: string | undefined, exportName: string, moduleSpecifier: string): boolean {
  if (content === undefined) return false;
  const pattern = new RegExp(String.raw`import\s*\{[^}]*\b${exportName}\b[^}]*\}\s*from\s*['"]${moduleSpecifier}['"]`);
  return pattern.test(content);
}

/**
 * Checks whether a config's entire content is a re-export of an ancestor config.
 *
 * A file carrying any substantive statement is a real config and is left alone, as is one whose target is
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
 * Checks that no package carries a `vitest.config.*` that only re-exports an ancestor config.
 *
 * Only non-root configs qualify, identified by their path carrying a separator.
 *
 * @internal - Exported only to enable testing
 */
export function noReExportOnlyVitestConfigs(cwd: string = process.cwd()): boolean | CheckOutcome {
  const nonRootConfigs = findFiles([`**/vitest.config.${CONFIG_EXTENSIONS}`], cwd).filter((path) => path.includes('/'));
  const reExports = nonRootConfigs.filter((path) => isReExportOnly(readFileIn(cwd, path)));

  if (reExports.length === 0) return true;
  return { ok: false, detail: formatPaths(reExports) };
}

/** Check that root package.json has no scripts that duplicate nmr built-in root scripts. */
function noRedundantRootScripts(): boolean | CheckOutcome {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg['scripts'];
  if (!isRecord(scripts)) return true;

  const builtInNames = Object.keys(getDefaultRootScripts());
  const redundant = Object.keys(scripts).filter((name) => builtInNames.includes(name));

  if (redundant.length === 0) return true;
  return {
    ok: false,
    detail: `redundant: ${redundant.join(', ')}`,
  };
}

/**
 * Checks that no retired Vitest config variant survives anywhere in the repo.
 *
 * @internal - Exported only to enable testing
 */
export function noRetiredVitestConfigs(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkNoMatchingFiles(
    [`**/vitest.standalone.config.${CONFIG_EXTENSIONS}`, `**/vitest.integration.config.${CONFIG_EXTENSIONS}`],
    cwd,
  );
}

/** Checks that no workspace package.json references run-workspace-script or "pnpm run ws". */
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

/** Reads a file resolved against `cwd`, returning undefined when it cannot be read. */
function readFileIn(cwd: string, relativePath: string): string | undefined {
  try {
    return readFileSync(join(cwd, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

/** Reports whether a range defers to a workspace-level declaration instead of naming a version. */
function resolvesVersionViaWorkspace(range: string): boolean {
  return WORKSPACE_VERSION_MARKERS.some((marker) => range.startsWith(marker));
}

/** Checks that .tool-versions does not list pnpm. Pass if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}

/**
 * Checks that the root `vitest.config.*` is present and built on `defineVitestConfig`.
 *
 * This is the ancestor config every workspace package resolves by walking up from its own directory.
 *
 * @internal - Exported only to enable testing
 */
export function vitestConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkRootVitestConfig('vitest.config', 'defineVitestConfig', cwd);
}

/**
 * Checks that the root `vitest.root.config.*` is present and built on `defineRootVitestConfig`.
 *
 * nmr's root test scripts name this file by path, and a config declaring no projects makes
 * `nmr root:test:tool` exit 1.
 *
 * @internal - Exported only to enable testing
 */
export function vitestRootConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkRootVitestConfig('vitest.root.config', 'defineRootVitestConfig', cwd);
}

// endregion | Helpers
