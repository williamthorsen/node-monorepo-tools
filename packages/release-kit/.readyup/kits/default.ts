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
 * A check asserting the absence of something declares `quiet`: a conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { type CheckOutcome, defineRdyKit, pickJson } from 'readyup';
import {
  discoverWorkspaces,
  fileContains,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion,
  readFile,
} from 'readyup/check-utils';

import { detectRepoType } from '../../src/init/detectRepoType.ts';
import { packsPath } from '../../src/packsPath.ts';

function getMinVersion(): string {
  // `pickJson` is a compile-time helper: `rdy compile` rewrites the call to inline only the listed fields.
  // Defer the call into a function so module load does not invoke the runtime stub (which throws):
  // This keeps the module importable in tests that bypass the compile step.
  const picked = pickJson('../../package.json', ['version']);
  if (typeof picked['version'] !== 'string') {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked['version'];
}

function hasPublishablePackages(): boolean {
  return discoverWorkspaces({ filter: (w) => w.isPackage }).length > 0;
}

/**
 * Where release-kit writes the structured changelog when the config names no other path.
 *
 * Mirrors `DEFAULT_CHANGELOG_JSON_CONFIG.outputPath`, which the kit does not import: reaching `src/defaults.ts`
 * would pull the work-types taxonomy and its dependencies into the bundle this package publishes.
 * `src/__tests__/kit-changelog-packaging-checks.unit.test.ts` asserts the two stay equal.
 */
export const DEFAULT_CHANGELOG_JSON_PATH = '.meta/changelog.json';

/** Source shapes that can put `default` or `config` on the module namespace, which is what `loadConfig` reads. */
const CONFIG_EXPORT_PATTERNS = [
  /export\s+default\b/,
  /export\s+(?:const|let|var)\s+config\b/,
  /export\s*\{[^}]*\b(?:config|default)\b[^}]*\}/,
  /export\s*\*/,
];

// SHA-256 hashes of release-kit artifacts. Keep in sync. Verified by src/__tests__/kit-hashes.unit.test.ts.
export const CLIFF_TEMPLATE_HASH = '93b72e0b1393cd6b1fe8e2a0e303cd326fd323435951b0493396b305af32d2ec';
export const COMMON_PRESET_HASH = '86f9e1db9000793a91168e8c6b5695311a422ee208121324549c068fe67fa184';
export const SYNC_LABELS_WORKFLOW_HASH = 'd6e2403fb551d2d415f679125989c92760444eec887644565b2e05c9bf8f4c1e';
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
              quiet: true,
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
              quiet: true,
              check: () => fileDoesNotContain('.github/workflows/publish.yaml', /@(release|publish)-workflow-v[0-9]/),
              fix: 'Update publish.yaml to use @workflow/publish-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)',
            },
          ],
        },
        {
          name: '.config/release-kit.config.ts exports a config',
          severity: 'error',
          skip: () => (!fileExists('.config/release-kit.config.ts') ? 'no release-kit config file' : false),
          check: () => configFileExportsConfig(),
          fix: 'Export the config from .config/release-kit.config.ts as a default export or as a named `config` export; release-kit resolves no other export',
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
              fix: 'Wrap your config export with defineConfig() from @williamthorsen/release-kit/config for type safety',
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
              skip: () =>
                !fileContains('.config/release-kit.config.ts', /repoLabels/) ? 'no repoLabels config' : false,
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
        // Deliberately outside the config gate above: that check skips where the config file is absent, and a repo
        // with no config file still defaults `changelogJson.enabled` to true and still publishes tarballs.
        {
          name: 'published packages ship CHANGELOG.md',
          severity: 'warn',
          skip: () => (!hasPublishablePackages() ? 'no publishable packages' : false),
          check: () => packagesShipChangelog(),
          fix: 'Add "CHANGELOG.md" to the files field of each affected package.json',
        },
        {
          name: 'changelog.json generation is enabled',
          severity: 'recommend',
          skip: () => (!hasPublishablePackages() ? 'no publishable packages' : false),
          check: () => changelogJsonIsEnabled(),
          fix: 'Remove changelogJson.enabled: false from .config/release-kit.config.ts so release-kit writes the machine-readable changelog that upgrade tooling reads before CHANGELOG.md',
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
          fix: "Remove 'shouldCreateGithubRelease' from .config/release-kit.config.ts. Adoption of GitHub Releases is now signaled by installing the create-github-release workflow (see release-kit README for setup).",
        },
        {
          name: 'git-cliff not in devDependencies',
          severity: 'recommend',
          quiet: true,
          check: () => !hasDevDependency('git-cliff'),
          fix: 'pnpm remove git-cliff — release-kit handles changelog generation directly',
        },
        {
          name: '@changesets/cli not in devDependencies',
          severity: 'recommend',
          quiet: true,
          check: () => !hasDevDependency('@changesets/cli'),
          fix: 'pnpm remove @changesets/cli, then delete .changeset/ and any changeset:* scripts; release-kit supersedes changesets',
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
          quiet: true,
          check: () => fileDoesNotContain('.github/workflows/sync-labels.yaml', /@sync-labels-workflow-v[0-9]/),
          fix: 'Update sync-labels.yaml to use @workflow/sync-labels-v1 (run `release-kit sync-labels init --force` to regenerate, or replace the ref manually)',
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

// region | Helpers

/**
 * Checks whether the repo leaves structured changelog generation on.
 *
 * A repo with no config file inherits the enabled default, so an unreadable config passes rather than reporting
 * an opt-out nobody declared.
 *
 * @internal - Exported only to enable testing
 */
export function changelogJsonIsEnabled(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return true;
  return !/changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
}

/**
 * Checks that the config file exports a config release-kit can load.
 *
 * `loadConfig` resolves `imported.default ?? imported.config` and throws when the file exports neither, so the
 * checks nested beneath this one have nothing to read until it passes. Source text cannot decide a module's export
 * names exactly, and this check gates five others at `error` severity, so the pattern errs wide: a config the
 * regex admits and `loadConfig` rejects costs one honest failure downstream, where the reverse blocks seven lines.
 *
 * @internal - Exported only to enable testing
 */
export function configFileExportsConfig(): boolean {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return false;
  return CONFIG_EXPORT_PATTERNS.some((pattern) => pattern.test(content));
}

/** Checks whether `.github/labels.yaml` contains the expected hash for a named preset. */
function labelsHaveCurrentPresetHash(presetName: string, expectedHash: string): boolean {
  const content = readFile('.github/labels.yaml');
  if (content === undefined) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, 'm');
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}

/**
 * Checks that every publishable workspace would publish `CHANGELOG.md`.
 *
 * @internal - Exported only to enable testing
 */
export function packagesShipChangelog(): boolean | CheckOutcome {
  return reportWorkspacesOmitting('CHANGELOG.md');
}

/**
 * Checks that every publishable workspace would publish the structured changelog.
 *
 * @internal - Exported only to enable testing
 */
export function packagesShipChangelogJson(): boolean | CheckOutcome {
  return reportWorkspacesOmitting(resolveChangelogJsonOutputPath());
}

/**
 * Tests whether a README's content contains the release-notes section marker pair.
 *
 * Both `<!-- section:release-notes -->` and `<!-- /section:release-notes -->` must be present.
 * Order and proximity are not enforced; release-kit's injector locates each marker independently.
 */
export function readmeHasReleaseNotesMarkers(content: string): boolean {
  return content.includes('<!-- section:release-notes -->') && content.includes('<!-- /section:release-notes -->');
}

/**
 * Checks README markers across the consumer repo, iterating publishable workspaces.
 *
 * Validates `${dir}/README.md` for each publishable package; aggregates failures into the `CheckOutcome.detail` field.
 * A missing README counts as a failure for that package (no README → no markers).
 * Workspace discovery reports the repo root in both repo types, so a publishable root is checked like any other
 * package and the same loop handles both.
 */
export function readmesHaveReleaseNotesMarkers(): boolean | CheckOutcome {
  const failing: string[] = [];
  const packageWorkspaces = discoverWorkspaces({ filter: (w) => w.isPackage });
  for (const { dir } of packageWorkspaces) {
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

/**
 * Checks that releaseNotes features are not enabled while changelogJson is disabled.
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
 * Names the publishable workspaces whose `files` field would leave `path` out of the tarball.
 *
 * Workspace discovery reports the repo root in both repo types, so a publishable root is checked like any other
 * package and a `private: true` workspace is filtered out before its `files` field is read. The check does not
 * require `path` to exist on disk: a repo adopting release-kit before its first release should widen `files`
 * then, not after the first changelog is generated.
 */
function reportWorkspacesOmitting(path: string): boolean | CheckOutcome {
  const failing: string[] = [];
  const packageWorkspaces = discoverWorkspaces({ filter: (w) => w.isPackage });
  for (const { dir, packageJson } of packageWorkspaces) {
    if (!packsPath(packageJson['files'], path)) {
      failing.push(dir === '.' ? 'package.json' : `${dir}/package.json`);
    }
  }

  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `files field omits ${path}: ${failing.join(', ')}`,
  };
}

/**
 * Resolves the path release-kit writes the structured changelog to.
 *
 * Reads the raw config text rather than importing the config, as the neighboring config checks do.
 *
 * @internal - Exported only to enable testing
 */
export function resolveChangelogJsonOutputPath(): string {
  const content = readFile('.config/release-kit.config.ts');
  if (content === undefined) return DEFAULT_CHANGELOG_JSON_PATH;

  const match = /changelogJson\s*:\s*\{[^}]*outputPath\s*:\s*['"]([^'"]+)['"]/.exec(content);
  return match?.[1] ?? DEFAULT_CHANGELOG_JSON_PATH;
}

// endregion | Helpers
