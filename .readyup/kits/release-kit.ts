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
import type { CheckOutcome } from 'readyup';
import {
  defineRdyKit,
  discoverWorkspaces,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion,
  pickJson,
  readFile,
} from 'readyup';

import { detectRepoType } from '../../packages/release-kit/src/init/detectRepoType.ts';

// `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline
// only the listed fields. Defer the call into a function so module load does
// not invoke the runtime stub (which throws) — keeps the module importable in
// tests that bypass the compile step.
function getMinVersion(): string {
  const picked = pickJson('../../packages/release-kit/package.json', ['version']);
  if (typeof picked.version !== 'string') {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked.version;
}

function hasPublishablePackages(): boolean {
  return discoverWorkspaces({ filter: (w) => w.isPackage }).length > 0;
}

// SHA-256 hashes of release-kit artifacts. Keep in sync —
// verified by __tests__/rdy-kit-hashes.app.test.ts.
export const CLIFF_TEMPLATE_HASH = 'ccdde2d0d9c31bf395fc701fa8358714d9c7c83a7278851fb371b0a8f24785e9';
export const COMMON_PRESET_HASH = '25b1938b40006a00a39d291583d7cd2dabda699e1f4bfb0634ba49e7dffb3c45';
export const SYNC_LABELS_WORKFLOW_HASH = '4dfde2454bac03280381f0da70c9c735916a7812100dec5437853b843c4bd797';
export const RELEASE_WORKFLOW_HASH_MONOREPO = '0a9724b7b3c5e24087fd3a8f36fed8e990d699267fcf36028ce048ab40dc2946';
export const RELEASE_WORKFLOW_HASH_SINGLE = 'a3d19bbc1ba8bb30622e53c590137b97e3179e80988c0967737b021cdaeab73f';
export const PUBLISH_WORKFLOW_HASH_MONOREPO = '0afa9ffe914f3dc8f043e68252ebc604c8cc1a953422fcea37a909a4def370ee';
export const PUBLISH_WORKFLOW_HASH_SINGLE = '6f31183e0a1e66be791a19266c3b028dadbd9fe010f7fc4452f3f8970c937b43';

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
              fix: 'Run `release-kit init --force` to regenerate release.yaml from the current template',
            },
            {
              name: 'release.yaml does not reference deprecated tag ref',
              severity: 'error',
              check: () => fileDoesNotContain('.github/workflows/release.yaml', /@(release|publish)-workflow-v[0-9]/),
              fix: 'Update release.yaml to use @workflow/release-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)',
            },
          ],
        },
        {
          name: 'publish.yaml workflow exists',
          severity: 'warn',
          skip: () => (!hasPublishablePackages() ? 'no publishable packages' : false),
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
              fix: 'Run `release-kit init --force` to regenerate publish.yaml from the current template',
            },
            {
              name: 'publish.yaml does not reference deprecated tag ref',
              severity: 'error',
              check: () => fileDoesNotContain('.github/workflows/publish.yaml', /@(release|publish)-workflow-v[0-9]/),
              fix: 'Update publish.yaml to use @workflow/publish-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)',
            },
          ],
        },
        {
          name: 'releaseNotes config is consistent with changelogJson',
          severity: 'warn',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => releaseNotesConfigIsConsistent(),
          fix: 'Either enable changelogJson.enabled or disable releaseNotes.shouldInjectIntoReadme',
        },
        {
          name: 'config does not use removed releaseNotes.shouldCreateGithubRelease',
          severity: 'error',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => fileDoesNotContain('.config/release-kit.config.ts', /shouldCreateGithubRelease/),
          fix: "Remove 'shouldCreateGithubRelease' from .config/release-kit.config.ts. Adoption of GitHub Releases is now signaled by installing the create-github-release workflow (see release-kit README for setup).",
        },
        {
          name: 'releaseNotes.shouldInjectIntoReadme is true',
          severity: 'warn',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
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
          name: 'sync-labels.yaml does not reference deprecated tag ref',
          severity: 'error',
          check: () => fileDoesNotContain('.github/workflows/sync-labels.yaml', /@sync-labels-workflow-v[0-9]/),
          fix: 'Update sync-labels.yaml to use @workflow/sync-labels-v1 (run `release-kit sync-labels init --force` to regenerate, or replace the ref manually)',
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

/**
 * Check that releaseNotes features are not enabled while changelogJson is disabled.
 *
 * Uses regex matching against the raw config file to avoid importing it.
 */
function releaseNotesConfigIsConsistent(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return true;

  const changelogJsonDisabled = /changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
  if (!changelogJsonDisabled) return true;

  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasReadmeInjection;
}

/** Check that `releaseNotes.shouldInjectIntoReadme` is explicitly set to true. */
function releaseNotesInjectsIntoReadme(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return /shouldInjectIntoReadme\s*:\s*true/.test(content);
}

/**
 * Test whether a README's content contains the release-notes section marker pair.
 *
 * Both `<!-- section:release-notes -->` and `<!-- /section:release-notes -->`
 * must be present. Order and proximity are not enforced; release-kit's injector
 * locates each marker independently.
 */
export function readmeHasReleaseNotesMarkers(content: string): boolean {
  return content.includes('<!-- section:release-notes -->') && content.includes('<!-- /section:release-notes -->');
}

/**
 * Check README markers across the consumer repo, iterating publishable workspaces.
 *
 * Validates `${dir}/README.md` for each publishable package and aggregates failures
 * into the `CheckOutcome.detail` field. A missing README counts as a failure for
 * that package (no README → no markers). In single-package mode, `discoverWorkspaces`
 * yields a single root entry (`dir: '.'`), so the same loop handles both repo types.
 */
export function readmesHaveReleaseNotesMarkers(): boolean | CheckOutcome {
  const failing: string[] = [];
  for (const { dir } of discoverWorkspaces({ filter: (w) => w.isPackage })) {
    const readmePath = dir === '.' ? 'README.md' : `${dir}/README.md`;
    const content = readFile(readmePath);
    if (content === undefined || !readmeHasReleaseNotesMarkers(content)) {
      failing.push(readmePath);
    }
  }

  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing markers or README: ${failing.join(', ')}`,
  };
}

/** Check that `.github/labels.yaml` contains the expected hash for a named preset. */
function labelsHaveCurrentPresetHash(presetName: string, expectedHash: string): boolean {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, 'm');
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
