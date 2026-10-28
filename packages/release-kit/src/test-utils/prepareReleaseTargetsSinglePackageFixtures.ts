import type { ChangelogDiagnostics } from '../buildChangelogItem.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import {
  prepareReleaseTargets,
  type TargetPrepareConfig,
  type TargetPrepareOptions,
} from '../prepareReleaseTargets.ts';
import type { ReleasePlan } from '../releasePlan.ts';
import type { PackageTarget, ReleaseSettings, WorkTypeConfig } from '../types.ts';

export const diagnostics: ChangelogDiagnostics = {
  malformedBlocks: [{ commitHash: 'aaa1111', commitSubject: 'Squash', reason: '`entries` is not a list' }],
  policyViolations: [
    { commitHash: 'bbb2222', commitSubject: 'Merge PR', type: 'drop', surface: 'entry', entryPosition: 1 },
  ],
  undeclaredEntryTypes: [{ commitHash: 'bbb2222', commitSubject: 'Merge PR', entryPosition: 2, type: 'chore' }],
  unroutedEntryScopes: [{ commitHash: 'bbb2222', commitSubject: 'Merge PR', entryPosition: 3, scope: 'other' }],
};

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

/** Fields of a single-package fixture: the shared settings and the root target's tag prefix and version files. */
export type SinglePackageFixture = Omit<ReleaseSettings, 'releaseNotes'> &
  Pick<PackageTarget, 'tagPrefix' | 'versionFiles'>;

/** Options of a single-package run, which names its one explicit version without a target id. */
export type SinglePackageOptions = Omit<TargetPrepareOptions, 'onlyTargetIds' | 'versionOverridesById'> & {
  versionOverride?: string;
};

/** Builds a single-package config tagged under `v`, with the changelog JSON disabled, overriding any field. */
export function makeConfig(overrides?: Partial<SinglePackageFixture>): TargetPrepareConfig {
  const { tagPrefix = 'v', versionFiles = ['package.json'], ...settings } = overrides ?? {};
  return {
    targets: [
      {
        id: '.',
        kind: 'package',
        tagPrefix,
        versionFiles,
        changelogDir: '.',
        packagePath: '.',
        isPublishable: true,
        isWorkspace: false,
      },
    ],
    settings: { workTypes, changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false }, ...settings },
  };
}

/** Prepares a single-package release, passing an explicit version under the root target's id. */
export function prepareSinglePackage(config: TargetPrepareConfig, options: SinglePackageOptions): ReleasePlan {
  const { versionOverride, ...rest } = options;
  return prepareReleaseTargets(config, {
    ...rest,
    ...(versionOverride !== undefined && { versionOverridesById: new Map([['.', versionOverride]]) }),
  });
}
