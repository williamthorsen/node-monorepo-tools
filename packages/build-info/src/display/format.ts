import type { BuildInfo } from '../contract/types.ts';

/** The segments of a build's one-line label, each formatted for display. */
export interface BuildLabelParts {
  /** The version with a leading `v`, such as `v0.7.0`. */
  version: string;
  /** Absent when the build does not record a commit. */
  shortSha?: string;
  /** The build time in UTC, truncated to the minute, such as `2026-10-08 06:29Z`. */
  time: string;
}

const LABEL_SEPARATOR = ' · ';

/**
 * Formats the one-line label for a build, such as `v0.7.0 · a59f2f8 · 2026-10-08 06:29Z`. The commit segment is left
 * out when the build does not record a commit, and the build time is truncated to the minute.
 */
export function formatBuildLabel(info: BuildInfo): string {
  const { version, shortSha, time } = getBuildLabelParts(info);
  const segments = shortSha === undefined ? [version, time] : [version, shortSha, time];
  return segments.join(LABEL_SEPARATOR);
}

/** Returns the segments of the build's one-line label, for a renderer that marks up each segment on its own. */
export function getBuildLabelParts(info: BuildInfo): BuildLabelParts {
  const version = info.version.startsWith('v') ? info.version : `v${info.version}`;
  const timestamp = new Date(info.buildTime).toISOString();
  const time = `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)}Z`;
  return info.commit === undefined ? { version, time } : { version, shortSha: info.commit.shortSha, time };
}

/**
 * Returns the URL of the build's commit on GitHub, or `undefined` when the build does not record a commit or a
 * repository hosted on GitHub.
 */
export function getCommitUrl(info: BuildInfo): string | undefined {
  const { commit, repository } = info;
  if (commit === undefined || repository?.provider !== 'github') {
    return undefined;
  }
  return `${repository.url.replace(/\/+$/, '')}/commit/${commit.sha}`;
}
