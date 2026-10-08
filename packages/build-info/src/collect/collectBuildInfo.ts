import type { BuildInfo } from '../contract/types.ts';
import { readHostFacts } from './hosts/readHostFacts.ts';
import type { HostEnv, HostFacts } from './hosts/types.ts';
import { compactRecord } from './portable/compactRecord.ts';
import { findReleaseNotes } from './readReleaseNotes.ts';
import { parseRepositoryUrl } from './sources/parseRepositoryUrl.ts';
import { type GitFacts, readGitFacts } from './sources/readGitFacts.ts';
import { readManifest } from './sources/readManifest.ts';

/** Options of `collectBuildInfo`. */
export interface CollectBuildInfoOptions {
  /** The directory whose `package.json` and changelog describe the build. Defaults to `process.cwd()`. */
  cwd?: string;
  /** The environment variables to read the host from. Defaults to `process.env`. */
  env?: HostEnv;
  /** The build time. Defaults to the time of the call. */
  now?: Date;
  /** Whether to run git for the fields that the host leaves empty. Defaults to `true`. */
  readGit?: boolean;
}

/**
 * Collects the `BuildInfo` of the build running in `cwd`. Throws when `package.json` is missing or lacks a name or
 * version; a git failure only leaves git's fields absent.
 *
 * - Vercel, when `VERCEL=1`: environment from `VERCEL_TARGET_ENV`, else `VERCEL_ENV`; commit from
 *   `VERCEL_GIT_COMMIT_*`; repository from `VERCEL_GIT_PROVIDER`, `VERCEL_GIT_REPO_OWNER`, and `VERCEL_GIT_REPO_SLUG`;
 *   deployment from `VERCEL_DEPLOYMENT_ID`, `VERCEL_URL`, and `VERCEL_GIT_PULL_REQUEST_ID`.
 * - EAS Build, when `EAS_BUILD=true`: environment from `EAS_BUILD_PROFILE`; commit from `EAS_BUILD_GIT_COMMIT_HASH`;
 *   deployment from `EAS_BUILD_ID`.
 * - GitHub Actions, when `GITHUB_ACTIONS=true`: environment `production` on a push to the default branch, else
 *   `preview`; commit from `GITHUB_SHA` and `GITHUB_REF_NAME`, or on a pull request its head and `GITHUB_HEAD_REF`;
 *   repository from `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY`; deployment from `GITHUB_RUN_ID` and the pull request.
 * - Any other build is `unknown` when `CI` is set to a value other than `false`, else `local`.
 *
 * A host that leaves the environment empty takes `NODE_ENV`, else `development`. Git supplies the commit time and dirty
 * state on every host, and the other commit fields that the host leaves empty, provided that its `HEAD` is the commit
 * that the host reported. The repository comes from the host's variables, else the manifest's `repository`, else git's
 * `origin` remote. Release notes are the public sections of the manifest version's entry in `.meta/changelog.json`, or,
 * when that file lacks the version, its section of `CHANGELOG.md`.
 */
export function collectBuildInfo({
  cwd = process.cwd(),
  env = process.env,
  now,
  readGit = true,
}: CollectBuildInfoOptions = {}): BuildInfo {
  const manifest = readManifest(cwd);
  const host = readHostFacts(env);
  const git = readGit ? readGitFacts(cwd) : {};

  return {
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    buildTime: (now ?? new Date()).toISOString(),
    host: host.host,
    environment: host.environment,
    ...compactRecord<Pick<BuildInfo, 'commit' | 'deployment' | 'releaseNotes' | 'repository' | 'runtime'>>({
      commit: buildCommit(host.commit ?? {}, git),
      repository:
        host.repository ??
        parseRepositoryUrl(manifest.repository) ??
        (git.remoteUrl === undefined ? undefined : parseRepositoryUrl(git.remoteUrl)),
      deployment: host.deployment,
      runtime: { node: process.version },
      releaseNotes: findReleaseNotes(cwd, manifest.version),
    }),
  };
}

// region | Helpers

/**
 * Merges the host's commit with git's, or returns `undefined` when neither knows the sha. Git contributes only when its
 * `HEAD` is the host's commit: on a pull-request build, `HEAD` is a merge commit that the host does not report.
 */
function buildCommit(hostCommit: NonNullable<HostFacts['commit']>, git: GitFacts): BuildInfo['commit'] {
  const gitCommit = hostCommit.sha === undefined || hostCommit.sha === git.sha ? git : {};
  const sha = hostCommit.sha ?? gitCommit.sha;
  if (sha === undefined) {
    return undefined;
  }
  return {
    sha,
    shortSha: sha.slice(0, 7),
    ...compactRecord<Omit<NonNullable<BuildInfo['commit']>, 'sha' | 'shortSha'>>({
      ref: hostCommit.ref ?? gitCommit.ref,
      message: hostCommit.message ?? gitCommit.message,
      author: hostCommit.author ?? gitCommit.author,
      time: gitCommit.time,
      dirty: gitCommit.dirty,
    }),
  };
}

// endregion | Helpers
