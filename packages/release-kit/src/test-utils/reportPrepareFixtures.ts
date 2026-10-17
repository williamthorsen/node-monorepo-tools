import type { ReleasedPackageResult } from '../types.ts';

/** Builds a released single-package result, overriding any field. */
export function makeReleasedWorkspace(overrides: Partial<ReleasedPackageResult> = {}): ReleasedPackageResult {
  return {
    targetId: overrides.name ?? '.',
    kind: 'package',
    status: 'released',
    previousTag: 'v1.0.0',
    commitCount: 1,
    parsedCommitCount: 1,
    releaseType: 'patch',
    currentVersion: '1.0.0',
    newVersion: '1.0.1',
    tag: 'v1.0.1',
    bumpedFiles: ['package.json'],
    changelogFiles: ['./CHANGELOG.md'],
    ...overrides,
  };
}
