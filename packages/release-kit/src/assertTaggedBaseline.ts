import { join } from 'node:path';

import { resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { readChangelogEntries } from './changelogJsonUtils.ts';
import { readCurrentVersion } from './planVersionBump.ts';
import { readChangelogSections } from './readChangelogSections.ts';
import type { ReleaseConfig } from './types.ts';

/** A release target whose history `prepare` has read, as the baseline check sees it. */
export interface BaselineTarget {
  /** How the error names the target, such as `workspace 'core'`. */
  label: string;
  packageFiles: readonly string[];
  changelogPaths: readonly string[];
  /** The prefixes under which the history was read; a missing tag is named under the first. */
  tagPrefixes: readonly string[];
  previousTag: string | undefined;
}

/** A target whose current version is recorded in its changelog but is not its previous reachable tag. */
export interface UntaggedBaseline {
  label: string;
  version: string;
  /** The tag to create at the commit that released `version`. */
  tag: string;
}

/**
 * Throws when any finding is an untagged baseline, naming each one's missing tag. Without that tag, the unreleased
 * window reaches back to the start of history, so the new version would absorb every earlier commit.
 */
export function assertTaggedBaseline(findings: ReadonlyArray<UntaggedBaseline | undefined>): void {
  const untagged = findings.filter((finding) => finding !== undefined);
  if (untagged.length === 0) return;
  const lines = untagged.map(({ label, version, tag }) => `  - ${label}: ${version} (create tag ${tag})`);
  throw new Error(
    [
      'The current version is recorded in the changelog, but its tag is not the previous tag reachable from HEAD:',
      ...lines,
      'Tag the commit that released each version, then run prepare again.',
    ].join('\n'),
  );
}

/**
 * Returns the target's untagged baseline: its current version appears in one of its `CHANGELOG.md` or
 * `changelog.json` files, and its previous tag is not that version under any of its prefixes. A first release, whose
 * version no changelog records yet, has none.
 */
export function findUntaggedBaseline(
  target: BaselineTarget,
  config: Pick<ReleaseConfig, 'changelogJson'>,
): UntaggedBaseline | undefined {
  const recordedVersions = readRecordedVersions(target.changelogPaths, config);
  if (recordedVersions.size === 0) {
    return undefined;
  }
  const version = readCurrentVersion(target.packageFiles);
  if (!recordedVersions.has(version)) {
    return undefined;
  }
  if (target.tagPrefixes.some((prefix) => target.previousTag === `${prefix}${version}`)) {
    return undefined;
  }
  return { label: target.label, version, tag: `${target.tagPrefixes[0] ?? ''}${version}` };
}

// region | Helpers

/** Returns the versions that the `CHANGELOG.md` and `changelog.json` files of the changelog paths record. */
function readRecordedVersions(
  changelogPaths: readonly string[],
  config: Pick<ReleaseConfig, 'changelogJson'>,
): Set<string> {
  const versions = new Set<string>();
  for (const changelogPath of changelogPaths) {
    const { versioned } = readChangelogSections(join(changelogPath, 'CHANGELOG.md'));
    const entries = readChangelogEntries(resolveChangelogJsonPath(config, changelogPath)) ?? [];
    for (const { version } of [...versioned, ...entries]) {
      versions.add(version);
    }
  }
  return versions;
}

// endregion | Helpers
