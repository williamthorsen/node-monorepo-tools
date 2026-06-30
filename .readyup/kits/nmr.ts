/**
 * Readyup kit for consumers of @williamthorsen/nmr.
 *
 * Verifies that the consuming repo's nmr setup is current and correctly configured.
 * The minimum version is read from the nmr package's package.json and inlined by
 * esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --file <path-to>/nmr.js
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getDefaultRootScripts } from '@williamthorsen/nmr/scripts';
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
                  exempt: (range) => range.startsWith('workspace:'),
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
          check: toolVersionsHasNoPnpm,
          fix: 'Remove pnpm from .tool-versions — manage via packageManager field and corepack',
        },
        {
          name: '.config/nmr.config.ts uses defineConfig',
          severity: 'recommend',
          skip: () => (!fileExists('.config/nmr.config.ts') ? 'no nmr config file' : false),
          check: () => fileContains('.config/nmr.config.ts', /defineConfig/),
          fix: 'Wrap your config export with defineConfig() from @williamthorsen/nmr for type safety',
        },

        // -- Root script cleanup -------------------------------------------------
        {
          name: 'root package.json has no nmr-provided scripts',
          severity: 'warn',
          check: noRedundantRootScripts,
          fix: 'Remove scripts from root package.json that nmr provides as built-in root scripts — invoke via nmr directly',
        },

        {
          name: 'root:lint:strict does not use echo fallback',
          severity: 'warn',
          skip: () => (!scriptExists('root:lint:strict') ? 'no root:lint:strict script' : false),
          check: () => !scriptMatches('root:lint:strict', /\becho\b/),
          fix: 'Replace the echo fallback in root:lint:strict — strict-lint now supports path arguments',
        },

        // -- Workspace build readiness -------------------------------------------
        {
          name: 'all workspace packages can build',
          severity: 'warn',
          check: allWorkspacePackagesCanBuild,
          fix: 'Add "build": ":" to packages that don\'t need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory',
        },

        // -- Audit dependency --------------------------------------------------------
        {
          name: 'v11y-check in devDependencies',
          severity: 'warn',
          check: () => hasDevDependency('v11y-check'),
          fix: 'pnpm add --save-dev v11y-check',
        },
        {
          name: 'code-quality workflow does not use nmr ci',
          severity: 'warn',
          skip: () => (!fileExists('.github/workflows/code-quality.yaml') ? 'no code-quality workflow' : false),
          check: codeQualityWorkflowDoesNotUseNmrCi,
          fix: 'Change the check-command in .github/workflows/code-quality.yaml from "pnpm exec nmr ci" to "pnpm exec nmr build && pnpm exec nmr check:strict"',
        },

        // -- Legacy script runner ------------------------------------------------
        {
          name: 'scripts/run-workspace-script.ts does not exist',
          severity: 'error',
          check: () => !fileExists('scripts/run-workspace-script.ts'),
          fix: 'Delete scripts/run-workspace-script.ts — nmr replaces this custom script runner',
        },
        {
          name: 'no workspace packages reference run-workspace-script or "pnpm run ws"',
          severity: 'error',
          check: noWorkspaceRunScriptReferences,
          fix: 'Remove "ws" script entries and replace any "pnpm run ws" invocations with nmr in each packages/*/package.json',
        },
      ],
    },
  ],
});

// region | Helpers

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

/**
 * Checks that the code-quality workflow does not use `nmr ci` as the check command.
 *
 * @internal - Exported only to enable testing
 */
export function codeQualityWorkflowDoesNotUseNmrCi(): boolean {
  const content = readFile('.github/workflows/code-quality.yaml');
  if (content === undefined) return true;
  return !/check-command:\s*pnpm exec nmr ci(\s|$)/.test(content);
}

function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const picked = pickJson('../../packages/nmr/package.json', ['version']);
  if (typeof picked.version !== 'string') {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return picked.version;
}

/** Check that root package.json has no scripts that duplicate nmr built-in root scripts. */
function noRedundantRootScripts(): boolean | CheckOutcome {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg.scripts;
  if (!isRecord(scripts)) return true;

  const builtInNames = Object.keys(getDefaultRootScripts());
  const redundant = Object.keys(scripts).filter((name) => builtInNames.includes(name));

  if (redundant.length === 0) return true;
  return {
    ok: false,
    detail: `redundant: ${redundant.join(', ')}`,
  };
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

/** Check whether a named script exists in root package.json. */
function scriptExists(name: string): boolean {
  const pkg = readPackageJson();
  if (!pkg) return false;
  const scripts = pkg.scripts;
  return isRecord(scripts) && name in scripts;
}

/** Check whether a named script's value matches a regex. Return false if absent. */
function scriptMatches(name: string, pattern: RegExp): boolean {
  const pkg = readPackageJson();
  if (!pkg) return false;
  const scripts = pkg.scripts;
  if (!isRecord(scripts)) return false;
  const value = scripts[name];
  return typeof value === 'string' && pattern.test(value);
}

/** Checks that .tool-versions does not list pnpm. Pass if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}

// endregion | Helpers
