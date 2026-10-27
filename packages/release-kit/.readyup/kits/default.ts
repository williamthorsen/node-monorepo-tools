/**
 * Readyup kit for consumers of @williamthorsen/release-kit.
 *
 * Verifies that the consuming repo's release-kit setup is current, workflows reference the correct reusable workflows,
 * and config doesn't use removed fields. The minimum version is read from the release-kit package's package.json and
 * inlined by esbuild at compile time.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:@williamthorsen/release-kit
 *
 * A check asserting the absence of something declares `quiet`: A conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { defineRdyKit, pickJson } from 'readyup';
import {
  discoverWorkspaces,
  fileContains,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion,
} from 'readyup/check-utils';

import { detectRepoType } from '../../src/init/detectRepoType.ts';
import {
  changelogArchivesAreEnabled,
  changelogJsonIsEnabled,
  packagesShipChangelog,
  packagesShipChangelogArchives,
  packagesShipChangelogJson,
  resolveChangelogJsonOutputPath,
} from '../lib/changelog-checks.ts';
import {
  configFileExportsConfig,
  labelsHaveCurrentPresetHash,
  readmesHaveReleaseNotesMarkers,
  releaseNotesConfigIsConsistent,
  releaseNotesInjectsIntoReadme,
  scopeLabelsHaveNoDescriptions,
} from '../lib/config-checks.ts';
import {
  COMMON_PRESET_HASH,
  CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO,
  CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
} from '../lib/workflow-hashes.ts';

/** Returns the minimum release-kit version that a consuming repo must declare. */
function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so that module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const picked = pickJson('../../package.json', ['version']);
  if (typeof picked['version'] !== 'string') {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked['version'];
}

/** Checks whether the repo contains any publishable workspace. */
function hasPublishablePackages(): boolean {
  return discoverWorkspaces({ filter: (w) => w.isPackage }).length > 0;
}

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
              get name() {
                return `@williamthorsen/release-kit >= ${getMinVersion()}`;
              },
              severity: 'error',
              check: () =>
                hasMinDevDependencyVersion('@williamthorsen/release-kit', getMinVersion(), {
                  exempt: (range) => range.startsWith('workspace:'),
                }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/release-kit@^${getMinVersion()}`;
              },
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
              name: 'release.yaml matches template',
              severity: 'warn',
              check: () => {
                const hash =
                  detectRepoType() === 'monorepo' ? RELEASE_WORKFLOW_HASH_MONOREPO : RELEASE_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash('.github/workflows/release.yaml', hash);
              },
              fix: 'Run `release-kit update-templates` to regenerate release.yaml from the current template',
            },
            {
              name: 'release.yaml does not reference deprecated tag ref',
              severity: 'error',
              quiet: true,
              check: () => fileDoesNotContain('.github/workflows/release.yaml', /@(release|publish)-workflow-v[0-9]/),
              fix: 'Update release.yaml to use @workflow/release-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)',
            },
          ],
        },
        {
          name: 'publish.yaml workflow exists',
          severity: 'warn',
          skip: () => !hasPublishablePackages() && 'no publishable packages',
          check: () => fileExists('.github/workflows/publish.yaml'),
          fix: 'Add .github/workflows/publish.yaml using the publish workflow template',
          checks: [
            {
              name: 'publish.yaml matches template',
              severity: 'warn',
              check: () => {
                const hash =
                  detectRepoType() === 'monorepo' ? PUBLISH_WORKFLOW_HASH_MONOREPO : PUBLISH_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash('.github/workflows/publish.yaml', hash);
              },
              fix: 'Run `release-kit update-templates` to regenerate publish.yaml from the current template',
            },
            {
              name: 'publish.yaml does not reference deprecated tag ref',
              severity: 'error',
              quiet: true,
              check: () => fileDoesNotContain('.github/workflows/publish.yaml', /@(release|publish)-workflow-v[0-9]/),
              fix: 'Update publish.yaml to use @workflow/publish-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)',
            },
          ],
        },
        {
          name: 'create-github-release.yaml matches template',
          severity: 'warn',
          skip: () =>
            !fileExists('.github/workflows/create-github-release.yaml') &&
            'no create-github-release workflow (GitHub Releases not adopted)',
          check: () => {
            const hash =
              detectRepoType() === 'monorepo'
                ? CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO
                : CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE;
            return fileMatchesHash('.github/workflows/create-github-release.yaml', hash);
          },
          fix: 'Run `release-kit update-templates` to regenerate create-github-release.yaml from the current template',
        },
        {
          name: '.config/release-kit.config.ts exports a config',
          severity: 'error',
          skip: () => !fileExists('.config/release-kit.config.ts') && 'no release-kit config file',
          check: () => configFileExportsConfig(),
          fix: 'Export the config from .config/release-kit.config.ts as a default export or as a named `config` export; release-kit does not resolve any other export',
          checks: [
            {
              name: 'releaseNotes config is consistent with changelogJson',
              severity: 'warn',
              check: () => releaseNotesConfigIsConsistent(),
              fix: 'Either enable changelogJson.enabled or disable releaseNotes.shouldInjectIntoReadme',
            },
            {
              name: '.config/release-kit.config.ts uses defineConfig',
              severity: 'recommend',
              check: () => fileContains('.config/release-kit.config.ts', /defineConfig/),
              fix: 'Wrap the config export with defineConfig() from @williamthorsen/release-kit/config for type safety',
            },
            {
              name: 'releaseNotes.shouldInjectIntoReadme is true',
              severity: 'warn',
              check: () => releaseNotesInjectsIntoReadme(),
              fix: 'Set releaseNotes.shouldInjectIntoReadme to true in .config/release-kit.config.ts',
              checks: [
                {
                  name: 'README contains release-notes section markers',
                  severity: 'warn',
                  check: readmesHaveReleaseNotesMarkers,
                  fix: 'Add `<!-- section:release-notes -->` and `<!-- /section:release-notes -->` markers to each affected README',
                },
              ],
            },
            {
              name: 'repoLabels block declared in .config/release-kit.config.ts',
              severity: 'recommend',
              check: () => fileContains('.config/release-kit.config.ts', /repoLabels/),
              fix: 'Run `release-kit sync-labels init` to seed a repoLabels block, then customize labels',
            },
            {
              name: '.github/labels.yaml exists',
              severity: 'warn',
              skip: () => !fileContains('.config/release-kit.config.ts', /repoLabels/) && 'no repoLabels config',
              check: () => fileExists('.github/labels.yaml'),
              fix: 'Run `release-kit sync-labels generate` to produce the labels file',
              checks: [
                {
                  name: 'labels.yaml has current common preset',
                  severity: 'warn',
                  check: () => labelsHaveCurrentPresetHash('common', COMMON_PRESET_HASH),
                  fix: 'Run `release-kit sync-labels generate` to incorporate updated common labels',
                },
                {
                  name: 'scope labels in .github/labels.yaml have no description',
                  severity: 'warn',
                  quiet: true,
                  check: () => scopeLabelsHaveNoDescriptions(),
                  fix: 'Remove `description` from these scope labels in the repoLabels block of .config/release-kit.config.ts, so that GitHub groups them compactly, then run `release-kit sync-labels generate`',
                },
              ],
            },
          ],
        },
        // Keep these checks outside the config gate above, which skips when the config file is absent: For a repo
        // without a config file, release-kit still defaults `changelogJson.enabled` to true, and the repo still
        // publishes tarballs.
        {
          name: 'published packages ship CHANGELOG.md',
          severity: 'warn',
          skip: () => !hasPublishablePackages() && 'no publishable packages',
          check: () => packagesShipChangelog(),
          fix: 'Add "CHANGELOG.md" to the files field of each affected package.json',
        },
        {
          name: 'published packages ship the changelog archives',
          severity: 'warn',
          skip: () => {
            if (!hasPublishablePackages()) return 'no publishable packages';
            return !changelogArchivesAreEnabled() && 'changelogMarkdown.keptVersionCount is not set';
          },
          check: () => packagesShipChangelogArchives(),
          fix: 'Add "changelogs/" to the files field of each affected package.json, so that the links from CHANGELOG.md to its archive files resolve in the published package',
        },
        {
          name: 'changelog.json generation is enabled',
          severity: 'recommend',
          skip: () => !hasPublishablePackages() && 'no publishable packages',
          check: () => changelogJsonIsEnabled(),
          fix: 'Remove changelogJson.enabled: false from .config/release-kit.config.ts so that release-kit writes the machine-readable changelog that upgrade tooling reads before CHANGELOG.md',
          checks: [
            {
              name: 'published packages ship the changelog JSON',
              severity: 'warn',
              check: () => packagesShipChangelogJson(),
              get fix() {
                return `Add "${resolveChangelogJsonOutputPath()}" to the files field of each affected package.json`;
              },
            },
          ],
        },
        {
          name: 'config does not use removed releaseNotes.shouldCreateGithubRelease',
          severity: 'error',
          quiet: true,
          check: () => fileDoesNotContain('.config/release-kit.config.ts', /shouldCreateGithubRelease/),
          fix: "Remove 'shouldCreateGithubRelease' from .config/release-kit.config.ts. Adoption of GitHub Releases is now signaled by installing the create-github-release workflow, which `release-kit init` scaffolds.",
        },
        {
          name: '@changesets/cli not in devDependencies',
          severity: 'recommend',
          quiet: true,
          check: () => !hasDevDependency('@changesets/cli'),
          fix: 'pnpm remove @changesets/cli, then delete .changeset/ and any changeset:* scripts; release-kit supersedes changesets',
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
              fix: 'Run `release-kit update-templates` to regenerate the workflow from the current template',
            },
          ],
        },
        {
          name: 'sync-labels.yaml does not reference deprecated tag ref',
          severity: 'error',
          quiet: true,
          check: () => fileDoesNotContain('.github/workflows/sync-labels.yaml', /@sync-labels-workflow-v[0-9]/),
          fix: 'Update sync-labels.yaml to use @workflow/sync-labels-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)',
        },
        {
          name: 'retired .config/sync-labels.config.ts is absent',
          severity: 'error',
          quiet: true,
          check: () => !fileExists('.config/sync-labels.config.ts'),
          fix: 'Move the labels into the repoLabels block of .config/release-kit.config.ts, then delete .config/sync-labels.config.ts',
        },
      ],
    },
  ],
});
