/**
 * Preflight collection for consumers of @williamthorsen/release-kit.
 *
 * Verifies that the consuming repo's release-kit setup is current, workflows
 * reference the correct reusable workflows, and config doesn't use removed fields.
 * The minimum version is read from the release-kit package's package.json and
 * inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   preflight run --file <path-to>/release-kit.js
 */
import {
  definePreflightCollection,
  fileContains,
  fileDoesNotContain,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
} from '@williamthorsen/preflight';

import releaseKitPackageJson from '../../packages/release-kit/package.json';

const MIN_VERSION = releaseKitPackageJson.version;

export default definePreflightCollection({
  checklists: [
    {
      name: 'release-kit',
      checks: [
        {
          name: '@williamthorsen/release-kit in devDependencies',
          severity: 'error',
          check: () => hasDevDependency('@williamthorsen/release-kit'),
          fix: 'pnpm add --save-dev @williamthorsen/release-kit',
          checks: [
            {
              name: `@williamthorsen/release-kit >= ${MIN_VERSION}`,
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('@williamthorsen/release-kit', MIN_VERSION, {
                  exempt: (range) => range.startsWith('workspace:'),
                }),
              fix: `pnpm add --save-dev @williamthorsen/release-kit@^${MIN_VERSION}`,
            },
          ],
        },
        {
          name: 'release.yaml workflow exists',
          severity: 'warn',
          check: () => fileExists('.github/workflows/release.yaml'),
          fix: 'Add .github/workflows/release.yaml using the release workflow template',
          checks: [
            {
              name: 'release workflow references release.reusable.yaml',
              severity: 'warn',
              check: () =>
                fileContains(
                  '.github/workflows/release.yaml',
                  /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)release\.reusable\.yaml/,
                ),
              fix: 'Update release.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@release-workflow-v1',
            },
          ],
        },
        {
          name: 'publish.yaml workflow exists',
          severity: 'warn',
          check: () => fileExists('.github/workflows/publish.yaml'),
          fix: 'Add .github/workflows/publish.yaml using the publish workflow template',
          checks: [
            {
              name: 'publish workflow references publish.reusable.yaml',
              severity: 'warn',
              check: () =>
                fileContains(
                  '.github/workflows/publish.yaml',
                  /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)publish\.reusable\.yaml/,
                ),
              fix: 'Update publish.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@publish-workflow-v1',
            },
          ],
        },
        {
          name: 'config does not use removed tagPrefix',
          severity: 'error',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => fileDoesNotContain('.config/release-kit.config.ts', /tagPrefix/),
          fix: "Remove 'tagPrefix' from .config/release-kit.config.ts — it is no longer supported; the default '{dir}-v' is used automatically",
        },
        {
          name: 'git-cliff not in devDependencies',
          severity: 'recommend',
          check: () => !hasDevDependency('git-cliff'),
          fix: 'pnpm remove git-cliff — release-kit handles changelog generation directly',
        },
      ],
    },
  ],
});
