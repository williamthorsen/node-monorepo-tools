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

// SHA-256 hashes of release-kit artifacts. Keep in sync —
// verified by __tests__/rdy-kit-hashes.app.test.ts.
export const CLIFF_TEMPLATE_HASH = '520ffdde4cbbef671f229d1e1f63c09a3c4ef0b2d76208386e372419d18065c7';
export const COMMON_PRESET_HASH = 'd12ffccbd5e4d9af8ecf47744b143f6c9f80bcf5e496cf1983b66834f0ae7825';
export const SYNC_LABELS_WORKFLOW_HASH = '4dfde2454bac03280381f0da70c9c735916a7812100dec5437853b843c4bd797';
export const RELEASE_WORKFLOW_HASH_MONOREPO = 'd2c297a3974a70485c73ec115c092ecba0d571b5238d5f440096d6a35b64810b';
export const RELEASE_WORKFLOW_HASH_SINGLE = 'd80f814468897d920c89ab55959f6c1f97efbd02b99522c92b9d1162ed694c1c';
export const PUBLISH_WORKFLOW_HASH_MONOREPO = 'ba9f8e353e0f60498df8b55a9340bd1b88c3b9f55e9862850da26dd9c98d8b23';
export const PUBLISH_WORKFLOW_HASH_SINGLE = '4abbafa80eab871ce5277751e86d0c057490b0b36ec6e4e06a41f39494c990b1';

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
          ],
        },
        {
          name: 'release.yaml does not reference deprecated tag ref',
          severity: 'error',
          check: () => fileDoesNotContain('.github/workflows/release.yaml', /@(release|publish)-workflow-v[0-9]/),
          fix: 'Update release.yaml to use @workflow/release-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)',
        },
        {
          name: 'publish.yaml workflow exists',
          severity: 'warn',
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
          ],
        },
        {
          name: 'publish.yaml does not reference deprecated tag ref',
          severity: 'error',
          check: () => fileDoesNotContain('.github/workflows/publish.yaml', /@(release|publish)-workflow-v[0-9]/),
          fix: 'Update publish.yaml to use @workflow/publish-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)',
        },
        {
          name: 'config does not use removed tagPrefix',
          severity: 'error',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => fileDoesNotContain('.config/release-kit.config.ts', /tagPrefix/),
          fix: "Remove 'tagPrefix' from .config/release-kit.config.ts — it is no longer supported; the default '{dir}-v' is used automatically",
        },
        {
          name: 'releaseNotes config is consistent with changelogJson',
          severity: 'warn',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => releaseNotesConfigIsConsistent(),
          fix: 'Either enable changelogJson.enabled or disable releaseNotes features (shouldCreateGithubRelease, shouldInjectIntoReadme)',
        },
        {
          name: 'releaseNotes.shouldInjectIntoReadme is true',
          severity: 'warn',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => releaseNotesInjectsIntoReadme(),
          fix: 'Set releaseNotes.shouldInjectIntoReadme to true in .config/release-kit.config.ts',
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

  const hasGithubRelease = /shouldCreateGithubRelease\s*:\s*true/.test(content);
  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasGithubRelease && !hasReadmeInjection;
}

/** Check that `releaseNotes.shouldInjectIntoReadme` is explicitly set to true. */
function releaseNotesInjectsIntoReadme(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return /shouldInjectIntoReadme\s*:\s*true/.test(content);
}

/** Check that `.github/labels.yaml` contains the expected hash for a named preset. */
function labelsHaveCurrentPresetHash(presetName: string, expectedHash: string): boolean {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, 'm');
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
