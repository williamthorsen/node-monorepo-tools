import { pickJson, type RdyCheck } from 'readyup';
import {
  fileContains,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  readFile,
} from 'readyup/check-utils';

import { cataloguedDependenciesUseCatalog } from './catalog.ts';
import { noPnpmFieldInPackageJson, noWorkspacesFieldInPackageJson } from './manifest-fields.ts';

/** The first ESLint release that resolves config per linted file rather than from the working directory. */
const MIN_ESLINT_VERSION = '10.0.0';

/** The first strict-lint release that resolves both the ESLint config and its own ceilings per linted file. */
const MIN_STRICT_LINT_VERSION = '9.3.0';

/** Protocols that defer a dependency's version to pnpm-workspace.yaml or to a sibling package. */
const WORKSPACE_VERSION_MARKERS = ['catalog:', 'workspace:'];

export const setupChecks: RdyCheck[] = [
  {
    name: '@williamthorsen/nmr in devDependencies',
    severity: 'error',
    check: () => hasDevDependency('@williamthorsen/nmr'),
    fix: 'pnpm add --save-dev @williamthorsen/nmr',
    checks: [
      {
        get name(): string {
          return `@williamthorsen/nmr >= ${getMinVersion()}`;
        },
        severity: 'error',
        check: () =>
          hasMinDevDependencyVersion('@williamthorsen/nmr', getMinVersion(), {
            exempt: resolvesVersionViaWorkspace,
          }),
        get fix(): string {
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
    get name(): string {
      return `eslint >= ${MIN_ESLINT_VERSION}`;
    },
    severity: 'error',
    skip: () => !hasDevDependency('eslint') && 'eslint not installed',
    check: hasSupportedEslintVersion,
    get fix(): string {
      return `pnpm add --save-dev eslint@^${MIN_ESLINT_VERSION}. Earlier releases resolve config from the working directory, so nmr's root lint and lint:check would apply the root config to every package`;
    },
  },
  {
    get name(): string {
      return `@williamthorsen/strict-lint >= ${MIN_STRICT_LINT_VERSION}`;
    },
    severity: 'error',
    skip: () => !hasDevDependency('@williamthorsen/strict-lint') && 'strict-lint not installed',
    check: hasSupportedStrictLintVersion,
    get fix(): string {
      return `pnpm add --save-dev @williamthorsen/strict-lint@^${MIN_STRICT_LINT_VERSION}. Earlier releases pin ESLint to one config and resolve ceilings from the working directory, so nmr's root lint:strict would report the wrong rules for every package`;
    },
  },
];

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

// region | Helpers

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

/** Reports whether a range defers to a workspace-level declaration instead of naming a version. */
function resolvesVersionViaWorkspace(range: string): boolean {
  return WORKSPACE_VERSION_MARKERS.some((marker) => range.startsWith(marker));
}

/** Checks that .tool-versions does not list pnpm. Passes if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}

// endregion | Helpers
