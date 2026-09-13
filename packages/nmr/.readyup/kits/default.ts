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
import { existsSync, globSync, readdirSync } from 'node:fs';
import { basename, dirname, join, posix, sep } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import { type CheckOutcome, defineRdyKit, pickJson } from 'readyup';
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
          name: 'no package.json declares a pnpm field',
          severity: 'error',
          quiet: true,
          check: () => noPnpmFieldInPackageJson(),
          fix: 'Move these settings into pnpm-workspace.yaml, quoting each version under `overrides`, or run `pnpx codemod run pnpm-v10-to-v11`. pnpm 11 reads no key from the `pnpm` field, so an override left there pins nothing while an upgrade run with `--write` goes on rewriting it',
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
          fix: `Point each listed entry at a committed wrapper under bin/ that loads the build output at runtime. pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, so a target that is not committed does not exist when pnpm reaches for it — and pnpm never retries, leaving the link missing for the life of the node_modules tree`,
        },
        {
          name: "every bin wrapper's build-output target is covered by files",
          severity: 'warn',
          check: () => everyBinWrapperTargetIsCoveredByFiles(),
          fix: 'Add the build output directory to `files` in each listed package. npm and pnpm publish the bin target itself whatever `files` says, so the wrapper ships pointing at build output missing from the tarball',
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
          fix: "Replace each listed config with: import { defineVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineVitestConfig(); -- a config that does not call the factory declares no projects, so every tier-selecting test command fails against it. Pass your own settings to the factory as layers to keep them",
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
          fix: 'Add a vitest.config.ts calling defineVitestConfig() from @williamthorsen/nmr/vitest beside each listed vite.config -- Vitest stops its config search at the first directory holding either name, so the Vite config otherwise wins and the projects model is never reached',
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

        // -- Shared upgrade policy -----------------------------------------------
        {
          name: 'taze.config.ts builds on @williamthorsen/nmr/taze',
          severity: 'warn',
          check: () => tazeConfigBuildsOnSharedConfig(),
          fix: "Replace the taze config with: import { defineConfig } from '@williamthorsen/nmr/taze'; export default defineConfig(); — nmr's upgrade policy reaches a repo only through this file, so without it `nmr upgrade` reports nothing where dependencies are pinned to exact versions",
        },
        {
          name: 'taze config declares no option taze discards',
          severity: 'warn',
          quiet: true,
          check: () => tazeConfigAvoidsClobberedOptions(),
          fix: "Set these through the upgrade script instead, as rootScripts: { upgrade: 'nmr-report-overrides && nmr-taze --recursive --request-timeout 90000' } in .config/nmr.config.ts, keeping the rest of the default script — taze's CLI writes a default for each of them over whatever the config file declares, so the value there never reaches taze (antfu-collective/taze#317). nmr already forwards a 30-second request timeout",
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

/** The directory a build writes its output to, which a `bin` target names only where it has skipped the wrapper. */
const BUILD_OUTPUT_DIR = 'dist';

/**
 * Matches the first relative specifier a bin wrapper names, which is the build entry it loads at runtime.
 *
 * One pattern reaches both shapes in use: `await import('../dist/esm/cli.js')`, and the newer
 * `new URL('../dist/esm/cli.js', import.meta.url)` whose href the wrapper then imports.
 */
const WRAPPER_TARGET_PATTERN = /['"](\.\.?\/[^'"]+)['"]/;

/** Extensions a Vite or Vitest config can carry. Globbing `.ts` alone would miss a repo on any other one. */
const CONFIG_EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

/** Matches a Vite config, which fills Vitest's one config slot wherever no Vitest config sits beside it. */
const VITE_CONFIG_PATTERN = `vite.config.${CONFIG_EXTENSIONS}`;

const VITEST_CONFIG_PATTERN = `vitest.config.${CONFIG_EXTENSIONS}`;

const SHARED_VITEST_MODULE = '@williamthorsen/nmr/vitest';

const SHARED_PRETTIER_MODULE = '@williamthorsen/nmr/prettier';

/** Prettier config forms that hold data rather than code, so none of them can call a factory. */
const INERT_PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.{json,json5,yaml,yml,toml}'];

const SHARED_TAZE_MODULE = '@williamthorsen/nmr/taze';

/** taze config forms that hold data rather than code, so none of them can call a factory. */
const INERT_TAZE_CONFIGS = ['.tazerc', '.tazerc.json', 'taze.config.json'];

/**
 * taze options a config file cannot carry, each paired with the pattern that finds a declaration taze discards.
 * Its CLI writes a default for every one of them into the options it merges over the config file.
 *
 * `concurrency` and `requestTimeout` lose whatever the file declares, so the key alone is the finding. The other
 * three carry a CLI default equal to taze's own, so only a departure from it is lost, and matching the key alone
 * would report a setting that reaches taze intact.
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

/** Checks that a root-level Vitest config is present and built on the shared config from nmr. */
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

/** Either the repo's member workspaces or the reason discovery could not enumerate them. */
type WorkspaceDiscovery = { ok: true; workspaces: Workspace[] } | { ok: false; detail: string };

/**
 * Returns every workspace but the root, or the reason discovery could not enumerate them.
 *
 * A failure is returned rather than thrown, because readyup catches a throw at kit level and one would take
 * the rest of the checklist down with it; it is returned rather than swallowed, because an empty list turns
 * every check built on this one into a pass over a repo it verified nothing about. Discovery throws where the
 * root manifest is unreadable, and where the workspace globs use a YAML or glob feature readyup's discovery
 * does not support, a negation pattern among them.
 *
 * A check built on this reads `process.cwd()` and can offer no directory of its own: readyup's public entry
 * exports `discoverWorkspaces` alone, not the `discoverWorkspacesAt(dir)` form its source declares.
 */
function discoverMemberWorkspaces(): WorkspaceDiscovery {
  try {
    return { ok: true, workspaces: discoverWorkspaces({ filter: (workspace) => !workspace.isRoot }) };
  } catch (error) {
    return { ok: false, detail: `cannot enumerate workspaces: ${describeError(error)}` };
  }
}

/**
 * Checks that every workspace `bin` entry points at a committed wrapper rather than at build output.
 *
 * pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, and
 * never retries: a target that is not committed is missing for the life of the `node_modules` tree, and deleting
 * that tree is the only repair. Private packages are in scope, because pnpm links their bins too.
 *
 * Tracking rather than presence is what the second reason reads. A target under `dist/` is on disk in any built
 * checkout, so its absence is evidence only in a fresh clone, while git's ignorance of it holds either way.
 *
 * @internal - Exported only to enable testing
 */
export async function everyBinTargetIsACommittedWrapper(): Promise<boolean | CheckOutcome> {
  const discovery = discoverMemberWorkspaces();
  if (!discovery.ok) return discovery;

  const tracked = await listTrackedFiles();
  const trackedPaths = tracked === undefined ? undefined : new Set(tracked);

  const offenders = discovery.workspaces.flatMap((workspace) =>
    readBinEntries(workspace).flatMap((entry) => {
      const defect = describeBinTargetDefect(workspace, entry, trackedPaths);
      return defect === undefined ? [] : [`${describeBinEntry(workspace, entry)} (${defect})`];
    }),
  );

  if (offenders.length === 0) return true;
  return { ok: false, detail: formatPaths(offenders) };
}

/**
 * Checks that `files` covers the build output each bin wrapper loads at runtime.
 *
 * npm and pnpm publish every `bin` target whatever `files` says, so the wrapper always ships; what `files` can
 * drop is the build entry it reaches for, which publishes a bin resolving to nothing. No package here declares
 * `main`, whose own force-include would otherwise catch the same omission.
 *
 * A package declaring no `files` skips, as does a target under `dist/`, which is build output rather than a
 * wrapper and belongs to `everyBinTargetIsACommittedWrapper`. An unreadable file and one naming no relative
 * specifier skip too: the wrapper's shape is a convention rather than a contract.
 *
 * @internal - Exported only to enable testing
 */
export function everyBinWrapperTargetIsCoveredByFiles(): boolean | CheckOutcome {
  const discovery = discoverMemberWorkspaces();
  if (!discovery.ok) return discovery;

  const cwd = process.cwd();
  const offenders = discovery.workspaces.flatMap((workspace) => {
    const files = workspace.packageJson['files'];
    if (!Array.isArray(files)) return [];

    const published = new Set(files.flatMap((entry) => (typeof entry === 'string' ? [readFirstSegment(entry)] : [])));

    return readBinEntries(workspace).flatMap((entry) => {
      const target = readWrapperTarget(cwd, workspace, entry);
      if (target === undefined || published.has(readFirstSegment(target))) return [];
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

/** Renders one entry as `{package}:{command} -> {target}`, the form an offender is reported in. */
function describeBinEntry(workspace: Workspace, entry: BinEntry): string {
  return `${workspace.name ?? workspace.dir}:${entry.command} -> ${entry.target}`;
}

/**
 * Names what is wrong with a `bin` target, or undefined where nothing is.
 *
 * A target under `dist/` reports under that reason alone, though it is untracked as well: the two share one fix,
 * and naming the directory is what points at the wrapper pattern. A tree outside a git repository yields no
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

/** Strips a leading `./` from a `bin` target, which no comparison here should have to allow for. */
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
 * Comparing at this granularity accepts a `files` entry naming a subdirectory of the target, so `files:
 * ["dist/esm"]` passes a wrapper loading `../dist/cjs/cli.js`. The coarsening under-reports rather than
 * misreports.
 */
function readFirstSegment(entry: string): string {
  return normalizeBinTarget(entry).split('/', 1).at(0) ?? '';
}

/**
 * Resolves the build entry a wrapper loads, as a package-relative path, or undefined where it names none.
 *
 * A target under `dist/` resolves to undefined: it is build output rather than a wrapper, and in a built
 * checkout reading it would match the compiled entry's own first relative import. A build directory under any
 * other name is still read as a wrapper, which is the residue of identifying one by `dist/` alone.
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
 * Checks that every workspace holding a Vite config holds a Vitest config beside it.
 *
 * Vitest resolves one config per run by ascending from the run root and stopping at the first directory
 * holding any of its candidate filenames, `vite.config.*` among them. A workspace carrying only a Vite
 * config ends that search on a config declaring no projects, and every tier-selecting test command then
 * fails with `No projects matched the filter`. Within one directory `vitest.config.*` is tried first, which
 * is why a Vitest config beside the Vite config restores the projects model.
 *
 * Declared workspaces rather than a tree-wide glob: the search only ascends, so a Vite config nested below
 * a workspace root is never reached and reporting it would be a false positive.
 *
 * @internal - Exported only to enable testing
 */
export function everyViteConfigHasVitestConfig(): boolean | CheckOutcome {
  const discovery = discoverMemberWorkspaces();
  if (!discovery.ok) return discovery;

  const unpaired = discovery.workspaces.flatMap((workspace) => {
    const viteConfigs = findWorkspaceConfigs(workspace, VITE_CONFIG_PATTERN);
    if (viteConfigs.length === 0) return [];
    return findWorkspaceConfigs(workspace, VITEST_CONFIG_PATTERN).length > 0 ? [] : viteConfigs;
  });

  if (unpaired.length === 0) return true;
  return { ok: false, detail: formatPaths(unpaired) };
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

/** Returns a workspace's own configs matching the pattern, as paths relative to the repo root. */
function findWorkspaceConfigs(workspace: Workspace, pattern: string): string[] {
  return findFiles([pattern], workspace.absolutePath).map((name) => `${workspace.dir}/${name}`);
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

/** Reports whether a Vite config sits in the same directory as the given file. */
function hasViteConfigBeside(cwd: string, relativePath: string): boolean {
  return findFiles([VITE_CONFIG_PATTERN], join(cwd, dirname(relativePath))).length > 0;
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
 * Reports whether `noReExportOnlyVitestConfigs` owns a config, which is where deleting it is the right fix.
 *
 * Deleting is right only where nothing else in the directory would take over resolution. A config beside a
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
 * Checks that no `package.json` in the tree declares a `pnpm` field.
 *
 * pnpm 11 reads no key from that field, so every setting left in one is inert while still reading as
 * maintained. taze keeps its own list of dependency fields, so an upgrade run with `--write` goes on rewriting
 * the versions in `pnpm.overrides`, which is what makes a dead block look current.
 *
 * The whole tree rather than the workspace globs: the field is dead in every manifest, whether or not pnpm
 * loads that one.
 *
 * @internal - Exported only to enable testing
 */
export function noPnpmFieldInPackageJson(cwd: string = process.cwd()): boolean | CheckOutcome {
  const declaring = findFiles(['**/package.json'], cwd).flatMap((relativePath) => {
    const keys = readPnpmFieldKeys(readFileIn(cwd, relativePath));
    if (keys === undefined) return [];
    return [keys.length > 0 ? `${relativePath} (${keys.join(', ')})` : relativePath];
  });

  if (declaring.length === 0) return true;
  return { ok: false, detail: formatPaths(declaring) };
}

/**
 * Checks that no package carries a `vitest.config.*` that only re-exports an ancestor config.
 *
 * Only non-root configs qualify, identified by their path carrying a separator. One beside a Vite config is
 * load-bearing rather than redundant, so it is left to `vitestConfigBuildsOnSharedConfig`: deleting it would
 * hand resolution to the Vite config, producing the failure that check exists to prevent.
 *
 * @internal - Exported only to enable testing
 */
export function noReExportOnlyVitestConfigs(cwd: string = process.cwd()): boolean | CheckOutcome {
  const nonRootConfigs = findFiles([`**/${VITEST_CONFIG_PATTERN}`], cwd).filter((path) => path.includes('/'));
  const reExports = nonRootConfigs.filter((path) => isOwnedByReExportCheck(cwd, path));

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

/**
 * Checks that no root script that `pnpm install` runs invokes `lefthook install` without `lefthook check-install`.
 *
 * Any `check-install` in the script counts as the guard, so an `if !` spelling passes and an unusual spelling
 * errs toward a false negative. A script run by hand is out of scope, because forcing a reinstall is its purpose.
 *
 * @internal - Exported only to enable testing
 */
export function noUnguardedLefthookInstall(cwd: string = process.cwd()): boolean | CheckOutcome {
  const scripts = readRootScripts(cwd);
  const unguarded = INSTALL_LIFECYCLE_SCRIPTS.flatMap((name) => {
    const command = scripts[name];
    if (typeof command !== 'string') return [];
    const isUnguarded = LEFTHOOK_INSTALL_PATTERN.test(command) && !LEFTHOOK_CHECK_INSTALL_PATTERN.test(command);
    return isUnguarded ? [`${name}: ${command}`] : [];
  });

  if (unguarded.length === 0) return true;
  return { ok: false, detail: formatPaths(unguarded) };
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

/** Reads a file resolved against `cwd`, returning undefined when it is absent. */
function readFileIn(cwd: string, relativePath: string): string | undefined {
  return readFile(join(cwd, relativePath));
}

/**
 * Returns the keys a manifest's `pnpm` field holds, sorted, or undefined when it declares no such field.
 *
 * A manifest that does not parse reads as declaring none: this check does not own the file, and throwing would
 * take the rest of the checklist down over it.
 */
function readPnpmFieldKeys(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  const pnpm = parsed['pnpm'];

  return isRecord(pnpm) ? Object.keys(pnpm).toSorted() : undefined;
}

/**
 * Returns the root manifest's `scripts`, or an empty record when the manifest is absent, does not parse, or declares
 * no scripts object. A malformed manifest is not this check's to report.
 */
function readRootScripts(cwd: string): Record<string, unknown> {
  const content = readFileIn(cwd, 'package.json');
  if (content === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }

  if (!isRecord(parsed)) return {};
  const scripts = parsed['scripts'];
  return isRecord(scripts) ? scripts : {};
}

/** Reports whether a range defers to a workspace-level declaration instead of naming a version. */
function resolvesVersionViaWorkspace(range: string): boolean {
  return WORKSPACE_VERSION_MARKERS.some((marker) => range.startsWith(marker));
}

/**
 * Checks that the repo's taze config is present and built on the shared config from nmr.
 *
 * Absence fails rather than skipping: taze reads no config at all without one, so the repo silently loses
 * both the release-maturity soak and the pair of settings that report a dependency pinned to a bare version.
 * A config in one of the data-only forms fails the same way, being unable to call a factory.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);

  if (configs.length === 0) {
    return { ok: false, detail: describeMissingTazeConfig(cwd) };
  }

  const stale = configs.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), 'defineConfig', SHARED_TAZE_MODULE),
  );
  if (stale.length === 0) return true;
  return { ok: false, detail: `does not import defineConfig from ${SHARED_TAZE_MODULE}: ${stale.join(', ')}` };
}

/**
 * Checks that the repo's taze config declares no option taze's CLI discards.
 *
 * Reports the setting rather than the file, because the fix is per option: each one moves onto the upgrade
 * script, where it reaches taze as a flag. A repo declaring none of them is already in the passing state.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigAvoidsClobberedOptions(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);
  const findings: string[] = [];

  for (const relativePath of configs) {
    const content = readFileIn(cwd, relativePath);
    if (content === undefined) continue;

    const discarded = CLOBBERED_TAZE_OPTIONS.filter(({ pattern }) => pattern.test(content)).map(({ key }) => key);
    if (discarded.length > 0) findings.push(`${relativePath}: ${discarded.join(', ')}`);
  }

  if (findings.length === 0) return true;
  return { ok: false, detail: formatPaths(findings) };
}

/** Names the data-only config standing in for an executable one, so the fix says what to convert. */
function describeMissingTazeConfig(cwd: string): string {
  const inert = findFiles(INERT_TAZE_CONFIGS, cwd);
  if (inert.length > 0) return `holds no code to call the factory: ${inert.join(', ')}`;

  return 'taze.config.ts is missing';
}

/** Checks that .tool-versions does not list pnpm. Pass if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}

/**
 * Checks that the root `vitest.config.*` is present, and that it and every workspace's own build on
 * `defineVitestConfig`.
 *
 * The root config is the ancestor a workspace resolves by walking up from its own directory. Its absence is
 * folded in here rather than split into a check of its own: a repo without it leaves packages walking up
 * past the repo root, which is a worse failure than a wrong config, not a lesser one.
 *
 * A workspace config that does not call the factory declares no projects, so it fails a tier-selecting run
 * exactly as a missing root config does; presence alone is no evidence the projects model is reached.
 *
 * A re-export-only config with no Vite config beside it is left to `noReExportOnlyVitestConfigs`, whose fix
 * deletes it rather than rewriting it.
 *
 * @internal - Exported only to enable testing
 */
export function vitestConfigBuildsOnSharedConfig(): boolean | CheckOutcome {
  const cwd = process.cwd();
  const rootConfigs = findFiles([VITEST_CONFIG_PATTERN], cwd);
  if (rootConfigs.length === 0) return { ok: false, detail: 'vitest.config.ts is missing' };

  const discovery = discoverMemberWorkspaces();
  if (!discovery.ok) return discovery;

  const workspaceConfigs = discovery.workspaces
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
 * nmr's root test scripts name this file by path, and a config declaring no projects makes
 * `nmr root:test:tool` exit 1.
 *
 * @internal - Exported only to enable testing
 */
export function vitestRootConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  return checkRootVitestConfig('vitest.root.config', 'defineRootVitestConfig', cwd);
}

// endregion | Helpers
