/**
 * Preflight collection for consumers of @williamthorsen/nmr.
 *
 * Verifies that the consuming repo's nmr setup is current and correctly configured.
 * The minimum version is read from the nmr package's package.json and inlined by
 * esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   preflight run --file <path-to>/nmr.js
 */
import {
  definePreflightCollection,
  fileContains,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  readFile,
} from '@williamthorsen/preflight';

import nmrPackageJson from '../../packages/nmr/package.json';

const MIN_VERSION = nmrPackageJson.version;

export default definePreflightCollection({
  checklists: [
    {
      name: 'nmr',
      checks: [
        {
          name: '@williamthorsen/nmr in devDependencies',
          severity: 'error',
          check: () => hasDevDependency('@williamthorsen/nmr'),
          fix: 'pnpm add --save-dev @williamthorsen/nmr',
          checks: [
            {
              name: `@williamthorsen/nmr >= ${MIN_VERSION}`,
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('@williamthorsen/nmr', MIN_VERSION, {
                  exempt: (range) => range.startsWith('workspace:'),
                }),
              fix: `pnpm add --save-dev @williamthorsen/nmr@^${MIN_VERSION}`,
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
          check: () => toolVersionsHasNoPnpm(),
          fix: 'Remove pnpm from .tool-versions — manage via packageManager field and corepack',
        },
        {
          name: '.config/nmr.config.ts uses defineConfig',
          severity: 'recommend',
          skip: () => (!fileExists('.config/nmr.config.ts') ? 'no nmr config file' : false),
          check: () => fileContains('.config/nmr.config.ts', /defineConfig/),
          fix: 'Wrap your config export with defineConfig() from @williamthorsen/nmr for type safety',
        },
      ],
    },
  ],
});

// -- Collection-specific helpers ----------------------------------------------

/** Check that .tool-versions does not list pnpm. Pass if the file is absent. */
function toolVersionsHasNoPnpm(): boolean {
  const content = readFile('.tool-versions');
  if (content === undefined) return true;
  return !/^pnpm\s/m.test(content);
}
