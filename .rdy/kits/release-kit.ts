/**
 * Readyup kit for consumers of @williamthorsen/release-kit.
 *
 * Verifies that the consuming repo's release-kit setup is current, workflows
 * reference the correct reusable workflows, and config doesn't use removed fields.
 * The minimum version is read from the release-kit package's package.json and
 * inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --file <path-to>/release-kit.js
 */
import {
  defineRdyKit,
  fileContains,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion,
  readFile,
} from 'readyup';

import releaseKitPackageJson from '../../packages/release-kit/package.json' with { type: 'json' };

const MIN_VERSION = releaseKitPackageJson.version;

// SHA-256 hashes of release-kit artifacts. Keep in sync —
// verified by __tests__/rdy-kit-hashes.app.test.ts.
export const CLIFF_TEMPLATE_HASH = '7cdde9cd562a5b0900043fc5f3f51957d534cc6fb9f7ab7c910a64d8d1b7950a';
export const COMMON_PRESET_HASH = 'd12ffccbd5e4d9af8ecf47744b143f6c9f80bcf5e496cf1983b66834f0ae7825';
export const SYNC_LABELS_WORKFLOW_HASH = 'c0206871afadf1bf12a8dbe51afbd8e6d49724ca48875c168fbf1da891abcfad';

export default defineRdyKit({
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
        {
          name: '.config/git-cliff.toml matches current template',
          severity: 'warn',
          skip: () => (!fileExists('.config/git-cliff.toml') ? 'no local cliff config (using fallback)' : false),
          check: () => fileMatchesHash('.config/git-cliff.toml', CLIFF_TEMPLATE_HASH),
          fix: 'Update .config/git-cliff.toml to match the current cliff.toml.template from release-kit, or delete it to use the bundled fallback',
        },
        {
          name: 'sync-labels.yaml workflow exists',
          severity: 'warn',
          check: () => fileExists('.github/workflows/sync-labels.yaml'),
          fix: 'Run `release-kit sync-labels init` to scaffold the workflow',
          checks: [
            {
              name: 'sync-labels.yaml matches template',
              severity: 'warn',
              check: () => fileMatchesHash('.github/workflows/sync-labels.yaml', SYNC_LABELS_WORKFLOW_HASH),
              fix: 'Run `release-kit sync-labels init --force` to regenerate the workflow from the current template',
            },
          ],
        },
        {
          name: '.config/sync-labels.config.ts exists',
          severity: 'recommend',
          check: () => fileExists('.config/sync-labels.config.ts'),
          fix: 'Run `release-kit sync-labels init` to scaffold the config, then customize labels',
        },
        {
          name: '.github/labels.yaml exists',
          severity: 'warn',
          skip: () => (!fileExists('.config/sync-labels.config.ts') ? 'no sync-labels config' : false),
          check: () => fileExists('.github/labels.yaml'),
          fix: 'Run `release-kit sync-labels generate` to produce the labels file',
          checks: [
            {
              name: 'labels.yaml has current common preset',
              severity: 'warn',
              check: () => labelsHaveCurrentPresetHash('common', COMMON_PRESET_HASH),
              fix: 'Run `release-kit sync-labels generate` to incorporate updated common labels',
            },
          ],
        },
      ],
    },
  ],
});

// -- Helpers ------------------------------------------------------------------

/** Check that `.github/labels.yaml` contains the expected hash for a named preset. */
function labelsHaveCurrentPresetHash(presetName: string, expectedHash: string): boolean {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, 'm');
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
